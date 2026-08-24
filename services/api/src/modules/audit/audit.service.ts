import type { AuditEntry, AuditQuery } from '@velnes/contracts';
import type { Trx } from '../../db/index.js';

export interface AuditInput {
  actorEmployeeId?: string | null | undefined;
  actorName: string;
  roleName?: string | undefined;
  businessName?: string | undefined;
  locationName?: string | undefined;
  action: string;
  object: string;
  before?: string | undefined;
  after?: string | undefined;
  source?: string | undefined;
  reason?: string | undefined;
}

/**
 * The one audit door. Every price change, role change, lifecycle
 * transition and HQ action writes through here — actor + before +
 * after + reason, inside the same transaction as the change itself.
 */
export async function logAudit(trx: Trx, tenantId: string, input: AuditInput) {
  await trx
    .insertInto('auditLog')
    .values({
      tenantId,
      actorEmployeeId: input.actorEmployeeId ?? null,
      actorName: input.actorName,
      roleName: input.roleName ?? '',
      businessName: input.businessName ?? '',
      locationName: input.locationName ?? '—',
      action: input.action,
      object: input.object,
      before: input.before ?? '—',
      after: input.after ?? '—',
      source: input.source ?? 'API',
      reason: input.reason ?? '',
    })
    .execute();
}

export async function listAudit(trx: Trx, query: AuditQuery): Promise<AuditEntry[]> {
  let q = trx
    .selectFrom('auditLog')
    .select([
      'id',
      'ts',
      'actorName',
      'roleName',
      'businessName',
      'locationName',
      'action',
      'object',
      'before',
      'after',
      'source',
      'reason',
    ])
    .orderBy('ts', 'desc')
    .limit(query.limit)
    .offset(query.offset);
  if (query.action) q = q.where('action', '=', query.action);
  const rows = await q.execute();
  return rows.map((r) => ({ ...r, ts: r.ts.toISOString() }));
}
