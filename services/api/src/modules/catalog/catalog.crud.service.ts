import type { AccessClaims } from '@velnes/contracts';
import type { Trx } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';
import { CatalogError } from './catalog.service.js';

/**
 * Catalog writes. Price changes are audited (before/after) through
 * the one audit door, in the same transaction as the change.
 */

export interface ServiceWrite {
  name: string;
  category?: string | null | undefined;
  durationMin: number;
  price: number;
  vat?: number | undefined;
  status?: 'active' | 'draft' | undefined;
  pos?: boolean | undefined;
  online?: boolean | undefined;
  prepMin?: number | null | undefined;
  resetMin?: number | null | undefined;
  variants?:
    | { id?: string | undefined; label: string; durationMin: number; price: number; std?: boolean | undefined }[]
    | undefined;
  modifiers?:
    | {
        id?: string | undefined;
        name: string;
        type: 'single' | 'multi';
        required?: boolean | undefined;
        options: { id?: string | undefined; name: string; price: number; durationMin?: number | undefined }[];
      }[]
    | undefined;
}

async function categoryId(
  trx: Trx,
  tenantId: string,
  table: 'serviceCategories' | 'productCategories',
  name: string | null | undefined,
): Promise<string | null> {
  if (!name) return null;
  const existing = await trx
    .selectFrom(table)
    .select('id')
    .where('name', '=', name)
    .executeTakeFirst();
  if (existing) return existing.id;
  const row = await trx
    .insertInto(table)
    .values({ tenantId, name })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function actorName(trx: Trx, claims: AccessClaims) {
  const e = await trx
    .selectFrom('employees')
    .select('name')
    .where('id', '=', claims.sub)
    .executeTakeFirst();
  return e?.name ?? 'Unknown';
}

export async function createService(trx: Trx, claims: AccessClaims, w: ServiceWrite) {
  const tenantId = claims.ten;
  const catId = await categoryId(trx, tenantId, 'serviceCategories', w.category);
  const s = await trx
    .insertInto('services')
    .values({
      tenantId,
      name: w.name,
      categoryId: catId,
      durationMin: w.durationMin,
      price: w.price,
      vat: w.vat ?? 18,
      status: w.status ?? 'active',
      pos: w.pos ?? true,
      online: w.online ?? true,
      prepMin: w.prepMin ?? null,
      resetMin: w.resetMin ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await reconcileNested(trx, tenantId, s.id, w);
  await logAudit(trx, tenantId, {
    actorEmployeeId: claims.sub,
    actorName: await actorName(trx, claims),
    action: 'Service created',
    object: `Service · ${w.name}`,
    after: `${w.price} ден · ${w.durationMin} min`,
  });
  return s.id;
}

export async function updateService(
  trx: Trx,
  claims: AccessClaims,
  serviceId: string,
  w: ServiceWrite,
) {
  const before = await trx
    .selectFrom('services')
    .selectAll()
    .where('id', '=', serviceId)
    .executeTakeFirst();
  if (!before) throw new CatalogError('NOT_FOUND', 'Unknown service');
  const tenantId = before.tenantId;
  const catId = await categoryId(trx, tenantId, 'serviceCategories', w.category);
  await trx
    .updateTable('services')
    .set({
      name: w.name,
      categoryId: catId,
      durationMin: w.durationMin,
      price: w.price,
      vat: w.vat ?? before.vat,
      status: w.status ?? before.status,
      pos: w.pos ?? before.pos,
      online: w.online ?? before.online,
      prepMin: w.prepMin === undefined ? before.prepMin : w.prepMin,
      resetMin: w.resetMin === undefined ? before.resetMin : w.resetMin,
    })
    .where('id', '=', serviceId)
    .execute();
  await reconcileNested(trx, tenantId, serviceId, w);
  if (before.price !== w.price)
    await logAudit(trx, tenantId, {
      actorEmployeeId: claims.sub,
      actorName: await actorName(trx, claims),
      action: 'Price changed',
      object: `Service · ${before.name}`,
      before: `${before.price} ден`,
      after: `${w.price} ден`,
    });
}

/** Reconcile variants/modifiers by id: update kept, insert new,
 *  delete missing. Only applied when the arrays are present. */
async function reconcileNested(trx: Trx, tenantId: string, serviceId: string, w: ServiceWrite) {
  if (w.variants) {
    const existing = await trx
      .selectFrom('serviceVariants')
      .select('id')
      .where('serviceId', '=', serviceId)
      .execute();
    const keep = new Set(w.variants.map((v) => v.id).filter(Boolean) as string[]);
    const drop = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
    if (drop.length)
      await trx.deleteFrom('serviceVariants').where('id', 'in', drop).execute();
    let sort = 0;
    for (const v of w.variants) {
      if (v.id) {
        await trx
          .updateTable('serviceVariants')
          .set({ label: v.label, durationMin: v.durationMin, price: v.price, std: v.std ?? false, sort })
          .where('id', '=', v.id)
          .where('serviceId', '=', serviceId)
          .execute();
      } else {
        await trx
          .insertInto('serviceVariants')
          .values({ tenantId, serviceId, label: v.label, durationMin: v.durationMin, price: v.price, std: v.std ?? false, sort })
          .execute();
      }
      sort++;
    }
  }
  if (w.modifiers) {
    const existing = await trx
      .selectFrom('serviceModifierGroups')
      .select('id')
      .where('serviceId', '=', serviceId)
      .execute();
    const keep = new Set(w.modifiers.map((g) => g.id).filter(Boolean) as string[]);
    const drop = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
    if (drop.length)
      await trx.deleteFrom('serviceModifierGroups').where('id', 'in', drop).execute();
    let gsort = 0;
    for (const g of w.modifiers) {
      let gid = g.id;
      if (gid) {
        await trx
          .updateTable('serviceModifierGroups')
          .set({ name: g.name, type: g.type, required: g.required ?? false, sort: gsort })
          .where('id', '=', gid)
          .where('serviceId', '=', serviceId)
          .execute();
      } else {
        const row = await trx
          .insertInto('serviceModifierGroups')
          .values({ tenantId, serviceId, name: g.name, type: g.type, required: g.required ?? false, sort: gsort })
          .returning('id')
          .executeTakeFirstOrThrow();
        gid = row.id;
      }
      gsort++;
      const exOpts = await trx
        .selectFrom('serviceModifierOptions')
        .select('id')
        .where('groupId', '=', gid)
        .execute();
      const keepO = new Set(g.options.map((o) => o.id).filter(Boolean) as string[]);
      const dropO = exOpts.filter((e) => !keepO.has(e.id)).map((e) => e.id);
      if (dropO.length)
        await trx.deleteFrom('serviceModifierOptions').where('id', 'in', dropO).execute();
      let osort = 0;
      for (const o of g.options) {
        if (o.id) {
          await trx
            .updateTable('serviceModifierOptions')
            .set({ name: o.name, price: o.price, durationMin: o.durationMin ?? 0, sort: osort })
            .where('id', '=', o.id)
            .where('groupId', '=', gid)
            .execute();
        } else {
          await trx
            .insertInto('serviceModifierOptions')
            .values({ tenantId, groupId: gid, name: o.name, price: o.price, durationMin: o.durationMin ?? 0, sort: osort })
            .execute();
        }
        osort++;
      }
    }
  }
}

export async function patchServiceOverride(
  trx: Trx,
  claims: AccessClaims,
  locationId: string,
  serviceId: string,
  patch: {
    active?: boolean | undefined;
    price?: number | undefined;
    durationMin?: number | undefined;
    online?: boolean | undefined;
    pos?: boolean | undefined;
    prepMin?: number | null | undefined;
    resetMin?: number | null | undefined;
  },
) {
  const s = await trx
    .selectFrom('services')
    .selectAll()
    .where('id', '=', serviceId)
    .executeTakeFirst();
  if (!s) throw new CatalogError('NOT_FOUND', 'Unknown service');
  const current = await trx
    .selectFrom('locationCatalogServices')
    .selectAll()
    .where('locationId', '=', locationId)
    .where('serviceId', '=', serviceId)
    .executeTakeFirst();
  const next = {
    active: patch.active ?? current?.active ?? s.status !== 'draft',
    price: patch.price ?? current?.price ?? s.price,
    durationMin: patch.durationMin ?? current?.durationMin ?? s.durationMin,
    online: patch.online ?? current?.online ?? s.online,
    pos: patch.pos ?? current?.pos ?? s.pos,
    prepMin: patch.prepMin === undefined ? (current?.prepMin ?? null) : patch.prepMin,
    resetMin: patch.resetMin === undefined ? (current?.resetMin ?? null) : patch.resetMin,
  };
  await trx
    .insertInto('locationCatalogServices')
    .values({ tenantId: s.tenantId, locationId, serviceId, ...next })
    .onConflict((oc) => oc.columns(['locationId', 'serviceId']).doUpdateSet(next))
    .execute();
  const beforePrice = current?.price ?? s.price;
  if (patch.price !== undefined && patch.price !== beforePrice) {
    const loc = await trx
      .selectFrom('locations')
      .select('name')
      .where('id', '=', locationId)
      .executeTakeFirst();
    await logAudit(trx, s.tenantId, {
      actorEmployeeId: claims.sub,
      actorName: await actorName(trx, claims),
      action: 'Price changed',
      object: `Service · ${s.name}`,
      locationName: loc?.name ?? '—',
      before: `${beforePrice} ден`,
      after: `${patch.price} ден`,
    });
  }
}

export async function patchVariantOverride(
  trx: Trx,
  _claims: AccessClaims,
  locationId: string,
  variantId: string,
  patch: { active?: boolean | undefined; price?: number | null | undefined; durationMin?: number | null | undefined },
) {
  const v = await trx
    .selectFrom('serviceVariants')
    .select(['id', 'tenantId'])
    .where('id', '=', variantId)
    .executeTakeFirst();
  if (!v) throw new CatalogError('NOT_FOUND', 'Unknown variant');
  const current = await trx
    .selectFrom('locationCatalogVariants')
    .selectAll()
    .where('locationId', '=', locationId)
    .where('variantId', '=', variantId)
    .executeTakeFirst();
  const next = {
    active: patch.active ?? current?.active ?? true,
    price: patch.price === undefined ? (current?.price ?? null) : patch.price,
    durationMin:
      patch.durationMin === undefined ? (current?.durationMin ?? null) : patch.durationMin,
  };
  await trx
    .insertInto('locationCatalogVariants')
    .values({ tenantId: v.tenantId, locationId, variantId, ...next })
    .onConflict((oc) => oc.columns(['locationId', 'variantId']).doUpdateSet(next))
    .execute();
}

export interface ProductWrite {
  name: string;
  category?: string | null | undefined;
  sku?: string | null | undefined;
  price?: number | undefined;
  cost?: number | null | undefined;
  vat?: number | undefined;
  active?: boolean | undefined;
  own?: boolean | undefined;
  sellerLegalEntityId?: string | null | undefined;
}

export async function createProduct(trx: Trx, claims: AccessClaims, w: ProductWrite) {
  const tenantId = claims.ten;
  const catId = await categoryId(trx, tenantId, 'productCategories', w.category);
  const row = await trx
    .insertInto('products')
    .values({
      tenantId,
      name: w.name,
      categoryId: catId,
      sku: w.sku ?? null,
      price: w.price ?? 0,
      cost: w.cost ?? null,
      vat: w.vat ?? 18,
      active: w.active ?? true,
      own: w.own ?? false,
      sellerLegalEntityId: w.sellerLegalEntityId ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function updateProduct(
  trx: Trx,
  claims: AccessClaims,
  productId: string,
  w: ProductWrite,
) {
  const before = await trx
    .selectFrom('products')
    .selectAll()
    .where('id', '=', productId)
    .executeTakeFirst();
  if (!before) throw new CatalogError('NOT_FOUND', 'Unknown product');
  const catId = await categoryId(trx, before.tenantId, 'productCategories', w.category);
  await trx
    .updateTable('products')
    .set({
      name: w.name,
      categoryId: catId,
      sku: w.sku === undefined ? before.sku : w.sku,
      price: w.price ?? before.price,
      cost: w.cost === undefined ? before.cost : w.cost,
      vat: w.vat ?? before.vat,
      active: w.active ?? before.active,
      sellerLegalEntityId:
        w.sellerLegalEntityId === undefined ? before.sellerLegalEntityId : w.sellerLegalEntityId,
    })
    .where('id', '=', productId)
    .execute();
  if (w.price !== undefined && w.price !== before.price)
    await logAudit(trx, before.tenantId, {
      actorEmployeeId: claims.sub,
      actorName: await actorName(trx, claims),
      action: 'Price changed',
      object: `Product · ${before.name}`,
      before: `${before.price} ден`,
      after: `${w.price} ден`,
    });
}
