import { env } from '../../env.js';
import type { ActionDef, PlannerParam } from './registry.js';

/**
 * The planner boundary — "AI plans, Velnes executes". The planner ONLY
 * proposes a registered action id and extracts raw argument strings from
 * the user's words. It never resolves entities, validates, checks
 * permissions or mutates — all of that is Velnes code downstream, which
 * treats this output as untrusted input.
 *
 * Two implementations behind one `plan()`:
 *  - `claudePlan`: the live planner. Builds one Anthropic tool per
 *    registered action from its `params`, forces a tool call, and reads
 *    the chosen action + args back. Same honest-fallback anatomy as
 *    extract.provider — no key / any miss → null → degrade to the stub,
 *    never fake.
 *  - `stubPlan`: a deterministic pattern-matcher — the no-key/offline
 *    fallback and the harness the tests run against.
 */

export interface Plan {
  actionId: string | null; // a registered action id, or null if unrecognised
  args: Record<string, unknown>; // raw, unresolved argument values
  clarify?: string; // a question when nothing actionable was recognised
}

export interface PlanInput {
  message: string;
  actions: ActionDef[];
  /** The open draft being continued, if any (so we fill its next field). */
  current?: { actionId: string; missing: string[] };
}

const NUM = /(\d[\d.,]*)/;
const ISO = /\b(\d{4}-\d{2}-\d{2})\b/;
const cleanNum = (s: string) => s.replace(/[.,](?=\d{3}\b)/g, '');

/** Deterministic planner for the offline fallback + tests. */
export function stubPlan(input: PlanInput): Plan {
  const msg = input.message.trim();
  const low = msg.toLowerCase();
  const has = (id: string) => input.actions.some((a) => a.id === id);

  // Continuation: fill the current draft's next missing field.
  if (input.current) {
    const args: Record<string, unknown> = {};
    const iso = msg.match(ISO);
    const numM = msg.match(NUM);
    const miss = input.current.missing;
    if (miss.includes('date') && iso) args.date = iso[1]!;
    else if (miss.includes('price') && numM) args.price = cleanNum(numM[1]!);
    else if (miss.includes('durationMin') && numM) args.durationMin = cleanNum(numM[1]!);
    else if (miss.includes('name') && !numM) args.name = msg.replace(/[?.]+$/, '').trim();
    else if (miss.includes('serviceName') && !numM) args.serviceName = msg.replace(/[?.]+$/, '').trim();
    else if (miss.includes('location')) args.location = msg.replace(/[?.]+$/, '').trim();
    return { actionId: input.current.actionId, args };
  }

  // List services.
  if (has('list_services') && /\b(list|show|what).{0,20}\bservices?\b/.test(low))
    return { actionId: 'list_services', args: {} };

  // Delete a service (navigate-only).
  const del = low.match(/\b(?:delete|remove)\b\s+(?:the\s+)?(?:service\s+)?(.+?)\s*(?:service)?\??$/);
  if (has('delete_service') && /\b(delete|remove)\b/.test(low) && del) {
    const name = del[1]!.replace(/\b(the|service)\b/g, '').replace(/\s+/g, ' ').trim();
    if (name) return { actionId: 'delete_service', args: { serviceName: name } };
  }

  // Roles / permissions / owner (navigate-only).
  if (has('manage_access') && /\b(role|roles|permission|permissions|owner|ownership|manager|admin|access)\b/.test(low))
    return { actionId: 'manage_access', args: {} };

  // Create a service.
  if (has('create_service') && /\b(add|create|new)\b.{0,12}\bservice\b/.test(low)) {
    const args: Record<string, unknown> = {};
    const nameM = msg.match(/(?:called|named)\s+"?([^"]+?)"?(?:\s+(?:for|at|priced)|\s*$)/i) ?? msg.match(/"([^"]+)"/);
    if (nameM) args.name = nameM[1]!.trim();
    const priceM = low.match(/(?:for|at|priced|price)\s+([\d.,]+)/);
    if (priceM) args.price = cleanNum(priceM[1]!);
    const durM = low.match(/([\d.,]+)\s*(?:min|minutes|mins)\b/);
    if (durM) args.durationMin = cleanNum(durM[1]!);
    return { actionId: 'create_service', args };
  }

  // Close a location on a date.
  if (has('add_closure') && /\bclos(e|ed|ing)\b/.test(low)) {
    const iso = low.match(ISO);
    return { actionId: 'add_closure', args: iso ? { date: iso[1]! } : {} };
  }
  // Reopen a closed date.
  if (has('remove_closure') && /\b(reopen|re-open|open)\b/.test(low)) {
    const iso = low.match(ISO);
    return { actionId: 'remove_closure', args: iso ? { date: iso[1]! } : {} };
  }

  // Edit a service (price by default): "change/set/update X to N".
  const upd = low.match(
    /\b(?:change|set|make|update|increase|raise|put)\b\s+(?:the\s+|our\s+)?(?:price\s+of\s+)?(.+?)\s*(?:price\s+)?(?:to|=|at)\s+([\d.,]+)/,
  );
  if (has('edit_service') && upd) {
    const name = upd[1]!.replace(/\b(the|our|price)\b/g, '').replace(/\s+/g, ' ').trim();
    return { actionId: 'edit_service', args: { serviceName: name, price: cleanNum(upd[2]!) } };
  }
  // Rename: "rename X to Y".
  const ren = low.match(/\brename\b\s+(.+?)\s+to\s+(.+?)\??$/);
  if (has('edit_service') && ren)
    return { actionId: 'edit_service', args: { serviceName: ren[1]!.trim(), newName: msg.slice(msg.toLowerCase().indexOf(' to ') + 4).trim() } };

  // Read a price.
  const read =
    low.match(/(?:price|cost)\s+(?:of|for)\s+(.+?)\??$/) ??
    low.match(/how much (?:is|does|for|to)\s+(?:the\s+)?(.+?)\s*(?:cost|\??$)/) ??
    low.match(/what.?s?\s+the\s+price\s+of\s+(.+?)\??$/);
  if (has('read_service_price') && read) {
    const name = read[1]!.replace(/\b(the|our|cost|price)\b/g, '').replace(/\s+/g, ' ').trim();
    if (name) return { actionId: 'read_service_price', args: { serviceName: name } };
  }

  return {
    actionId: null,
    args: {},
    clarify:
      "I can list, create, edit or price your services, close/reopen a date, and point you to deletes or team access. Try “add a new service”, “what are my services?”, or “change Massage to 1800”.",
  };
}

