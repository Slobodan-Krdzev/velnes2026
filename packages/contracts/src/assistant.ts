import { z } from 'zod';

/**
 * Velnes AI Assistant — wire contracts (V1 spike).
 *
 * The Assistant is an ACTION assistant: "AI plans, Velnes executes". The
 * LLM (or, in the spike, a deterministic stub) only proposes a registered
 * action and its arguments; the server resolves entities, validates,
 * checks permission, builds a STRUCTURED change preview, and mutates only
 * on explicit approval through the same canonical door the UI uses.
 *
 * The structured ActionDraft — never the chat transcript — is the source
 * of truth for a pending mutation. See docs/AI-ASSISTANT-PROPOSAL.md.
 */

export const AssistantDraftStatusSchema = z.enum([
  'COLLECTING', // still gathering / resolving required fields
  'READY_FOR_REVIEW', // all fields present + validated; preview built
  'AWAITING_APPROVAL', // shown to the user, waiting for the explicit button
  'EXECUTING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export type AssistantDraftStatus = z.infer<typeof AssistantDraftStatusSchema>;

/** One structured change — the atom of a preview/diff. Never free-form text. */
export const AssistantChangeOpSchema = z.object({
  kind: z.enum(['create', 'update', 'delete']),
  entity: z.object({ type: z.string(), id: z.string().optional(), label: z.string() }),
  before: z.record(z.string(), z.unknown()).optional(),
  after: z.record(z.string(), z.unknown()).optional(),
  impact: z.string().optional(),
});
export type AssistantChangeOp = z.infer<typeof AssistantChangeOpSchema>;

export const AssistantChangeSetSchema = z.object({ ops: z.array(AssistantChangeOpSchema) });
export type AssistantChangeSet = z.infer<typeof AssistantChangeSetSchema>;

export const AssistantFieldErrorSchema = z.object({
  field: z.string(),
  code: z.string(),
  message: z.string(),
});

/** Where a navigate-only (high-risk) action would send the user. The
 *  Assistant explains and deep-links but never executes these itself. */
export const AssistantNavigateSchema = z.object({
  screen: z.string(), // a workspace route, e.g. '/catalog'
  entityId: z.string().optional(),
  tab: z.string().optional(),
});
export type AssistantNavigate = z.infer<typeof AssistantNavigateSchema>;

/** The pending mutation, structured. The UI renders from this, not the chat. */
export const AssistantDraftSchema = z.object({
  id: z.string(),
  app: z.enum(['workspace', 'supplier']),
  actionId: z.string(),
  kind: z.enum(['read', 'write', 'navigate']),
  intent: z.string(), // the assistant's paraphrase, for the user to confirm
  status: AssistantDraftStatusSchema,
  args: z.record(z.string(), z.unknown()),
  missing: z.array(z.string()),
  errors: z.array(AssistantFieldErrorSchema),
  preview: AssistantChangeSetSchema.nullable(),
  /** For a READ action, the plain answer; otherwise null. */
  answer: z.string().nullable().default(null),
  /** For a NAVIGATE action, where to deep-link; otherwise null. */
  navigate: AssistantNavigateSchema.nullable().default(null),
  /** Continuation UX: "4 of 6 required details completed". */
  requiredCount: z.number().int(),
  filledCount: z.number().int(),
});
export type AssistantDraft = z.infer<typeof AssistantDraftSchema>;

/** Structured page/entity context — IDs, never free text. Explicit user
 *  intent always overrides context. */
export const AssistantContextSchema = z
  .object({ screen: z.string().optional(), entityId: z.string().optional() })
  .optional();

export const AssistantMessageRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  draftId: z.string().optional(), // continue an existing draft
  context: AssistantContextSchema,
});
export type AssistantMessageRequest = z.infer<typeof AssistantMessageRequestSchema>;
export const AssistantMessageResponseSchema = z.object({
  reply: z.string(), // the assistant's turn: a question, a read answer, or "ready"
  draft: AssistantDraftSchema.nullable(), // null when no action was recognised
});
export type AssistantMessageResponse = z.infer<typeof AssistantMessageResponseSchema>;

export const AssistantExecuteRequestSchema = z.object({ draftId: z.string() });

/** A stale-data conflict surfaced by the concurrency fingerprint at execute. */
export const AssistantConflictSchema = z.object({
  field: z.string(),
  was: z.string(),
  now: z.string(),
  proposed: z.string(),
});
export const AssistantExecuteResponseSchema = z.object({
  status: AssistantDraftStatusSchema, // COMPLETED | FAILED
  message: z.string(),
  conflict: AssistantConflictSchema.nullable().default(null),
});
export type AssistantExecuteResponse = z.infer<typeof AssistantExecuteResponseSchema>;

/** Draft continuation: the open, un-expired draft for this user, if any. */
export const AssistantResumeResponseSchema = z.object({ draft: AssistantDraftSchema.nullable() });
