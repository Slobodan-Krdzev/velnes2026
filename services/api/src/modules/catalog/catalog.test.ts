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
let createdServiceId = '';
let createdProductId = '';

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
    if (createdServiceId) {
      await admin.query(`DELETE FROM employee_skills WHERE service_id=$1`, [createdServiceId]);
      await admin.query(`DELETE FROM location_catalog_services WHERE service_id=$1`, [createdServiceId]);
      await admin.query(`DELETE FROM services WHERE id=$1`, [createdServiceId]);
    }
    // Nikola and Bojan carried no skill rows (do-everything) — the
    // performer test materialised them; put the emptiness back.
    await admin.query(`DELETE FROM employee_skills WHERE employee_id IN ($1,$2)`, [
      demo.empNikola,
      demo.empBojan,
    ]);
    if (createdProductId) {
      await admin.query(`DELETE FROM location_catalog_products WHERE product_id=$1`, [createdProductId]);
      await admin.query(`DELETE FROM products WHERE id=$1`, [createdProductId]);
    }
    await admin.query(`DELETE FROM service_categories WHERE name='Prenatal (test)'`);
    await admin.query(`DELETE FROM service_categories WHERE name='Prenatal care (req test)'`);
    await admin.query(`DELETE FROM category_requests WHERE name IN ('Prenatal care (req test)','Crystal healing (req test)')`);
    await admin.query(`DELETE FROM platform_notices WHERE title LIKE '%Crystal healing (req test)%'`);
    await admin.query(`DELETE FROM platform_notices WHERE title LIKE '%Prenatal care (req test)%'`);
    await admin.query(`DELETE FROM combos WHERE name LIKE '%(test)%'`);
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

  it('the Velnes taxonomy: HQ creates, salons pick — never invent', async () => {
    // A salon naming an unknown category is refused, not obliged.
    const rogue = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/services`,
      headers: { authorization: `Bearer ${mariaToken}` },
      payload: { name: 'Knee massage', category: 'My Own Shelf', durationMin: 30, price: 1500 },
    });
    expect(rogue.statusCode).toBe(422);
    expect((rogue.json() as { message: string }).message).toContain('Velnes category');

    // The salon POST door is gone entirely.
    const gone = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/categories`,
      headers: { authorization: `Bearer ${mariaToken}` },
      payload: { name: 'Prenatal (test)', type: 'services' },
    });
    expect(gone.statusCode).toBe(404);

    // HQ creates the shelf; duplicates refused.
    const hq = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/auth/login`,
      payload: { email: 'ivana@revelapps.com', password: 'velnes-demo' },
    });
    const hqToken = (hq.json() as { accessToken: string }).accessToken;
    const created = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/categories`,
      headers: { authorization: `Bearer ${hqToken}` },
      payload: { name: 'Prenatal (test)', type: 'services' },
    });
    expect(created.statusCode).toBe(200);
    const dupe = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/categories`,
      headers: { authorization: `Bearer ${hqToken}` },
      payload: { name: 'Prenatal (test)', type: 'services' },
    });
    expect(dupe.statusCode).toBe(409);

    // The salon sees the new shelf at once and can stand a service on it.
    const list = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/categories`,
      headers: { authorization: `Bearer ${mariaToken}` },
    });
    const rows = (list.json() as { categories: { name: string; type: string; items: number }[] }).categories;
    expect(rows.find((c) => c.name === 'Prenatal (test)')).toMatchObject({ type: 'services', items: 0 });
    expect(rows.find((c) => c.name === 'Massage')).toBeDefined();
    const svc = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/services`,
      headers: { authorization: `Bearer ${mariaToken}` },
      payload: {
        name: 'Knee massage', category: 'Massage', durationMin: 30, price: 1500,
        // Only Ana performs it.
        performerIds: [demo.empAna],
      },
    });
    expect(svc.statusCode).toBe(200);
    createdServiceId = (svc.json() as { id: string }).id;
  });

  it('performers write onto the skills truth the booking gate reads', async () => {
    const emps = async () =>
      ((await app.inject({
        method: 'GET',
        url: `${API_PREFIX}/employees`,
        headers: { authorization: `Bearer ${mariaToken}` },
      })).json() as { employees: { id: string; skillServiceIds: string[] }[] }).employees;

    let all = await emps();
    const of = (id: string) => all.find((e) => e.id === id)!.skillServiceIds;
    // Ana (explicit list) gained the service; Maria and Elena did not.
    expect(of(demo.empAna)).toContain(createdServiceId);
    expect(of(demo.empMaria)).not.toContain(createdServiceId);
    // Bojan did everything implicitly — excluding him made his list
    // explicit: every service except this one.
    expect(of(demo.empBojan).length).toBeGreaterThan(0);
    expect(of(demo.empBojan)).not.toContain(createdServiceId);

    // Every worker: the explicit lists all gain the service.
    const put = await app.inject({
      method: 'PUT',
      url: `${API_PREFIX}/services/${createdServiceId}`,
      headers: { authorization: `Bearer ${mariaToken}` },
      payload: { name: 'Knee massage', category: 'Massage', durationMin: 30, price: 1500, performerIds: null },
    });
    expect(put.statusCode).toBe(200);
    all = await emps();
    for (const emp of [demo.empMaria, demo.empAna, demo.empElena, demo.empBojan])
      expect(of(emp), emp).toContain(createdServiceId);
  });

  it('a product carries its small photo; an oversized one is refused', async () => {
    const img = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
    const created = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/products`,
      headers: { authorization: `Bearer ${mariaToken}` },
      payload: { name: 'Photo test balm', category: 'Recovery aids', price: 700, img },
    });
    expect(created.statusCode).toBe(200);
    createdProductId = (created.json() as { id: string }).id;
    const cat = LocationCatalogResponseSchema.parse(
      (await app.inject({
        method: 'GET',
        url: `${API_PREFIX}/locations/${demo.locCentar}/catalog`,
        headers: { authorization: `Bearer ${mariaToken}` },
      })).json(),
    );
    expect(cat.products.find((p) => p.id === createdProductId)?.img).toBe(img);

    const tooBig = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/products`,
      headers: { authorization: `Bearer ${mariaToken}` },
      payload: { name: 'Too big', price: 1, img: 'data:image/jpeg;base64,' + 'A'.repeat(200_001) },
    });
    expect(tooBig.statusCode).toBe(400);
  });

  it('the request loop: salon asks, HQ approves, the shelf lands and every salon is told', async () => {
    // The salon asks. An existing shelf is refused kindly.
    const dupe = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/category-requests`,
      headers: { authorization: `Bearer ${mariaToken}` },
      payload: { name: 'Massage', type: 'services', note: '' },
    });
    expect(dupe.statusCode).toBe(409);
    const sent = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/category-requests`,
      headers: { authorization: `Bearer ${mariaToken}` },
      payload: { name: 'Prenatal care (req test)', type: 'services', note: 'We do prenatal work' },
    });
    expect(sent.statusCode).toBe(200);
    // A second identical ask waits on the first.
    const again = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/category-requests`,
      headers: { authorization: `Bearer ${mariaToken}` },
      payload: { name: 'Prenatal care (req test)', type: 'services', note: '' },
    });
    expect(again.statusCode).toBe(409);

    // The ask rings HQ's bell — and only HQ's.
    const preHq = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/auth/login`,
      payload: { email: 'ivana@revelapps.com', password: 'velnes-demo' },
    });
    const preHqToken = (preHq.json() as { accessToken: string }).accessToken;
    const hqBell = (await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/hq/notices`,
      headers: { authorization: `Bearer ${preHqToken}` },
    })).json() as { notices: { kind: string; title: string }[] };
    expect(
      hqBell.notices.some(
        (n) => n.kind === 'category_request' && n.title.includes('Prenatal care (req test)'),
      ),
    ).toBe(true);
    const salonBell = (await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/notices`,
      headers: { authorization: `Bearer ${mariaToken}` },
    })).json() as { notices: { kind: string }[] };
    expect(salonBell.notices.some((n) => n.kind === 'category_request')).toBe(false);

    // HQ sees the queue with the salon named.
    const hq = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/auth/login`,
      payload: { email: 'ivana@revelapps.com', password: 'velnes-demo' },
    });
    const hqToken = (hq.json() as { accessToken: string }).accessToken;
    const queue = (await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/hq/categories/requests`,
      headers: { authorization: `Bearer ${hqToken}` },
    })).json() as { requests: { id: string; name: string; tenantName: string; status: string }[] };
    const mine = queue.requests.find((r2) => r2.name === 'Prenatal care (req test)')!;
    expect(mine.tenantName).toBe('Velnes Fizio Centar');
    expect(mine.status).toBe('pending');

    // Approve: the shelf exists, the request flips, the notice lands.
    const ok = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/categories/requests/${mine.id}/approve`,
      headers: { authorization: `Bearer ${hqToken}` },
    });
    expect(ok.statusCode).toBe(200);
    const cats = (await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/categories`,
      headers: { authorization: `Bearer ${mariaToken}` },
    })).json() as { categories: { name: string }[] };
    expect(cats.categories.some((c) => c.name === 'Prenatal care (req test)')).toBe(true);
    const own = (await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/category-requests`,
      headers: { authorization: `Bearer ${mariaToken}` },
    })).json() as { requests: { name: string; status: string }[] };
    expect(own.requests.find((r2) => r2.name === 'Prenatal care (req test)')?.status).toBe('approved');
    const notices = (await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/notices`,
      headers: { authorization: `Bearer ${mariaToken}` },
    })).json() as { notices: { title: string }[] };
    expect(notices.notices.some((n) => n.title.includes('Prenatal care (req test)'))).toBe(true);
    // Deciding twice is refused.
    expect(
      (await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/hq/categories/requests/${mine.id}/approve`,
        headers: { authorization: `Bearer ${hqToken}` },
      })).statusCode,
    ).toBe(409);

    // Decline: the reason is mandatory at the door, and the answer
    // travels back to the salon that asked — as its own notice.
    const ask2 = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/category-requests`,
      headers: { authorization: `Bearer ${mariaToken}` },
      payload: { name: 'Crystal healing (req test)', type: 'services', note: '' },
    });
    expect(ask2.statusCode).toBe(200);
    const queue2 = (await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/hq/categories/requests`,
      headers: { authorization: `Bearer ${hqToken}` },
    })).json() as { requests: { id: string; name: string; status: string }[] };
    const req2 = queue2.requests.find(
      (r2) => r2.name === 'Crystal healing (req test)' && r2.status === 'pending',
    )!;
    const noReason = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/categories/requests/${req2.id}/decline`,
      headers: { authorization: `Bearer ${hqToken}` },
      payload: { reason: '' },
    });
    expect(noReason.statusCode).toBe(400);
    const declined = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/categories/requests/${req2.id}/decline`,
      headers: { authorization: `Bearer ${hqToken}` },
      payload: { reason: 'Out of the wellness scope' },
    });
    expect(declined.statusCode).toBe(200);
    const own2 = (await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/category-requests`,
      headers: { authorization: `Bearer ${mariaToken}` },
    })).json() as { requests: { name: string; status: string; hqReason: string }[] };
    expect(own2.requests.find((r2) => r2.name === 'Crystal healing (req test)')).toMatchObject({
      status: 'declined',
      hqReason: 'Out of the wellness scope',
    });
    const bell2 = (await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/notices`,
      headers: { authorization: `Bearer ${mariaToken}` },
    })).json() as { notices: { kind: string; title: string; body: string }[] };
    expect(
      bell2.notices.some(
        (n) =>
          n.kind === 'category_declined' &&
          n.title.includes('Crystal healing (req test)') &&
          n.body === 'Out of the wellness scope',
      ),
    ).toBe(true);

    // Delete: an unused shelf goes; one in use is refused by the FK.
    const catList = (await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/hq/categories`,
      headers: { authorization: `Bearer ${hqToken}` },
    })).json() as { categories: { id: string; name: string; type: string }[] };
    const fresh = catList.categories.find((c) => c.name === 'Prenatal care (req test)')!;
    const inUse = catList.categories.find((c) => c.name === 'Manual therapy')!;
    expect(
      (await app.inject({
        method: 'DELETE',
        url: `${API_PREFIX}/hq/categories/services/${inUse.id}`,
        headers: { authorization: `Bearer ${hqToken}` },
      })).statusCode,
    ).toBe(409);
    expect(
      (await app.inject({
        method: 'DELETE',
        url: `${API_PREFIX}/hq/categories/services/${fresh.id}`,
        headers: { authorization: `Bearer ${hqToken}` },
      })).statusCode,
    ).toBe(200);
  });

  it('combos: seeded packages read back, a bad item is refused, CRUD + till toggle work', async () => {
    const auth = { authorization: `Bearer ${mariaToken}` };
    const list1 = await app.inject({ method: 'GET', url: `${API_PREFIX}/combos`, headers: auth });
    expect(list1.statusCode).toBe(200);
    const seeded = (list1.json() as { combos: { id: string; name: string; items: unknown[] }[] }).combos;
    const pack = seeded.find((k) => k.name === 'Recovery start pack');
    expect(pack).toBeDefined();
    expect(pack!.items.length).toBe(3);

    // A combo item that points at nothing is refused (422).
    const bad = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/combos`,
      headers: auth,
      payload: {
        name: 'Bad combo (test)', regular: 1000, price: 800,
        items: [{ type: 'product', id: '70000000-0000-4000-8000-0000000000ff', qty: 1 }],
      },
    });
    expect(bad.statusCode).toBe(422);
    expect((bad.json() as { error: string }).error).toBe('BAD_ITEM');

    // A valid combo saves, toggles off the till, then deletes.
    const made = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/combos`,
      headers: auth,
      payload: {
        name: 'Home starter (test)', category: 'Assessment', regular: 2700, price: 2300,
        items: [{ type: 'service', id: demo.s6, qty: 1 }, { type: 'product', id: demo.p5, qty: 2 }],
      },
    });
    expect(made.statusCode).toBe(200);
    const id = (made.json() as { id: string }).id;

    const off = await app.inject({
      method: 'PATCH', url: `${API_PREFIX}/combos/${id}`, headers: auth,
      payload: { pos: false },
    });
    expect(off.statusCode).toBe(200);
    const list2 = await app.inject({ method: 'GET', url: `${API_PREFIX}/combos`, headers: auth });
    const mine = (list2.json() as { combos: { id: string; pos: boolean }[] }).combos.find((k) => k.id === id);
    expect(mine?.pos).toBe(false);

    const del = await app.inject({ method: 'DELETE', url: `${API_PREFIX}/combos/${id}`, headers: auth });
    expect(del.statusCode).toBe(200);
    const list3 = await app.inject({ method: 'GET', url: `${API_PREFIX}/combos`, headers: auth });
    expect((list3.json() as { combos: { id: string }[] }).combos.find((k) => k.id === id)).toBeUndefined();
  });
});
