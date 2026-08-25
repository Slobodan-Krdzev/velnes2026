import type {
  AccessClaims,
  PurchaseOrder,
  PurchaseOrderStatus,
} from '@velnes/contracts';
import { sql } from 'kysely';
import type { Trx } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';
import { localIso } from '../scheduling/scheduling.service.js';

export class SupplierError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'INVALID' | 'WRONG_STATE' | 'MIN_ORDER',
    message: string,
  ) {
    super(message);
  }
}

/** Which transitions are legal, and whose side may make them. The
 *  status field has exactly one writer: poTransition. */
const SALON_EDGES: Record<string, PurchaseOrderStatus[]> = {
  draft: ['approval', 'submitted', 'cancelled'],
  approval: ['submitted', 'cancelled'],
  submitted: ['cancelled'],
  partdelivered: ['disputed'],
  delivered: ['disputed'],
};
const SUPPLIER_EDGES: Record<string, PurchaseOrderStatus[]> = {
  submitted: ['accepted', 'partial', 'cancelled'],
  accepted: ['processing'],
  partial: ['processing'],
  processing: ['shipped'],
};

async function actorName(trx: Trx, id: string) {
  return (
    (await trx.selectFrom('employees').select('name').where('id', '=', id).executeTakeFirst())
      ?.name ?? ''
  );
}

export async function toOrderContract(trx: Trx, id: string): Promise<PurchaseOrder> {
  const o = await trx
    .selectFrom('purchaseOrders as o')
    .innerJoin('suppliers as s', 's.id', 'o.supplierId')
    .selectAll('o')
    .select('s.name as supplierName')
    .where('o.id', '=', id)
    .executeTakeFirstOrThrow();
  const lines = await trx
    .selectFrom('purchaseOrderLines as l')
    .innerJoin('supplierProducts as p', 'p.id', 'l.supplierProductId')
    .selectAll('l')
    .select(['p.name', 'p.sku'])
    .where('l.orderId', '=', id)
    .orderBy('l.sort')
    .execute();
  return {
    id: o.id,
    ref: o.ref,
    supplierId: o.supplierId,
    supplierName: o.supplierName,
    locationId: o.locationId,
    status: o.status,
    byName: o.byName,
    expected: o.expected ? localIso(o.expected) : null,
    track: o.track,
    createdAt: o.createdAt.toISOString(),
    lines: lines.map((l) => ({
      id: l.id,
      supplierProductId: l.supplierProductId,
      name: l.name,
      sku: l.sku,
      qty: l.qty,
      price: l.price,
      free: l.free,
      recv: l.recv,
      dmg: l.dmg,
    })),
    total: lines.reduce((n, l) => n + l.qty * l.price, 0),
  };
}

/** The active bxgy promotion adds its free units to a matching line —
 *  the offer applies itself; the owner never types it twice. */
async function applyPromotions(
  trx: Trx,
  supplierId: string,
  lines: { supplierProductId: string; qty: number; price: number; free: number }[],
) {
  const today = localIso(new Date());
  const promos = await trx
    .selectFrom('supplierPromotions')
    .selectAll()
    .where('supplierId', '=', supplierId)
    .where('active', '=', true)
    .where('kind', '=', 'bxgy')
    .execute();
  for (const promo of promos) {
    if (localIso(promo.starts) > today || localIso(promo.ends) < today) continue;
    for (const l of lines)
      if (promo.productIds.includes(l.supplierProductId) && promo.per > 0)
        l.free = Math.floor(l.qty / promo.per) * promo.value;
  }
}

