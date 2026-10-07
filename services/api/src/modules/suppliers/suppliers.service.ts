import { env } from '../../env.js';
import type {
  AccessClaims,
  PurchaseOrder,
  PurchaseOrderStatus,
} from '@velnes/contracts';
import { sql } from 'kysely';
import type { Trx } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';
import { queueMail } from '../mail/mail.service.js';
import { localIso } from '../scheduling/scheduling.service.js';
import { ensureInvoiceNo } from './invoice-pdf.service.js';

/**
 * A salon submitted an order to a supplier: drop a notification in
 * the supplier's portal feed and an "order placed" mail into the
 * outbox (mock transport until the provider is decided). Runs inside
 * the order's own transaction, under the salon's tenant context.
 */
export async function notifyOrderSubmitted(trx: Trx, orderId: string) {
  const o = await trx
    .selectFrom('purchaseOrders as o')
    .innerJoin('suppliers as s', 's.id', 'o.supplierId')
    .leftJoin('businesses as b', 'b.id', 'o.tenantId')
    .select(['o.id', 'o.ref', 'o.supplierId', 'o.tenantId', 's.name as supplierName', 's.contact', 'b.name as salonName'])
    .where('o.id', '=', orderId)
    .executeTakeFirst();
  if (!o) return;
  const totalRow = await trx
    .selectFrom('purchaseOrderLines')
    .select(sql<string>`COALESCE(SUM(qty * price),0)`.as('total'))
    .where('orderId', '=', orderId)
    .executeTakeFirst();
  const total = Number(totalRow?.total ?? 0);
  const salon = o.salonName ?? 'A salon';
  await trx
    .insertInto('supplierNotifications')
    .values({
      supplierId: o.supplierId,
      kind: 'order',
      title: `New order ${o.ref}`,
      body: `${salon} placed ${o.ref}${total ? ` · ${total} ден` : ''} — accept it in the portal`,
      refId: o.id,
    })
    .execute();
  const email = (o.contact ?? '').match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0];
  if (email)
    await queueMail(trx, {
      tenantId: o.tenantId,
      to: email,
      subject: `New order ${o.ref} — ${salon}`,
      body: `${salon} placed order ${o.ref}${total ? ` for ${total} ден` : ''} with ${o.supplierName}. Sign in to the supplier portal to accept and ship it.`,
      kind: 'order_placed',
      refId: o.id,
      cta: { label: 'Open the order', url: `${env.supplierAppUrl}/orders` },
    });
}

/* ── News on both sides of the chain (Alex, 2026-10-06) ──────────────
   Every step one side takes is told to the other, twice: a row in that
   side's own bell and a mail through the outbox (mock transport until
   the provider is decided). The supplier's bell is `supplier_notifications`
   (kinds: `order`, `connection`); the salon's is `platform_notices`
   for its own tenant (kinds: `supplier_order`, `supplier_connection`).
   Each helper runs inside the step's own transaction, so a refused step
   leaves no message behind. A supplier's step writes under the salon's
   tenant context (set by the caller, as `poTransition` does) because
   the salon's bell and mailbox are the salon's rows. */

const EMAIL_RE = /[\w.+-]+@[\w.-]+\.\w+/;

async function supplierEmail(trx: Trx, supplierId: string): Promise<string | null> {
  const s = await trx.selectFrom('suppliers').select('contact').where('id', '=', supplierId).executeTakeFirst();
  return (s?.contact ?? '').match(EMAIL_RE)?.[0] ?? null;
}

/** The salon's owner — the business's one address for news. */
async function salonOwnerEmail(trx: Trx, tenantId: string): Promise<string | null> {
  const b = await trx
    .selectFrom('businesses as b')
    .innerJoin('employees as o', 'o.id', 'b.ownerEmployeeId')
    .select('o.email')
    .where('b.id', '=', tenantId)
    .executeTakeFirst();
  return b?.email ?? null;
}

async function names(trx: Trx, tenantId: string, supplierId: string) {
  const b = await trx.selectFrom('businesses').select('name').where('id', '=', tenantId).executeTakeFirst();
  const s = await trx.selectFrom('suppliers').select('name').where('id', '=', supplierId).executeTakeFirst();
  return { salon: b?.name ?? 'A salon', supplier: s?.name ?? 'the supplier' };
}

