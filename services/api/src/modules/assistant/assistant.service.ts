import { randomUUID } from 'node:crypto';
import type {
  AccessClaims,
  AssistantDraft,
  AssistantExecuteResponse,
  AssistantMessageRequest,
  AssistantMessageResponse,
} from '@velnes/contracts';
import { sql } from 'kysely';
import type { Trx } from '../../db/index.js';
import { can, permsFor } from '../auth/authz.service.js';
import { logAudit } from '../audit/audit.service.js';
import { plan } from './planner.provider.js';
import { actionById, registryFor, type ActionDef, type Fingerprint, type ResolveResult } from './registry.js';

const TTL_MIN = 30;
type App = 'workspace' | 'supplier';

async function actorName(trx: Trx, claims: AccessClaims): Promise<string> {
  const e = await trx.selectFrom('employees').select('name').where('id', '=', claims.sub).executeTakeFirst();
  return e?.name ?? 'Unknown';
}

/** What we persist per draft: the client-facing draft, the accumulated raw
 *  inputs (for continuation), and the concurrency fingerprint. */
interface Stored {
  v: AssistantDraft;
  raw: Record<string, unknown>;
  fp: Fingerprint | null;
}

/** A per-field question for plain "missing" cases (resolve() supplies its
 *  own richer messages for not-found / ambiguous). */
const PROMPTS: Record<string, string> = {
  serviceName: 'Which service?',
  price: "What's the new price (in MKD)?",
};

function intentOf(action: ActionDef, args: Record<string, unknown>): string {
  const name = typeof args.serviceName === 'string' ? ` — ${args.serviceName}` : '';
  return `${action.title}${name}`;
}

function buildDraft(
  id: string,
  app: App,
  action: ActionDef,
  status: AssistantDraft['status'],
  resolved: ResolveResult,
  preview: AssistantDraft['preview'],
  answer: string | null,
): AssistantDraft {
  return {
    id,
    app,
    actionId: action.id,
    kind: action.kind,
    intent: intentOf(action, resolved.args),
    status,
    args: resolved.args,
    missing: resolved.missing,
    errors: resolved.errors,
    preview: preview ?? null,
    answer,
    requiredCount: action.required.length,
    filledCount: action.required.length - resolved.missing.length,
  };
}

/** The next thing to say while collecting: a validation error, else a
 *  question for the first missing field. */
function nextQuestion(resolved: ResolveResult): string {
  if (resolved.errors.length) return resolved.errors[0]!.message;
  const f = resolved.missing[0];
  return (f && PROMPTS[f]) ?? 'Could you give me a bit more detail?';
}

async function loadStored(trx: Trx, id: string): Promise<Stored | null> {
  const row = await trx
    .selectFrom('assistantDrafts')
    .select('draft')
    .where('id', '=', id)
    .where('expiresAt', '>', sql<Date>`now()`)
    .executeTakeFirst();
  return (row?.draft as Stored | undefined) ?? null;
}

async function saveStored(trx: Trx, claims: AccessClaims, app: App, s: Stored): Promise<void> {
  const expiresAt = new Date(Date.now() + TTL_MIN * 60_000);
  await trx
    .insertInto('assistantDrafts')
    .values({
      id: s.v.id,
      tenantId: claims.ten,
      createdBy: claims.sub,
      app,
      actionId: s.v.actionId,
      status: s.v.status,
      draft: JSON.stringify(s),
      expiresAt,
    })
    .onConflict((oc) =>
      oc.column('id').doUpdateSet({ status: s.v.status, draft: JSON.stringify(s), updatedAt: sql<Date>`now()` }),
    )
    .execute();
}

/** A single conversational turn. Never mutates persistent domain data. */
export async function handleMessage(
  trx: Trx,
  claims: AccessClaims,
  app: App,
  req: AssistantMessageRequest,
): Promise<AssistantMessageResponse> {
  // Continue an open draft, if one was named and is still alive.
  const prior = req.draftId ? await loadStored(trx, req.draftId) : null;
  const current =
    prior && (prior.v.status === 'COLLECTING' || prior.v.status === 'READY_FOR_REVIEW')
      ? { actionId: prior.v.actionId, missing: prior.v.missing }
      : undefined;

  const p = await plan({ message: req.message, actions: registryFor(app), ...(current ? { current } : {}) });
  if (!p.actionId) return { reply: p.clarify ?? "I'm not sure how to help with that yet.", draft: null };

  const action = actionById(p.actionId);
  if (!action || action.app !== app) return { reply: "I can't do that from here.", draft: null };

  // Permission — fail fast, before collecting anything sensitive.
  const perms = await permsFor(trx, claims);
  if (!can(perms, action.permission))
    return { reply: `You don't have permission to ${action.title.toLowerCase()}.`, draft: null };

  // Accumulate raw inputs across turns; resolve to IDs + validate.
  const raw = { ...(prior?.raw ?? {}), ...p.args };
  const resolved = await action.resolve(trx, claims, raw);
  const id = prior?.v.id ?? randomUUID();

  // READ: answer directly when resolved; no persistent draft.
  if (action.kind === 'read') {
    if (resolved.missing.length || resolved.errors.length) {
      const draft = buildDraft(id, app, action, 'COLLECTING', resolved, null, null);
      await saveStored(trx, claims, app, { v: draft, raw, fp: null });
      return { reply: nextQuestion(resolved), draft };
    }
    const answer = await action.read!(trx, claims, resolved.args);
    if (prior) await trx.deleteFrom('assistantDrafts').where('id', '=', id).execute();
    const draft = buildDraft(id, app, action, 'COMPLETED', resolved, null, answer);
    return { reply: answer, draft };
  }

  // WRITE: collect → validate → preview, gated on explicit approval.
  if (resolved.missing.length || resolved.errors.length) {
    const draft = buildDraft(id, app, action, 'COLLECTING', resolved, null, null);
    await saveStored(trx, claims, app, { v: draft, raw, fp: null });
    return { reply: nextQuestion(resolved), draft };
  }
  const { changeSet, fingerprint } = await action.preview!(trx, claims, resolved.args);
  const draft = buildDraft(id, app, action, 'READY_FOR_REVIEW', resolved, changeSet, null);
  await saveStored(trx, claims, app, { v: draft, raw, fp: fingerprint });
  return { reply: `Ready to ${action.title.toLowerCase()} — review and approve below.`, draft };
}