export async function createOrder(
  trx: Trx,
  claims: AccessClaims,
  req: {
    supplierId: string;
    locationId: string;
    lines: { supplierProductId: string; qty: number }[];
    submit: boolean;
  },
): Promise<PurchaseOrder> {
  const sup = await trx
    .selectFrom('suppliers')
    .selectAll()
    .where('id', '=', req.supplierId)
    .executeTakeFirst();
  if (!sup) throw new SupplierError('NOT_FOUND', 'Unknown supplier');
  const conn = await trx
    .selectFrom('supplierConnections')
    .selectAll()
    .where('supplierId', '=', req.supplierId)
    .executeTakeFirst();
  if (conn?.status !== 'connected')
    throw new SupplierError('WRONG_STATE', `${sup.name} is not connected yet — ordering starts after they accept`);

  const priced: { supplierProductId: string; qty: number; price: number; free: number }[] = [];
  for (const l of req.lines) {
    const sp = await trx
      .selectFrom('supplierProducts')
      .selectAll()
      .where('id', '=', l.supplierProductId)
      .executeTakeFirst();
    if (!sp || sp.supplierId !== req.supplierId)
      throw new SupplierError('NOT_FOUND', 'That product is not in this supplier catalog');
    if (sp.sample) throw new SupplierError('INVALID', 'Samples are requested, not ordered');
    if (l.qty < sp.moq)
      throw new SupplierError('INVALID', `${sp.name}: the minimum order is ${sp.moq}`);
    priced.push({ supplierProductId: sp.id, qty: l.qty, price: sp.buy, free: 0 });
  }
  await applyPromotions(trx, req.supplierId, priced);
  const total = priced.reduce((n, l) => n + l.qty * l.price, 0);
  if (req.submit && total < sup.minOrder)
    throw new SupplierError(
      'MIN_ORDER',
      `${sup.name} takes orders from ${sup.minOrder} ден — this one is ${total} ден`,
    );

  const loc = await trx
    .selectFrom('locations')
    .select(['invPrefix'])
    .where('id', '=', req.locationId)
    .executeTakeFirstOrThrow();
  const count = await trx
    .selectFrom('purchaseOrders')
    .select(sql<string>`count(*)`.as('n'))
    .executeTakeFirst();
  const ref = `${(loc.invPrefix ?? 'ORD-').replace(/-+$/, '')}-${String(40 + Number(count?.n ?? 0) + 1).padStart(4, '0')}`;

  const by = await actorName(trx, claims.sub);
  const order = await trx
    .insertInto('purchaseOrders')
    .values({
      tenantId: claims.ten,
      ref,
      supplierId: req.supplierId,
      locationId: req.locationId,
      status: req.submit ? 'submitted' : 'draft',
      createdBy: claims.sub,
      byName: by,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  for (const [i, l] of priced.entries())
    await trx
      .insertInto('purchaseOrderLines')
      .values({
        tenantId: claims.ten,
        orderId: order.id,
        supplierProductId: l.supplierProductId,
        qty: l.qty,
        price: l.price,
        free: l.free,
        sort: i,
      })
      .execute();
  if (req.submit)
    await logAudit(trx, claims.ten, {
      actorEmployeeId: claims.sub,
      actorName: by,
      action: 'Order submitted',
      object: `Order · ${ref}`,
      after: `${sup.name} · ${total} ден`,
    });
  return toOrderContract(trx, order.id);
}

export async function poTransition(
  trx: Trx,
  side: 'salon' | 'supplier',
  actor: { id: string | null; name: string; tenantId?: string },
  id: string,
  to: PurchaseOrderStatus,
  extra?: { track?: string },
) {
  const o = await trx
    .selectFrom('purchaseOrders')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!o) throw new SupplierError('NOT_FOUND', 'Unknown order');
  const edges = side === 'salon' ? SALON_EDGES : SUPPLIER_EDGES;
  if (!(edges[o.status] ?? []).includes(to))
    throw new SupplierError('WRONG_STATE', `${o.status} → ${to} is not this side's step`);
  // The supplier's step still lands in the salon's audit trail — the
  // write needs the order's tenant context inside this transaction.
  if (side === 'supplier')
    await sql`select set_config('app.tenant_id', ${o.tenantId}, true)`.execute(trx);
  await trx
    .updateTable('purchaseOrders')
    .set({
      status: to,
      ...(extra?.track !== undefined ? { track: extra.track } : {}),
      ...(to === 'shipped' && !o.expected
        ? { expected: new Date(Date.now() + 3 * 864e5) }
        : {}),
    })
    .where('id', '=', id)
    .execute();
  await logAudit(trx, o.tenantId, {
    actorEmployeeId: side === 'salon' ? actor.id : null,
    actorName: side === 'salon' ? actor.name : `Supplier · ${actor.name}`,
    action: 'Order status',
    object: `Order · ${o.ref}`,
    before: o.status,
    after: to,
  });
  return toOrderContract(trx, id);
}

/**
 * Count what actually arrived: only confirmed quantities go into
 * stock. Damaged and missing units never reach it; a shortage keeps
 * the order open as partially delivered until the rest arrives.
 */
export async function receiveOrder(
  trx: Trx,
  claims: AccessClaims,
  id: string,
  counts: { lineId: string; received: number; damaged: number }[],
) {
  const o = await trx
    .selectFrom('purchaseOrders')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!o) throw new SupplierError('NOT_FOUND', 'Unknown order');
  if (o.status !== 'shipped' && o.status !== 'partdelivered')
    throw new SupplierError('WRONG_STATE', 'Only a shipped order can be received');
  const lines = await trx
    .selectFrom('purchaseOrderLines')
    .selectAll()
    .where('orderId', '=', id)
    .execute();
  let complete = true;
  for (const l of lines) {
    const c = counts.find((x) => x.lineId === l.id);
    const ordered = l.qty + l.free;
    const got = c ? c.received : ordered;
    const dmg = c?.damaged ?? 0;
    const good = Math.max(0, got - dmg);
    if (good < ordered) complete = false;
    await trx
      .updateTable('purchaseOrderLines')
      .set({ recv: good, dmg })
      .where('id', '=', l.id)
      .execute();
    // Into stock — through the linked own product, if there is one.
    const product = await trx
      .selectFrom('products')
      .select(['id', 'price'])
      .where('supplierProductId', '=', l.supplierProductId)
      .executeTakeFirst();
    if (product && good > 0) {
      await trx
        .insertInto('stockMovements')
        .values({
          tenantId: claims.ten,
          locationId: o.locationId,
          productId: product.id,
          qty: good,
          kind: 'delivery',
          note: `Delivery ${o.ref}`,
          ref: o.ref,
          actorEmployeeId: claims.sub,
        })
        .execute();
      await trx
        .insertInto('locationCatalogProducts')
        .values({
          tenantId: claims.ten,
          locationId: o.locationId,
          productId: product.id,
          price: product.price,
          stock: good,
        })
        .onConflict((oc) =>
          oc.columns(['locationId', 'productId']).doUpdateSet((eb) => ({
            stock: eb('locationCatalogProducts.stock', '+', good),
          })),
        )
        .execute();
    }
  }
  const to = complete ? 'delivered' : 'partdelivered';
  await trx.updateTable('purchaseOrders').set({ status: to }).where('id', '=', id).execute();
  const by = await actorName(trx, claims.sub);
  const locName = await trx
    .selectFrom('locations')
    .select('name')
    .where('id', '=', o.locationId)
    .executeTakeFirst();
  await logAudit(trx, claims.ten, {
    actorEmployeeId: claims.sub,
    actorName: by,
    action: 'Delivery received',
    object: `Order · ${o.ref}`,
    before: 'On the way',
    after: complete ? 'Delivered in full' : 'Partially delivered — shortage reported',
    locationName: locName?.name ?? '—',
  });
  return toOrderContract(trx, id);
}