/** Ring the supplier's bell and mail its contact address. */
export async function tellSupplier(
  trx: Trx,
  q: { tenantId: string; supplierId: string; kind: 'order' | 'connection'; title: string; body: string; refId: string; mailKind: string; ctaPath: string },
) {
  await trx
    .insertInto('supplierNotifications')
    .values({ supplierId: q.supplierId, kind: q.kind, title: q.title, body: q.body, refId: q.refId })
    .execute();
  const email = await supplierEmail(trx, q.supplierId);
  if (email)
    await queueMail(trx, {
      tenantId: q.tenantId,
      to: email,
      subject: q.title,
      body: q.body,
      kind: q.mailKind,
      refId: q.refId,
      cta: { label: 'Open the supplier portal', url: `${env.supplierAppUrl}${q.ctaPath}` },
    });
}

/** Ring the salon's bell and mail its owner. Tenant context required. */
export async function tellSalon(
  trx: Trx,
  q: { tenantId: string; kind: 'supplier_order' | 'supplier_connection' | 'supplier_promotion'; title: string; body: string; refId: string; mailKind: string; ctaPath: string },
) {
  await trx
    .insertInto('platformNotices')
    .values({ audience: 'salons', tenantId: q.tenantId, kind: q.kind, title: q.title, body: q.body, refId: q.refId })
    .execute();
  const email = await salonOwnerEmail(trx, q.tenantId);
  if (email)
    await queueMail(trx, {
      tenantId: q.tenantId,
      to: email,
      subject: q.title,
      body: q.body,
      kind: q.mailKind,
      refId: q.refId,
      cta: { label: 'Open Suppliers', url: `${env.workspaceAppUrl}${q.ctaPath}` },
    });
}

/** A salon asked to connect: the supplier hears it. Salon's context. */
export async function notifyConnectionRequested(trx: Trx, tenantId: string, supplierId: string) {
  const n = await names(trx, tenantId, supplierId);
  await tellSupplier(trx, {
    tenantId,
    supplierId,
    kind: 'connection',
    title: `Connection request from ${n.salon}`,
    body: `${n.salon} asked to connect with ${n.supplier}. Accept or decline it under Salons in the portal.`,
    refId: tenantId,
    mailKind: 'connection_requested',
    ctaPath: '/salons',
  });
}

/** The supplier answered: the salon hears it. Caller sets the salon's
 *  tenant context first (the supplier's own context cannot write there). */
export async function notifyConnectionDecided(trx: Trx, tenantId: string, supplierId: string, accepted: boolean) {
  const n = await names(trx, tenantId, supplierId);
  await tellSalon(trx, {
    tenantId,
    kind: 'supplier_connection',
    title: accepted ? `${n.supplier} accepted your connection` : `${n.supplier} declined your connection`,
    body: accepted
      ? `You are now connected with ${n.supplier}: their catalogue is open to order from under Suppliers.`
      : `${n.supplier} declined the connection request. You can ask again later or contact them directly.`,
    refId: supplierId,
    mailKind: accepted ? 'connection_accepted' : 'connection_declined',
    ctaPath: '/suppliers',
  });
}

/** A supplier published a promotion (2026-10-07): every connected salon
 *  hears it — bell and mail. Caller sets the salon's tenant context. */
export async function notifyPromotion(trx: Trx, tenantId: string, promo: { id: string; title: string; starts: string; ends: string; supplierName: string }) {
  await tellSalon(trx, {
    tenantId,
    kind: 'supplier_promotion',
    title: `${promo.supplierName}: ${promo.title}`,
    body: `${promo.supplierName} published a promotion, ${promo.starts} to ${promo.ends}. See it under Suppliers → Promotions; nothing changes in your prices or till unless you order it.`,
    refId: promo.id,
    mailKind: 'supplier_promotion',
    ctaPath: `/suppliers?tab=promotions&promo=${promo.id}`,
  });
}

/** The supplier moved an order on: the salon hears it. Tenant context
 *  already set by `poTransition`. */
async function notifyOrderStep(trx: Trx, orderId: string, to: PurchaseOrderStatus, reason?: string) {
  const o = await trx
    .selectFrom('purchaseOrders as o')
    .innerJoin('suppliers as s', 's.id', 'o.supplierId')
    .select(['o.id', 'o.ref', 'o.tenantId', 'o.track', 'o.expected', 's.name as supplierName'])
    .where('o.id', '=', orderId)
    .executeTakeFirst();
  if (!o) return;
  const words =
    to === 'accepted'
      ? { title: `Order ${o.ref} accepted`, body: `${o.supplierName} accepted order ${o.ref} and is preparing it.`, mailKind: 'order_accepted' }
      : to === 'shipped'
        ? {
            title: `Order ${o.ref} shipped`,
            body: `${o.supplierName} shipped order ${o.ref}${o.track ? ` · tracking ${o.track}` : ''}${o.expected ? ` · expected ${localIso(o.expected)}` : ''}. Receive it under Suppliers → Orders when it arrives.`,
            mailKind: 'order_shipped',
          }
        : to === 'cancelled'
          ? { title: `Order ${o.ref} declined`, body: `${o.supplierName} declined order ${o.ref}${reason ? `: ${reason}` : ''}.`, mailKind: 'order_declined' }
          : null;
  if (!words) return;
  await tellSalon(trx, { tenantId: o.tenantId, kind: 'supplier_order', refId: o.id, ctaPath: '/suppliers?tab=orders', ...words });
}

