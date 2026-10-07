import { API_PREFIX, LocationCatalogResponseSchema, ProductPromotionSchema, promoPrice } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';

/**
 * Product promotions (2026-10-07) — docs/CATALOG.md. One rule for the
 * effective price, applied by the resolver every seller uses: the
 * catalog screen, the till, the public salon page and its paged
 * products door. One live promotion per product; ending early is a
 * step; everything audited.
 */
const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
let maria = '';
let ana = '';
let n = 0;
const key = () => `promo-${Date.now()}-${++n}`;
const started = new Date();
const today = new Date().toISOString().slice(0, 10);
const plus = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

const login = async (email: string) =>
  (await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email, password: 'velnes-demo' } })).json().accessToken as string;
const call = (token: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url: `${API_PREFIX}${url}`, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
const promos = async (pid: string) => (await call(maria, 'GET', `/products/${pid}/promotions`)).json() as { promotions: { id: string; status: string; active: boolean }[] };
const regularOf = async (pid: string) => Number((await admin.query(`SELECT price FROM products WHERE id=$1`, [pid])).rows[0].price);

describe('product promotions', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    maria = await login('maria@velnes.mk');
    ana = await login('ana@velnes.mk');
  });
  afterAll(async () => {
    await admin.query(`DELETE FROM product_promotions WHERE created_at >= $1`, [started]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('the effective-price rule: a percentage rounds half-up to a denar, a promo price never exceeds the regular one', () => {
    expect(promoPrice(1200, { kind: 'pct', value: 10 })).toBe(1080);
    expect(promoPrice(1250, { kind: 'pct', value: 15 })).toBe(1063); // 1062.5 → 1063
    expect(promoPrice(1200, { kind: 'price', value: 990 })).toBe(990);
    expect(promoPrice(1200, { kind: 'price', value: 5000 })).toBe(1200);
    expect(promoPrice(1200, null)).toBe(1200);
  });

  it('a percentage promotion on a product: the catalog shows it, the till charges it, the salon page lists it first with the regular price beside it, and the sale ledger reads the promo price', async () => {
    const regular = await regularOf(demo.p1);
    const res = await call(maria, 'POST', `/products/${demo.p1}/promotions`, { kind: 'pct', value: 10, starts: today, ends: plus(7), note: 'Autumn' });
    expect(res.statusCode, res.body).toBe(200);
    const promo = ProductPromotionSchema.parse(res.json());
    expect(promo).toMatchObject({ kind: 'pct', value: 10, status: 'running', active: true, note: 'Autumn' });
    expect(promo.createdBy.name).toBe('Maria Petrovska');
    const expected = promoPrice(regular, { kind: 'pct', value: 10 });
    try {
      // The catalog screen: regular price in the config, the promo beside it.
      const cat = LocationCatalogResponseSchema.parse((await call(maria, 'GET', `/locations/${demo.locAerodrom}/catalog`)).json());
      const row = cat.products.find((p) => p.id === demo.p1)!;
      expect(row.promo).toMatchObject({ id: promo.id, kind: 'pct', value: 10 });
      expect(row.promoPrice).toBe(expected);
      // The till charges the promo price — the line's own amount says so.
      const sale = await call(maria, 'POST', '/sales', { key: key(), locationId: demo.locAerodrom, method: 'Cash', lines: [{ kind: 'product', productId: demo.p1, qty: 2 }] });
      expect(sale.statusCode, sale.body).toBe(200);
      const lines = (await admin.query(`SELECT unit_price, amount FROM invoice_lines WHERE invoice_id=$1`, [sale.json().invoice.id])).rows;
      expect(Number(lines[0].unit_price)).toBe(expected);
      expect(Number(lines[0].amount)).toBe(expected * 2);
      // The public salon page: promo first, promo price with the regular one crossed out.
      const pub = (await app.inject({ method: 'GET', url: `${API_PREFIX}/public/discovery/salons/velnes-fizio` })).json() as {
        products: { id: string; promo: { kind: string; value: number } | null; at: { locationId: string; price: number; regularPrice?: number }[] }[];
        productsTotal: number;
      };
      expect(pub.products[0]!.id).toBe(demo.p1);
      expect(pub.products[0]!.promo).toMatchObject({ kind: 'pct', value: 10 });
      const here = pub.products[0]!.at.find((a) => a.locationId === demo.locAerodrom)!;
      expect(here.price).toBe(expected);
      expect(here.regularPrice).toBe(regular);
      expect(pub.products.length).toBeLessThanOrEqual(12);
      expect(pub.productsTotal).toBeGreaterThanOrEqual(pub.products.length);
      // The paged door: searched by name, promo first, the same prices.
      const paged = (await app.inject({ method: 'GET', url: `${API_PREFIX}/public/discovery/salons/velnes-fizio/products?q=band&page=1&limit=12` })).json() as { products: { id: string; name: string }[]; total: number; page: number; limit: number };
      expect(paged.products.every((p) => /band/i.test(p.name))).toBe(true);
      expect(paged.products.some((p) => p.id === demo.p1)).toBe(true);
      const all = (await app.inject({ method: 'GET', url: `${API_PREFIX}/public/discovery/salons/velnes-fizio/products?limit=2&page=1` })).json() as { products: { id: string }[]; total: number };
      expect(all.products).toHaveLength(Math.min(2, all.total));
      expect(all.products[0]!.id).toBe(demo.p1);
      const page2 = (await app.inject({ method: 'GET', url: `${API_PREFIX}/public/discovery/salons/velnes-fizio/products?limit=2&page=2` })).json() as { products: { id: string }[] };
      expect(page2.products.some((p) => p.id === demo.p1)).toBe(false);
      // One at a time: a second promotion is refused until this one ends.
      const twice = await call(maria, 'POST', `/products/${demo.p1}/promotions`, { kind: 'price', value: 100, starts: today, ends: plus(3) });
      expect(twice.statusCode).toBe(409);
      // Ending early: the regular price is back, the history keeps the row.
      const ended = await call(maria, 'POST', `/products/${demo.p1}/promotions/${promo.id}/end`, {});
      expect(ended.statusCode, ended.body).toBe(200);
      expect(ProductPromotionSchema.parse(ended.json())).toMatchObject({ status: 'ended', active: false });
      expect(ProductPromotionSchema.parse(ended.json()).endedAt).toBeTruthy();
      const after = LocationCatalogResponseSchema.parse((await call(maria, 'GET', `/locations/${demo.locAerodrom}/catalog`)).json()).products.find((p) => p.id === demo.p1)!;
      expect(after.promo).toBeNull();
      expect((await promos(demo.p1)).promotions.find((p) => p.id === promo.id)?.status).toBe('ended');
      expect((await call(maria, 'POST', `/products/${demo.p1}/promotions/${promo.id}/end`, {})).statusCode).toBe(422);
      const audit = await admin.query(`SELECT action FROM audit_log WHERE tenant_id=$1 AND object=$2 AND ts >= $3 ORDER BY ts`, [demo.business, 'Product · Resistance band set', started]);
      expect(audit.rows.map((r) => r.action)).toEqual(['Promotion created', 'Promotion ended']);
    } finally {
      await admin.query(`UPDATE product_promotions SET active=false, ended_at=now() WHERE product_id=$1 AND active`, [demo.p1]);
    }
  });

  it('a promo price must be below the regular price; a scheduled promotion does not price yet; own-use products cannot be promoted; the right is catalog.edit', async () => {
    const regular = await regularOf(demo.p2);
    expect((await call(maria, 'POST', `/products/${demo.p2}/promotions`, { kind: 'price', value: regular, starts: today, ends: plus(2) })).statusCode).toBe(422);
    expect((await call(maria, 'POST', `/products/${demo.p2}/promotions`, { kind: 'pct', value: 95, starts: today, ends: plus(2) })).statusCode).toBe(400);
    expect((await call(maria, 'POST', `/products/${demo.p2}/promotions`, { kind: 'pct', value: 10, starts: plus(2), ends: plus(1) })).statusCode).toBe(400);
    const scheduled = await call(maria, 'POST', `/products/${demo.p2}/promotions`, { kind: 'price', value: regular - 100, starts: plus(3), ends: plus(10) });
    expect(scheduled.statusCode, scheduled.body).toBe(200);
    expect(ProductPromotionSchema.parse(scheduled.json()).status).toBe('scheduled');
    try {
      const cat = LocationCatalogResponseSchema.parse((await call(maria, 'GET', `/locations/${demo.locAerodrom}/catalog`)).json());
      expect(cat.products.find((p) => p.id === demo.p2)!.promo).toBeNull(); // not yet
      const own = (await admin.query(`SELECT id FROM products WHERE tenant_id=$1 AND own LIMIT 1`, [demo.business])).rows[0]?.id as string | undefined;
      if (own) expect((await call(maria, 'POST', `/products/${own}/promotions`, { kind: 'pct', value: 10, starts: today, ends: plus(2) })).statusCode).toBe(422);
      expect((await call(ana, 'POST', `/products/${demo.p2}/promotions`, { kind: 'pct', value: 10, starts: today, ends: plus(2) })).statusCode).toBe(403);
    } finally {
      await admin.query(`UPDATE product_promotions SET active=false, ended_at=now() WHERE product_id=$1 AND active`, [demo.p2]);
    }
  });
});
