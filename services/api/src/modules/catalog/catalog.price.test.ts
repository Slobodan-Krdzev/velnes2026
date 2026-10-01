import { API_PREFIX } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';

/**
 * A price edited in the catalog panel is saved where it is read (Alex,
 * 2026-10-01): the location rows that still mirrored the salon-wide
 * price follow the new one; a location's own, different price stays.
 */
const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
let H: Record<string, string> = {};
const get = async (url: string) => (await app.inject({ method: 'GET', url: `${API_PREFIX}${url}`, headers: H })).json();
const configOf = async (loc: string, kind: 'services' | 'products', id: string) =>
  ((await get(`/locations/${loc}/catalog`))[kind] as { id: string; config: { price: number; durationMin?: number; active: boolean } }[]).find((x) => x.id === id)!.config;

describe('catalog price edits reach the location rows', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    const tok = (await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email: 'maria@velnes.mk', password: 'velnes-demo' } })).json().accessToken as string;
    H = { authorization: `Bearer ${tok}`, 'content-type': 'application/json' };
  });
  afterAll(async () => {
    // Back to the seed's numbers.
    await admin.query(`UPDATE services SET price = 1800, duration_min = 45 WHERE id = $1`, [demo.s1]);
    await admin.query(`UPDATE location_catalog_services SET price = 1800, duration_min = 45 WHERE service_id = $1`, [demo.s1]);
    await admin.query(`UPDATE products SET price = 1200, active = true WHERE id = $1`, [demo.p1]);
    await admin.query(`UPDATE location_catalog_products SET price = 1200, active = true WHERE product_id = $1`, [demo.p1]);
    await admin.query(`DELETE FROM audit_log WHERE action = 'Price changed' AND ts > now() - interval '5 minutes'`);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('a service: rows mirroring the old price follow, a location’s own price stays, and so for the duration', async () => {
    // Aerodrom sets its own price first.
    const over = await app.inject({ method: 'PATCH', url: `${API_PREFIX}/locations/${demo.locAerodrom}/catalog/services/${demo.s1}`, headers: H, payload: { price: 1700 } });
    expect(over.statusCode).toBe(200);
    // The panel's write, built the way the panel builds it: from the
    // location catalog's service, its variants and option groups kept.
    type Full = { name: string; category: string | null; vat: number; status: string; pos: boolean; online: boolean; prepMin: number | null; resetMin: number | null; variants: { id: string; label: string; durationMin: number; price: number; std: boolean }[]; modifiers: { id: string; name: string; type: string; required: boolean; options: { id: string; name: string; price: number; durationMin: number }[] }[] };
    const full = ((await get(`/locations/${demo.locCentar}/catalog`)).services as ({ id: string } & Full)[]).find((x) => x.id === demo.s1)!;
    const put = await app.inject({
      method: 'PUT',
      url: `${API_PREFIX}/services/${demo.s1}`,
      headers: H,
      payload: {
        name: full.name, category: full.category, durationMin: 50, price: 1900, vat: full.vat, status: full.status, pos: full.pos, online: full.online,
        prepMin: full.prepMin, resetMin: full.resetMin, performerIds: null,
        variants: full.variants.map((v) => ({ id: v.id, label: v.label, durationMin: v.durationMin, price: v.price, std: v.std })),
        modifiers: full.modifiers.map((g) => ({ id: g.id, name: g.name, type: g.type, required: g.required, options: g.options.map((o) => ({ id: o.id, name: o.name, price: o.price, durationMin: o.durationMin })) })),
      },
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(await configOf(demo.locCentar, 'services', demo.s1)).toMatchObject({ price: 1900, durationMin: 50 });
    expect(await configOf(demo.locAerodrom, 'services', demo.s1)).toMatchObject({ price: 1700, durationMin: 50 });
    const rows = await admin.query(`SELECT price FROM services WHERE id = $1`, [demo.s1]);
    expect(rows.rows[0].price).toBe(1900);
  });

  it('a product: every shelf row follows the price — even one left behind by the old bug — and the active flag', async () => {
    const before = await configOf(demo.locCentar, 'products', demo.p1);
    expect(before.price).toBe(1200);
    // A shelf row that drifted (the salon-wide price was edited while
    // the rows stayed): it follows too — a product is priced once.
    await admin.query(`UPDATE location_catalog_products SET price = 999 WHERE product_id = $1 AND location_id = $2`, [demo.p1, demo.locAerodrom]);
    const put = await app.inject({ method: 'PUT', url: `${API_PREFIX}/products/${demo.p1}`, headers: H, payload: { name: 'Resistance band set', category: 'Home exercise', sku: 'VEL-BND-SET', vat: 18, price: 1300, active: true } });
    expect(put.statusCode, put.body).toBe(200);
    expect((await configOf(demo.locCentar, 'products', demo.p1)).price).toBe(1300);
    expect((await configOf(demo.locAerodrom, 'products', demo.p1)).price).toBe(1300);
    const off = await app.inject({ method: 'PUT', url: `${API_PREFIX}/products/${demo.p1}`, headers: H, payload: { name: 'Resistance band set', category: 'Home exercise', sku: 'VEL-BND-SET', vat: 18, price: 1300, active: false } });
    expect(off.statusCode).toBe(200);
    expect((await configOf(demo.locCentar, 'products', demo.p1)).active).toBe(false);
  });
});