/** The salon received the goods: the supplier hears whether all of it
 *  arrived. Salon's context. */
async function notifyOrderReceived(trx: Trx, orderId: string, complete: boolean) {
  const o = await trx
    .selectFrom('purchaseOrders as o')
    .leftJoin('businesses as b', 'b.id', 'o.tenantId')
    .select(['o.id', 'o.ref', 'o.tenantId', 'o.supplierId', 'b.name as salonName'])
    .where('o.id', '=', orderId)
    .executeTakeFirst();
  if (!o) return;
  const salon = o.salonName ?? 'The salon';
  await tellSupplier(trx, {
    tenantId: o.tenantId,
    supplierId: o.supplierId,
    kind: 'order',
    title: complete ? `Order ${o.ref} received in full` : `Order ${o.ref} partially received`,
    body: complete
      ? `${salon} received order ${o.ref} in full and marked it finished.`
      : `${salon} received part of order ${o.ref} and reported a shortage; the order stays open until the rest arrives.`,
    refId: o.id,
    mailKind: complete ? 'order_received' : 'order_partly_received',
    ctaPath: '/orders',
  });
}

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
    .leftJoin('businesses as b', 'b.id', 'o.tenantId')
    .leftJoin('locations as loc', 'loc.id', 'o.locationId')
    .selectAll('o')
    .select(['s.name as supplierName', 'b.name as salonName', 'loc.name as locationName'])
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
    salonName: o.salonName ?? null,
    locationId: o.locationId,
    locationName: o.locationName ?? null,
    status: o.status,
    byName: o.byName,
    expected: o.expected ? localIso(o.expected) : null,
    track: o.track,
    supplierNote: o.supplierNote ?? '',
    invoiceNo: o.invoiceNo ?? null,
    invoicedAt: o.invoicedAt ? o.invoicedAt.toISOString() : null,
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
  if (req.submit) {
    await logAudit(trx, claims.ten, {
      actorEmployeeId: claims.sub,
      actorName: by,
      action: 'Order submitted',
      object: `Order · ${ref}`,
      after: `${sup.name} · ${total} ден`,
    });
    await notifyOrderSubmitted(trx, order.id);
  }
  return toOrderContract(trx, order.id);
}

export async function poTransition(
  trx: Trx,
  side: 'salon' | 'supplier',
  actor: { id: string | null; name: string; tenantId?: string },
  id: string,
  to: PurchaseOrderStatus,
  extra?: { track?: string; reason?: string },
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
  // Declining an order (supplier cancelling) must carry a reason.
  const declining = side === 'supplier' && to === 'cancelled';
  if (declining && !(extra?.reason ?? '').trim())
    throw new SupplierError('INVALID', 'A reason is required to decline an order');
  // The supplier's step still lands in the salon's audit trail — the
  // write needs the order's tenant context inside this transaction.
  if (side === 'supplier')
    await sql`select set_config('app.tenant_id', ${o.tenantId}, true)`.execute(trx);
  await trx
    .updateTable('purchaseOrders')
    .set({
      status: to,
      ...(extra?.track !== undefined ? { track: extra.track } : {}),
      ...(declining ? { supplierNote: extra!.reason!.trim() } : {}),
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
    ...(declining ? { reason: extra!.reason!.trim() } : {}),
  });
  // Reaching 'submitted' from an internal-approval draft notifies the
  // supplier, exactly like a direct submit.
  if (side === 'salon' && to === 'submitted') await notifyOrderSubmitted(trx, id);
  // The supplier's steps the salon waits for (Alex, 2026-10-06).
  if (side === 'supplier' && (to === 'accepted' || to === 'shipped' || to === 'cancelled'))
    await notifyOrderStep(trx, id, to, extra?.reason);
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
  // Delivered is invoiced (Alex, 2026-10-06): the number is given here,
  // once, so both sides open the same document from this moment on.
  if (complete) await ensureInvoiceNo(trx, id);
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
  // Receiving is the salon marking the order finished (or short): the
  // supplier hears which (Alex, 2026-10-06).
  await notifyOrderReceived(trx, id, complete);
  return toOrderContract(trx, id);
}
