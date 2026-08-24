import { API_PREFIX, LineQuoteResponseSchema, LocationCatalogResponseSchema, PriceForResponseSchema } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, withTenant } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';
import { modMissing, modTotals, svcAt, svcChoice, svcVariants } from './catalog.service.js';

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
let mariaToken = '';

// Prototype variant/option ids used below (see seed-demo).
const v45 = '61000000-0000-4000-8000-000000000801';
const v60 = '61000000-0000-4000-8000-000000000802';
const smallGroup = '63000000-0000-4000-8000-000000000011'; // -600
const extra15 = '63000000-0000-4000-8000-000000000014'; // +500, +15 min
const taping = '63000000-0000-4000-8000-000000000004'; // +700, +10 min

describe('catalog doors (contract tests vs prototype)', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/auth/login`,
      payload: { email: 'maria@velnes.mk', password: 'velnes-demo' },
    });
    mariaToken = res.json().accessToken;
  });
  afterAll(async () => {
    // Undo the overrides this suite writes.
    await admin.query(`DELETE FROM location_catalog_variants WHERE variant_id=$1`, [v45]);
    await admin.query(
      `UPDATE location_catalog_services SET price=1800, active=true WHERE service_id=$1 AND location_id=$2`,
      [demo.s1, demo.locAerodrom],
    );
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('svcAt: override row wins, master is the fallback', async () => {
    await withTenant(demo.business, async (trx) => {
      const centar = await svcAt(trx, demo.s1, demo.locCentar);
      expect(centar).toMatchObject({ active: true, price: 1800, durationMin: 45 });
    });
    // Location-specific price change touches only that location.
    await admin.query(
      `UPDATE location_catalog_services SET price=2000 WHERE service_id=$1 AND location_id=$2`,
      [demo.s1, demo.locAerodrom],
    );
    await withTenant(demo.business, async (trx) => {
      expect((await svcAt(trx, demo.s1, demo.locAerodrom)).price).toBe(2000);
      expect((await svcAt(trx, demo.s1, demo.locCentar)).price).toBe(1800);
    });
  });

  it('svcVariants: inherits master values, per-location override + deactivation', async () => {
    await admin.query(
      `INSERT INTO location_catalog_variants (tenant_id, location_id, variant_id, active, price)
       VALUES ($1,$2,$3,false,NULL)`,
      [demo.business, demo.locAerodrom, v45],
    );
    await withTenant(demo.business, async (trx) => {
      const centar = await svcVariants(trx, demo.s8, demo.locCentar);
      expect(centar.map((v) => [v.label, v.price, v.active])).toEqual([
        ['45 minutes', 1900, true],
        ['60 minutes', 2400, true],
        ['90 minutes', 3300, true],
      ]);
      const aerodrom = await svcVariants(trx, demo.s8, demo.locAerodrom);
      expect(aerodrom.find((v) => v.id === v45)?.active).toBe(false);
    });
  });

  it('svcChoice: chosen → std → first active; no variants → the service itself', async () => {
    await withTenant(demo.business, async (trx) => {
      const std = await svcChoice(trx, demo.s8, demo.locCentar, null);
      expect(std).toMatchObject({ label: '45 minutes', price: 1900, durationMin: 45 });
      const chosen = await svcChoice(trx, demo.s8, demo.locCentar, v60);
      expect(chosen).toMatchObject({ label: '60 minutes', price: 2400 });
      // At Aerodrom the std 45-min variant is off → first active (60 min).
      const fallback = await svcChoice(trx, demo.s8, demo.locAerodrom, null);
      expect(fallback).toMatchObject({ label: '60 minutes', price: 2400 });
      const plain = await svcChoice(trx, demo.s3, demo.locCentar, null);
      expect(plain).toMatchObject({ vid: null, price: 1200, durationMin: 30 });
    });
  });

  it('modTotals sums prices (negative allowed) and minutes; modMissing flags required groups', async () => {
    await withTenant(demo.business, async (trx) => {
      const groups = await (
        await import('./catalog.service.js')
      ).svcLine(trx, {
        serviceId: demo.s4,
        locationId: demo.locCentar,
        variantId: null,
        modifierOptionIds: [smallGroup, extra15],
      });
      // 1500 - 600 + 500 = 1400 · 60 + 0 + 15 = 75 min
      expect(groups.price).toBe(1400);
      expect(groups.treatmentMin).toBe(75);
      expect(groups.missingRequired).toEqual([]); // Format group satisfied
      const missing = await (
        await import('./catalog.service.js')
      ).svcLine(trx, {
        serviceId: demo.s4,
        locationId: demo.locCentar,
        variantId: null,
        modifierOptionIds: [],
      });
      expect(missing.missingRequired).toEqual(['Format']);
    });
    // modTotals/modMissing pure helpers reject foreign options.
    expect(() => modTotals([], ['not-an-option'])).toThrow();
    expect(modMissing([], [])).toEqual([]);
  });

  it('line quote: prep/reset from the catalog, price clamped at 0, operational minutes add up', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/catalog/line-quote`,
      headers: { authorization: `Bearer ${mariaToken}` },
      payload: {
        serviceId: demo.s1,
        locationId: demo.locCentar,
        modifierOptionIds: [taping],
      },
    });
    expect(res.statusCode).toBe(200);
    const line = LineQuoteResponseSchema.parse(res.json());
    // s1: 1800 + 700 · 45+10 min treatment · prep 10 / reset 10.
    expect(line).toMatchObject({
      price: 2500,
      treatmentMin: 55,
      prepMin: 10,
      resetMin: 10,
      operationalMin: 75,
      basis: 'catalog',
      modNames: ['Medical taping'],
    });
  });

  it('priceFor: base follows the location + variant, response has the fixed shape', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/price?serviceId=${demo.s8}&locationId=${demo.locCentar}&variantId=${v60}`,
      headers: { authorization: `Bearer ${mariaToken}` },
    });
    expect(res.statusCode).toBe(200);
    const price = PriceForResponseSchema.parse(res.json());
    expect(price.base).toBe(2400);
    expect(price.effective).toBe(2400);
    expect(price.discounted).toBe(false);
    expect(price.options).toHaveLength(1);
    expect(price.best.kind).toBe('list');
    expect(price.hasChoice).toBe(false);
  });

  it('GET /locations/:id/catalog returns the resolved world', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/locations/${demo.locCentar}/catalog`,
      headers: { authorization: `Bearer ${mariaToken}` },
    });
    expect(res.statusCode).toBe(200);
    const cat = LocationCatalogResponseSchema.parse(res.json());
    expect(cat.services).toHaveLength(8);
    expect(cat.products).toHaveLength(12);
    const s8 = cat.services.find((s) => s.name === 'Sports massage');
    expect(s8?.variants).toHaveLength(3);
    const ownUse = cat.products.filter((p) => p.own);
    expect(ownUse).toHaveLength(5);
    expect(ownUse.every((p) => p.config.pos === false)).toBe(true);
    // Stock must equal the ledger sum, whatever other suites moved.
    const bands = cat.products.find((p) => p.sku === 'VEL-BND-SET');
    const ledger = await admin.query(
      `SELECT COALESCE(SUM(qty),0)::int AS total FROM stock_movements WHERE product_id=$1 AND location_id=$2`,
      [demo.p1, demo.locCentar],
    );
    expect(bands?.config.stock).toBe(ledger.rows[0].total);
  });

  it('audits a price change through the CRUD door', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `${API_PREFIX}/locations/${demo.locAerodrom}/catalog/services/${demo.s1}`,
      headers: { authorization: `Bearer ${mariaToken}` },
      payload: { price: 2100 },
    });
    expect(res.statusCode).toBe(200);
    const audit = await admin.query(
      `SELECT before, after FROM audit_log WHERE action='Price changed' ORDER BY ts DESC LIMIT 1`,
    );
    expect(audit.rows[0]).toMatchObject({ before: '2000 ден', after: '2100 ден' });
  });
});
