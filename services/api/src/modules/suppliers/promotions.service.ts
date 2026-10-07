import type { SalonPromotion } from '@velnes/contracts';
import { daysBetween, promotionStatus } from '@velnes/contracts';
import type { Trx } from '../../db/index.js';
import { localIso } from '../scheduling/scheduling.service.js';

/**
 * Promotions as a salon sees them (2026-10-07) — docs/SUPPLIERS.md.
 *
 * Only connected suppliers, only promotions that are active and have
 * not ended, each with its products named and the reasons it may
 * matter to THIS salon: it carries one of the products (its own catalog
 * links to the supplier's), it has ordered one before, the offer ends
 * within a week, the offer started within a week. The flight deck's
 * picks are the same list ranked by those reasons and cut short; one
 * function, so the deck and the tab never disagree.
 */
const WEIGHT: Record<SalonPromotion['reasons'][number], number> = { carry: 3, ordered_before: 2, ending_soon: 1, new: 1 };

export async function salonPromotions(trx: Trx, tenantId: string, today = localIso(new Date())): Promise<SalonPromotion[]> {
  const rows = await trx
    .selectFrom('supplierPromotions as p')
    .innerJoin('suppliers as s', 's.id', 'p.supplierId')
    .innerJoin('supplierConnections as c', (j) => j.onRef('c.supplierId', '=', 'p.supplierId').on('c.tenantId', '=', tenantId).on('c.status', '=', 'connected'))
    .selectAll('p')
    .select('s.name as supplierName')
    .where('p.active', '=', true)
    .where('p.ends', '>=', new Date(today))
    .orderBy('p.ends')
    .execute();
  if (!rows.length) return [];
  const ids = [...new Set(rows.flatMap((r) => r.productIds))];
  const products = ids.length
    ? await trx.selectFrom('supplierProducts').select(['id', 'name', 'buy']).where('id', 'in', ids).execute()
    : [];
  const carried = new Set(
    ids.length ? (await trx.selectFrom('products').select('supplierProductId').where('supplierProductId', 'in', ids).execute()).map((r) => r.supplierProductId) : [],
  );
  const ordered = new Set(
    ids.length
      ? (
          await trx
            .selectFrom('purchaseOrderLines as l')
            .innerJoin('purchaseOrders as o', 'o.id', 'l.orderId')
            .select('l.supplierProductId')
            .where('o.tenantId', '=', tenantId)
            .where('l.supplierProductId', 'in', ids)
            .execute()
        ).map((r) => r.supplierProductId)
      : [],
  );
  const list = rows.map((p): SalonPromotion => {
    const starts = localIso(p.starts);
    const ends = localIso(p.ends);
    const prods = p.productIds.map((id) => products.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x);
    const reasons: SalonPromotion['reasons'] = [];
    if (prods.some((x) => carried.has(x.id))) reasons.push('carry');
    if (prods.some((x) => ordered.has(x.id))) reasons.push('ordered_before');
    const daysLeft = daysBetween(today, ends);
    if (daysLeft <= 7) reasons.push('ending_soon');
    if (daysBetween(starts, today) <= 7 && daysBetween(starts, today) >= 0) reasons.push('new');
    return {
      id: p.id,
      supplierId: p.supplierId,
      supplierName: p.supplierName,
      brand: p.brand,
      title: p.title,
      kind: p.kind,
      productIds: p.productIds,
      starts,
      ends,
      minOrder: p.minOrder,
      usageLimit: p.usageLimit,
      terms: p.terms,
      audience: p.audience,
      value: p.value,
      per: p.per,
      active: p.active,
      status: promotionStatus({ active: p.active, starts, ends }, today),
      products: prods.map((x) => ({ id: x.id, name: x.name, buy: x.buy, carried: carried.has(x.id) })),
      reasons,
      daysLeft,
    };
  });
  const score = (p: SalonPromotion) => p.reasons.reduce((n, r) => n + WEIGHT[r], 0) + (p.status === 'running' ? 0.5 : 0);
  return list.sort((a, b) => score(b) - score(a) || a.ends.localeCompare(b.ends));
}
