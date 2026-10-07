import { sql } from 'kysely';
import type { Trx } from '../../db/index.js';

/**
 * Brands a supplier carries (Alex, 2026-10-07) — docs/SUPPLIERS.md.
 *
 * A brand is a platform row. HQ creates some; a supplier creates one by
 * naming it on a product. `ensureBrand` is the one door for the latter:
 * it finds the brand case-insensitively (and returns its canonical
 * spelling), creates it in the supplier's name when it is new, links the
 * supplier as carrying it, and rings HQ's bell once for a new brand —
 * a note that it happened, not a request for approval.
 */
export async function ensureBrand(trx: Trx, supplierId: string, rawName: string): Promise<{ name: string; created: boolean }> {
  const name = rawName.trim().replace(/\s+/g, ' ');
  if (!name) return { name: '', created: false };
  // One supplier, one brand name at a time: two panels saving the same new name serialise here.
  await sql`SELECT pg_advisory_xact_lock(hashtext(${`brand:${name.toLowerCase()}`}))`.execute(trx);
  let brand = await trx
    .selectFrom('brands')
    .select(['id', 'name'])
    .where(sql`lower(name)`, '=', name.toLowerCase())
    .executeTakeFirst();
  let created = false;
  if (!brand) {
    brand = await trx
      .insertInto('brands')
      .values({ name, source: 'supplier', addedBySupplierId: supplierId })
      .returning(['id', 'name'])
      .executeTakeFirstOrThrow();
    created = true;
  }
  await trx
    .insertInto('supplierBrands')
    .values({ supplierId, brandId: brand.id })
    .onConflict((oc) => oc.columns(['supplierId', 'brandId']).doNothing())
    .execute();
  if (created) {
    const sup = await trx.selectFrom('suppliers').select('name').where('id', '=', supplierId).executeTakeFirst();
    await trx
      .insertInto('platformNotices')
      .values({
        audience: 'hq',
        kind: 'brand_added',
        title: `New brand: ${brand.name}`,
        body: `${sup?.name ?? 'A supplier'} added the brand "${brand.name}" from its product panel. It is now offered to every supplier.`,
        refId: brand.id,
      })
      .execute();
  }
  return { name: brand.name, created };
}

/** Every brand, the supplier's own first, then the rest by name. */
export async function brandsFor(trx: Trx, supplierId: string): Promise<{ name: string; carried: boolean }[]> {
  const rows = await trx
    .selectFrom('brands as b')
    .leftJoin('supplierBrands as sb', (join) => join.onRef('sb.brandId', '=', 'b.id').on('sb.supplierId', '=', supplierId))
    .select(['b.name', 'sb.supplierId as carriedBy'])
    .orderBy('b.name')
    .execute();
  return rows
    .map((r) => ({ name: r.name, carried: r.carriedBy !== null }))
    .sort((a, b) => Number(b.carried) - Number(a.carried) || a.name.localeCompare(b.name));
}
