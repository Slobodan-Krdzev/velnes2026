import { env } from '../../env.js';
import type { ActionDef } from './registry.js';

/**
 * The planner boundary — "AI plans, Velnes executes". The planner ONLY
 * proposes a registered action id and extracts raw argument strings from
 * the user's words. It never resolves entities, validates, checks
 * permissions or mutates — all of that is Velnes code downstream, which
 * treats this output as untrusted input.
 *
 * V1 spike: a deterministic `stubPlan` (so the whole flow is testable and
 * runs with no model key). `claudePlan` is the same-shaped Claude seam,
 * copying the honest-fallback pattern of extract.provider (no key / any
 * miss → null → degrade to the stub, never fake).
 */

export interface Plan {
  actionId: string | null; // a registered action id, or null if unrecognised
  args: Record<string, unknown>; // raw, unresolved argument strings
  clarify?: string; // a question when nothing actionable was recognised
}

export interface PlanInput {
  message: string;
  actions: ActionDef[];
  /** The open draft being continued, if any (so we fill its next field). */
  current?: { actionId: string; missing: string[] };
}

const NUM = /(\d[\d.,]*)/;

/** Deterministic planner for the spike + tests. */
export function stubPlan(input: PlanInput): Plan {
  const msg = input.message.trim();
  const low = msg.toLowerCase();

  // Continuation: fill the current draft's next missing field.
  if (input.current) {
    const args: Record<string, unknown> = {};
    const num = msg.match(NUM);
    if (input.current.missing.includes('price') && num) args.price = num[1]!.replace(/[.,](?=\d{3}\b)/g, '');
    if (input.current.missing.includes('serviceName') && !num) args.serviceName = msg.replace(/[?.]+$/, '').trim();
    return { actionId: input.current.actionId, args };
  }

  // Fresh update: "change/set/make/update/increase X to N" (X may trail " price").
  const upd = low.match(
    /\b(?:change|set|make|update|increase|raise|put)\b\s+(?:the\s+|our\s+)?(?:price\s+of\s+)?(.+?)\s*(?:price\s+)?(?:to|=|at)\s+([\d.,]+)/,
  );
  if (upd) {
    const name = upd[1]!.replace(/\b(the|our|price)\b/g, '').replace(/\s+/g, ' ').trim();
    return { actionId: 'update_price', args: { serviceName: name, price: upd[2]!.replace(/[.,](?=\d{3}\b)/g, '') } };
  }

  // Fresh read: "price of X" / "how much is X" / "what's the price of X".
  const read =
    low.match(/(?:price|cost)\s+(?:of|for)\s+(.+?)\??$/) ??
    low.match(/how much (?:is|does|for|to)\s+(?:the\s+)?(.+?)\s*(?:cost|\??$)/) ??
    low.match(/what.?s?\s+the\s+price\s+of\s+(.+?)\??$/);
  if (read) {
    const name = read[1]!.replace(/\b(the|our|cost|price)\b/g, '').replace(/\s+/g, ' ').trim();
    if (name) return { actionId: 'read_service_price', args: { serviceName: name } };
  }

  return {
    actionId: null,
    args: {},
    clarify: "I can read or change a service's price. For example: “What's the price of Massage?” or “Change Massage to 1800”.",
  };
}

/**
 * The Claude planner seam — prepared, honest-until-keyed. Returns null on
 * no key / any miss so the caller degrades to the stub. (Wiring the real
 * Messages API call — tools built from `actions`, forced tool_choice,
 * zod-validated output — is the follow-up after the spike; the interface
 * is fixed so nothing downstream changes when it turns on.)
 */
export async function claudePlan(_input: PlanInput): Promise<Plan | null> {
  if (!env.anthropicApiKey) return null;
  // Deliberately not yet wired in the spike — returning null degrades to
  // the deterministic stub rather than pretend. See docs/AI-ASSISTANT-PROPOSAL.md.
  return null;
}

/** Pick the planner from env; a claude miss degrades to the stub. */
export async function plan(input: PlanInput): Promise<Plan> {
  if (env.assistantProvider === 'claude') {
    const ai = await claudePlan(input);
    if (ai) return ai;
  }
  return stubPlan(input);
}
