import type { BillingEvent } from '@velnes/contracts';
import type { Trx } from '../../db/index.js';

/**
 * The document's own timeline (phase 3, 2026-10-07): append-only rows
 * in `billing_events`, one per thing that happened to an accounting
 * invoice — created, edited, issued, and the later kinds. Written in
 * the same transaction as the change; the database refuses UPDATE and
 * DELETE on them for everyone. Payloads carry figures and references,
 * never secrets and no more of a person than the actor's name.
 */
export async function addEvent(
  trx: Trx,
  tenantId: string,
  invoiceId: string,
  kind: BillingEvent['kind'],
  actor: { id: string | null; name: string },
  data: Record<string, unknown>,
  source = 'API',
) {
  await trx
    .insertInto('billingEvents')
    .values({ tenantId, invoiceId, kind, actorEmployeeId: actor.id, actorName: actor.name, source, data: JSON.stringify(data) })
    .execute();
}

export async function listEvents(trx: Trx, invoiceId: string): Promise<BillingEvent[]> {
  const rows = await trx.selectFrom('billingEvents').selectAll().where('invoiceId', '=', invoiceId).orderBy('at').orderBy('id').execute();
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as BillingEvent['kind'],
    at: r.at.toISOString(),
    actorName: r.actorName,
    source: r.source,
    data: (r.data ?? {}) as Record<string, unknown>,
  }));
}