// ── the live Claude planner ──────────────────────────────────────────
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 20_000;
const MAX_TOKENS = 700;

const JSON_TYPE: Record<PlannerParam['type'], string> = { string: 'string', number: 'number', boolean: 'boolean' };

/** One Anthropic tool per action, its input schema built from `params`. */
function toolFor(a: ActionDef) {
  const properties: Record<string, unknown> = {};
  for (const p of a.params)
    properties[p.name] = { type: JSON_TYPE[p.type], description: p.description, ...(p.enum ? { enum: p.enum } : {}) };
  return {
    name: a.id,
    description: a.description,
    input_schema: {
      type: 'object',
      properties,
      required: a.params.filter((p) => p.required).map((p) => p.name),
    },
  };
}

const CLARIFY_TOOL = {
  name: 'clarify',
  description: "Use when the request is unclear, unsupported, or not about the salon's catalog/hours.",
  input_schema: {
    type: 'object',
    properties: { question: { type: 'string', description: 'A short question or explanation for the user' } },
    required: ['question'],
  },
};

function systemPrompt(input: PlanInput): string {
  const lines = [
    'You are the planner for the Velnes salon assistant. You do NOT act; you only choose ONE tool that matches the',
    "user's request and fill its arguments from their words. Velnes itself checks permissions, resolves names, shows a",
    'preview and asks the user to approve before anything changes — so never worry about those, and never refuse for',
    'permission reasons. Extract only what the user actually said; do not invent names, prices or dates. Express any',
    'date as ISO yyyy-mm-dd (today is ' + '{{today}}' + '). If nothing fits, call clarify.',
  ];
  if (input.current) {
    const a = input.actions.find((x) => x.id === input.current!.actionId);
    lines.push(
      `The user is in the middle of "${a?.title ?? input.current.actionId}" and still needs: ${input.current.missing.join(', ')}.`,
      'Prefer calling that same tool and filling the missing field(s) from this message.',
    );
  }
  return lines.join(' ');
}

/** Pull the first tool call out of a Messages API response. */
function firstToolCall(body: unknown): { name: string; input: Record<string, unknown> } | null {
  const content = (body as { content?: { type: string; name?: string; input?: unknown }[] })?.content;
  if (!Array.isArray(content)) return null;
  const call = content.find((c) => c.type === 'tool_use' && typeof c.name === 'string');
  if (!call?.name) return null;
  return { name: call.name, input: (call.input as Record<string, unknown>) ?? {} };
}

/**
 * Call Claude to choose an action + args. Returns null on any miss — no
 * key, network/timeout, non-200, or no tool call — so the caller degrades
 * to the stub. Never throws.
 */
export async function claudePlan(input: PlanInput): Promise<Plan | null> {
  if (!env.anthropicApiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: env.assistantModel,
        max_tokens: MAX_TOKENS,
        system: systemPrompt(input).replace('{{today}}', today),
        tools: [...input.actions.map(toolFor), CLARIFY_TOOL],
        tool_choice: { type: 'any' },
        messages: [{ role: 'user', content: input.message }],
      }),
    });
    if (!res.ok) return null;
    const call = firstToolCall(await res.json());
    if (!call) return null;
    if (call.name === 'clarify') {
      const q = String(call.input.question ?? '');
      return { actionId: null, args: {}, ...(q ? { clarify: q } : {}) };
    }
    if (!input.actions.some((a) => a.id === call.name)) return null; // hallucinated tool
    return { actionId: call.name, args: call.input };
  } catch {
    return null; // network, timeout, abort — degrade, never fake
  } finally {
    clearTimeout(timer);
  }
}

/** Pick the planner from env; a claude miss degrades to the stub. */
export async function plan(input: PlanInput): Promise<Plan> {
  if (env.assistantProvider === 'claude') {
    const ai = await claudePlan(input);
    if (ai) return ai;
  }
  return stubPlan(input);
}
