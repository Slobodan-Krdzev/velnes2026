import type { AccessClaims, ProductPromotion, ProductPromotionWrite } from '@velnes/contracts';
import { productPromoStatus } from '@velnes/contracts';
import type { Trx } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';
import { localIso } from '../scheduling/scheduling.service.js';
import { CatalogError } from './catalog.service.js';

/**
 * Product promotions (2026-10-07) — docs/CATALOG.md. One live-or-
 * scheduled promotion per product; a new one is refused while one is
 * live (end it first); ending early is a step with its own stamp, never
 * a delete. Every write is audited with before/after.
 */
async function actorName(trx: Trx, id: string | null) {
  if (!id) return '';
  return (await trx.selectFrom('employees').select('name').where('id', '=', id).executeTakeFirst())?.name ?? '';
}
const describe = (p: { kind: string; value: number; starts: string; ends: string }) => `${p.kind === 'pct' ? `${p.value}% off` : `${p.value} MKD`} · ${p.starts} → ${p.ends}`;

export async function listPromotions(trx: Trx, productId: string): Promise<ProductPromotion[]> {
  const today = localIso(new Date());
  const rows = await trx.selectFrom('productPromotions').selectAll().where('productId', '=', productId).orderBy('createdAt', 'desc').limit(50).execute();
  return rows.map((r) => {
    const starts = localIso(r.starts);
    const ends = localIso(r.ends);
    return {
      id: r.id,
      productId: r.productId,
      kind: r.kind as 'pct' | 'price',
      value: r.value,
      starts,
      ends,
      active: r.active,
      status: productPromoStatus({ active: r.active, starts, ends }, today),
      note: r.note,
      createdBy: { id: r.createdBy, name: r.createdByName },
      createdAt: r.createdAt.toISOString(),
      endedAt: r.endedAt ? r.endedAt.toISOString() : null,
    };
  });
}

export async function createPromotion(trx: Trx, claims: AccessClaims, productId: string, w: ProductPromotionWrite): Promise<ProductPromotion> {
  const p = await trx.selectFrom('products').select(['id', 'name', 'price', 'own']).where('id', '=', productId).executeTakeFirst();
  if (!p) throw new CatalogError('NOT_FOUND', 'Unknown product');
  if (p.own) throw new CatalogError('REFUSED', `${p.name} is for own use — it is not sold, so it cannot be on promotion`);
  if (w.ends < localIso(new Date())) throw new CatalogError('REFUSED', 'The promotion would already be over');
  if (w.kind === 'price' && w.value >= p.price) throw new CatalogError('REFUSED', `A promo price must be below the regular price (${p.price} MKD)`);
  const live = await trx.selectFrom('productPromotions').select(['id', 'ends']).where('productId', '=', productId).where('active', '=', true).executeTakeFirst();
  if (live && localIso(live.ends) >= localIso(new Date()))
    throw new CatalogError('CONFLICT', `${p.name} already has a promotion running or scheduled — end it first`);
  if (live) await trx.updateTable('productPromotions').set({ active: false, endedAt: new Date() }).where('id', '=', live.id).execute(); // a stale row past its end
  const name = await actorName(trx, claims.sub);
  const row = await trx
    .insertInto('productPromotions')
    .values({ tenantId: claims.ten, productId, kind: w.kind, value: w.value, starts: new Date(w.starts), ends: new Date(w.ends), note: w.note, createdBy: claims.sub, createdByName: name })
    .returning('id')
    .executeTakeFirstOrThrow();
  await logAudit(trx, claims.ten, { actorEmployeeId: claims.sub, actorName: name, action: 'Promotion created', object: `Product · ${p.name}`, before: '—', after: describe(w) });
  return (await listPromotions(trx, productId)).find((x) => x.id === row.id)!;
}

export async function endPromotion(trx: Trx, claims: AccessClaims, productId: string, id: string): Promise<ProductPromotion> {
  const r = await trx.selectFrom('productPromotions').selectAll().where('id', '=', id).where('productId', '=', productId).executeTakeFirst();
  if (!r) throw new CatalogError('NOT_FOUND', 'Unknown promotion');
  if (!r.active) throw new CatalogError('REFUSED', 'This promotion has already ended');
  const p = await trx.selectFrom('products').select('name').where('id', '=', productId).executeTakeFirstOrThrow();
  const name = await actorName(trx, claims.sub);
  await trx.updateTable('productPromotions').set({ active: false, endedAt: new Date() }).where('id', '=', id).execute();
  await logAudit(trx, claims.ten, {
    actorEmployeeId: claims.sub,
    actorName: name,
    action: 'Promotion ended',
    object: `Product · ${p.name}`,
    before: describe({ kind: r.kind, value: r.value, starts: localIso(r.starts), ends: localIso(r.ends) }),
    after: `ended early on ${localIso(new Date())}`,
  });
  return (await listPromotions(trx, productId)).find((x) => x.id === id)!;
}
