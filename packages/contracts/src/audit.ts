import { z } from 'zod';

/** One audit entry — the prototype's exact shape:
 *  actor + before + after + reason, always. */
export const AuditEntrySchema = z.object({
  id: z.uuid(),
  ts: z.iso.datetime(),
  actorName: z.string(),
  roleName: z.string(),
  businessName: z.string(),
  locationName: z.string(),
  action: z.string(),
  object: z.string(),
  before: z.string(),
  after: z.string(),
  source: z.string(),
  reason: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditQuerySchema = z.object({
  action: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type AuditQuery = z.infer<typeof AuditQuerySchema>;

export const AuditListResponseSchema = z.object({
  entries: z.array(AuditEntrySchema),
});
export type AuditListResponse = z.infer<typeof AuditListResponseSchema>;