/** The open (un-expired) draft this user can resume, if any. */
export async function resumeDraft(trx: Trx, claims: AccessClaims): Promise<AssistantDraft | null> {
  const row = await trx
    .selectFrom('assistantDrafts')
    .select('draft')
    .where('createdBy', '=', claims.sub)
    .where('status', 'in', ['COLLECTING', 'READY_FOR_REVIEW'])
    .where('expiresAt', '>', sql<Date>`now()`)
    .orderBy('updatedAt', 'desc')
    .executeTakeFirst();
  return ((row?.draft as Stored | undefined)?.v) ?? null;
}

/** Explicit Cancel — abandon a draft. */
export async function cancelDraft(trx: Trx, id: string): Promise<void> {
  await trx.deleteFrom('assistantDrafts').where('id', '=', id).execute();
}

/**
 * The ONLY mutation path. Reloads the draft, re-checks permission,
 * re-validates, runs the concurrency fingerprint, then calls the canonical
 * door inside the caller's transaction and writes both the human audit and
 * the structured assistant-action record. Domain errors from the door
 * propagate (rolling back the transaction) and are mapped by the route.
 */
export async function executeDraft(
  trx: Trx,
  claims: AccessClaims,
  app: App,
  draftId: string,
): Promise<AssistantExecuteResponse> {
  const stored = await loadStored(trx, draftId);
  if (!stored) return { status: 'FAILED', message: 'That request expired — please start again.', conflict: null };
  if (stored.v.status !== 'READY_FOR_REVIEW' && stored.v.status !== 'AWAITING_APPROVAL')
    return { status: 'FAILED', message: 'There is nothing to approve.', conflict: null };

  const action = actionById(stored.v.actionId);
  if (!action?.execute || action.app !== app)
    return { status: 'FAILED', message: 'That action can no longer be performed.', conflict: null };

  const perms = await permsFor(trx, claims);
  if (!can(perms, action.permission))
    return { status: 'FAILED', message: `You don't have permission to ${action.title.toLowerCase()}.`, conflict: null };

  const resolved = await action.resolve(trx, claims, stored.raw);
  if (resolved.missing.length || resolved.errors.length)
    return { status: 'FAILED', message: 'Some details are no longer valid — please review.', conflict: null };

  // Stale-data guard (§16): compare the preview-time fingerprint to reality.
  if (action.checkFingerprint && stored.fp) {
    const conflict = await action.checkFingerprint(trx, claims, resolved.args, stored.fp);
    if (conflict) {
      // Re-baseline against current so a renewed approval compares fresh.
      const fresh = await action.preview!(trx, claims, resolved.args);
      const v = { ...stored.v, preview: fresh.changeSet, status: 'READY_FOR_REVIEW' as const };
      await saveStored(trx, claims, app, { v, raw: stored.raw, fp: fresh.fingerprint });
      return {
        status: 'READY_FOR_REVIEW',
        message: `The ${conflict.field} changed while we were preparing this (was ${conflict.was}, now ${conflict.now}). Please review and approve again.`,
        conflict,
      };
    }
  }

  // Execute via the canonical door (may throw — the route rolls back + maps).
  const result = await action.execute(trx, claims, resolved.args);

  // Human-readable audit (keeps the one audit stream), plus the structured
  // AI-action record (decision 8) — both in this transaction.
  const opText = result.change.ops
    .map((o) => `${o.entity.label}: ${JSON.stringify(o.before ?? {})} → ${JSON.stringify(o.after ?? {})}`)
    .join('; ');
  await logAudit(trx, claims.ten, {
    actorEmployeeId: claims.sub,
    actorName: await actorName(trx, claims),
    action: `Assistant · ${action.title}`,
    object: stored.v.intent,
    before: result.change.ops[0]?.before ? JSON.stringify(result.change.ops[0]!.before) : '—',
    after: opText || '—',
    source: 'ai_assistant',
    reason: `Approved by the signed-in user via the Assistant`,
  });
  await trx
    .insertInto('assistantActions')
    .values({
      tenantId: claims.ten,
      actorEmployeeId: claims.sub,
      app,
      actionId: action.id,
      draftId: stored.v.id,
      change: JSON.stringify(result.change),
      fingerprint: stored.fp ? JSON.stringify(stored.fp) : null,
      result: 'success',
      reason: 'approved',
    })
    .execute();

  await trx
    .updateTable('assistantDrafts')
    .set({ status: 'COMPLETED', updatedAt: sql<Date>`now()` })
    .where('id', '=', stored.v.id)
    .execute();

  return { status: 'COMPLETED', message: result.message, conflict: null };
}
