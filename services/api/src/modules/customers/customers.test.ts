import { randomUUID } from 'node:crypto';
import { API_PREFIX, CustomerInsightsSchema, PersonalOfferSchema } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
let ownerToken = '';
let offerId = '';
const histIds: string[] = [];

const iso = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function token(email: string) {
  const res = await app.inject({
    method: 'POST',
    url: `${API_PREFIX}/auth/login`,
    payload: { email, password: 'velnes-demo' },
  });
  return res.json().accessToken as string;
}
const get = (url: string) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${ownerToken}` } });
const post = (url: string, payload: unknown = {}) =>
  app.inject({
    method: 'POST',
    url,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: payload as Record<string, unknown>,
  });

describe('customers, intelligence and personal offers', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    ownerToken = await token('maria@velnes.mk');
    // The seed books Katerina a demo visit THIS Wednesday morning —
    // once the clock passes it, insights would count an 11th visit.
    // Park it two weeks out for the duration of this suite.
    await admin.query(
      `UPDATE appointments SET date = date + 14 WHERE customer_id=$1 AND idempotency_key IS NULL`,
      [demo.c1],
    );
    // A steady rhythm for Katerina (c1): 10 completed visits, every
    // 14 days, same Wednesday-ish cadence, Maria — but stopped 30
    // days ago, so the rhythm exists and she is overdue (at_risk).
    for (let i = 0; i < 10; i++) {
      const id = randomUUID();
      histIds.push(id);
      await admin.query(
        `INSERT INTO appointments (id, tenant_id, location_id, date, start_min, duration_min, kind, status, title,
           service_id, employee_id, customer_id, price, source, idempotency_key)
         VALUES ($1,$2,$3,$4,600,45,'appointment','confirmed','Katerina Stojanovska',$5,$6,$7,1800,'staff',$8)`,
        [id, demo.business, demo.locCentar, iso(-30 - 14 * i), demo.s1, demo.empMaria, demo.c1, `hist-${i}`],
      );
    }
  });
  afterAll(async () => {
    for (const id of histIds)
      await admin.query(`DELETE FROM appointments WHERE id=$1`, [id]);
    await admin.query(
      `UPDATE appointments SET date = date - 14 WHERE customer_id=$1 AND idempotency_key IS NULL`,
      [demo.c1],
    );
    await admin.query(`DELETE FROM appointments WHERE idempotency_key LIKE 'po-book-%'`);
    await admin.query(`DELETE FROM invoice_lines WHERE tenant_id=$1 AND description LIKE 'Follow-up%' AND invoice_id IN (SELECT id FROM invoices WHERE idempotency_key LIKE 'po-sale-%')`, [demo.business]);
    await admin.query(`DELETE FROM checkout_items WHERE checkout_id IN (SELECT id FROM checkouts WHERE invoice_id IN (SELECT id FROM invoices WHERE idempotency_key LIKE 'po-sale-%'))`);
    await admin.query(`DELETE FROM merchant_transactions WHERE checkout_id IN (SELECT id FROM checkouts WHERE invoice_id IN (SELECT id FROM invoices WHERE idempotency_key LIKE 'po-sale-%'))`);
    await admin.query(`DELETE FROM checkouts WHERE invoice_id IN (SELECT id FROM invoices WHERE idempotency_key LIKE 'po-sale-%')`);
    await admin.query(`DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE idempotency_key LIKE 'po-sale-%')`);
    for (const cid of [demo.c1, demo.c4]) {
      await admin.query(
        `DELETE FROM loyalty_ledger WHERE customer_id=$1 AND reason <> 'Opening balance'`,
        [cid],
      );
      await admin.query(
        `UPDATE customers SET points=(SELECT COALESCE(SUM(points),0) FROM loyalty_ledger WHERE customer_id=$1) WHERE id=$1`,
        [cid],
      );
    }
    await admin.query(`DELETE FROM invoices WHERE idempotency_key LIKE 'po-sale-%'`);
    await admin.query(`DELETE FROM customer_activity WHERE tenant_id=$1`, [demo.business]);
    await admin.query(`DELETE FROM personal_offers WHERE tenant_id=$1`, [demo.business]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('serves the profile with the one Premium door answered', async () => {
    const kat = await get(`${API_PREFIX}/customers/${demo.c1}`);
    expect(kat.statusCode).toBe(200);
    expect(kat.json().isPremium).toBe(true);
    expect(kat.json().premium.status).toBe('active');
    // Elena's membership expired — the door says no.
    const elena = await get(`${API_PREFIX}/customers/${demo.c6}`);
    expect(elena.json().isPremium).toBe(false);
    expect(elena.json().premium.status).toBe('expired');
  });

  it('computes insights from real completed visits: rhythm, favourite, at_risk', async () => {
    const res = await get(`${API_PREFIX}/customers/${demo.c1}/insights`);
    expect(res.statusCode).toBe(200);
    const ci = CustomerInsightsSchema.parse(res.json());
    expect(ci.seeded).toBe(true);
    expect(ci.totals.visits).toBe(10);
    expect(ci.cadence.medianGapDays).toBe(14);
    expect(ci.cadence.steady).toBe(true);
    // 30 days since the last visit > 14 × 1.4 → overdue, at risk.
    expect(ci.retention).toBe('at_risk');
    expect(ci.overdueDays).toBe(16);
    expect(ci.favoriteService?.name).toBe('Physiotherapy session');
    expect(ci.employees[0]?.pct).toBe(100);
  });

  it('has no label without proof: a customer without history gets totals only', async () => {
    const res = await get(`${API_PREFIX}/customers/${demo.c5}/insights`);
    const ci = CustomerInsightsSchema.parse(res.json());
    expect(ci.seeded).toBe(false);
    expect(ci.retention).toBeNull();
    expect(ci.totals.visits).toBe(12); // the recorded totals
  });

  it('refuses a personal offer at a location that is not live', async () => {
    const draft = await admin.query(
      `INSERT INTO locations (id, tenant_id, name, lifecycle) VALUES ($1,$2,'Ghost','DRAFT') RETURNING id`,
      [randomUUID(), demo.business],
    );
    const res = await post(`${API_PREFIX}/customers/${demo.c1}/offers`, {
      serviceId: demo.s3,
      locationId: draft.rows[0].id,
      specialPrice: 900,
      validUntil: iso(14),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('LOC_NOT_LIVE');
    await admin.query(`DELETE FROM locations WHERE id=$1`, [draft.rows[0].id]);
  });

  it('creates a personal offer with the normal price from svcChoice, logged in activity', async () => {
    const res = await post(`${API_PREFIX}/customers/${demo.c1}/offers`, {
      serviceId: demo.s3,
      locationId: demo.locCentar,
      specialPrice: 900,
      validUntil: iso(14),
      intent: 'win_back',
    });
    expect(res.statusCode).toBe(200);
    const po = PersonalOfferSchema.parse(res.json());
    offerId = po.id;
    expect(po.status).toBe('live');
    expect(po.normalPrice).toBe(1200); // Follow-up session at Centar
    const act = await get(`${API_PREFIX}/customers/${demo.c1}/activity`);
    expect(act.json().entries[0].type).toBe('offer_created');
  });

  it('priceFor answers with the personal option and the till redeems it at payment', async () => {
    const price = await get(
      `${API_PREFIX}/price?serviceId=${demo.s3}&locationId=${demo.locCentar}&customerId=${demo.c1}`,
    );
    expect(price.statusCode).toBe(200);
    expect(price.json().effective).toBe(900);
    expect(price.json().best.kind).toBe('personal');

    // The till: same door, and paying redeems the promise.
    const sale = await post(`${API_PREFIX}/sales`, {
      locationId: demo.locAerodrom, // Centar's invoice counter is pinned by the till suite
      key: `po-sale-${Date.now()}`,
      method: 'cash',
      customerId: demo.c1,
      employeeId: demo.empMaria,
      lines: [{ kind: 'service', serviceId: demo.s3, qty: 1, lineDiscount: 0, modifierOptionIds: [] }],
    });
    expect(sale.statusCode).toBe(200);
    expect(sale.json().invoice.total).toBe(900);
    const po = await admin.query(`SELECT status FROM personal_offers WHERE id=$1`, [offerId]);
    expect(po.rows[0].status).toBe('redeemed');
    const act = await get(`${API_PREFIX}/customers/${demo.c1}/activity`);
    expect(act.json().entries[0].type).toBe('offer_redeemed');
    expect(act.json().entries[0].meta.override).toBe(false);

    // Redeemed means gone: the next price is the normal one.
    const after = await get(
      `${API_PREFIX}/price?serviceId=${demo.s3}&locationId=${demo.locCentar}&customerId=${demo.c1}`,
    );
    expect(after.json().effective).toBe(1200);
  });

  it('pays Premium members 1.5× loyalty at the till', async () => {
    // Marija (c4) is an active Premium member; earn_per=60, points=1.
    const before = await admin.query(`SELECT points FROM customers WHERE id=$1`, [demo.c4]);
    const sale = await post(`${API_PREFIX}/sales`, {
      locationId: demo.locAerodrom,
      key: `po-sale-prem-${Date.now()}`,
      method: 'cash',
      customerId: demo.c4,
      employeeId: demo.empMaria,
      lines: [{ kind: 'service', serviceId: demo.s3, qty: 1, lineDiscount: 0, modifierOptionIds: [] }],
    });
    expect(sale.statusCode).toBe(200);
    const after = await admin.query(`SELECT points FROM customers WHERE id=$1`, [demo.c4]);
    // 1200 / 60 = 20 points × 1.5 = 30.
    expect(after.rows[0].points - before.rows[0].points).toBe(30);
  });

  it('cancel is the administrative correction, audited in the activity log', async () => {
    const created = await post(`${API_PREFIX}/customers/${demo.c2}/offers`, {
      serviceId: demo.s3,
      locationId: demo.locCentar,
      specialPrice: 1000,
      validUntil: iso(7),
    });
    const id = created.json().id;
    const denied = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/personal-offers/${id}/cancel`,
      headers: { authorization: `Bearer ${await token('ana@velnes.mk')}` },
    });
    expect(denied.statusCode).toBe(403); // no marketing.personal_offers
    const ok = await post(`${API_PREFIX}/personal-offers/${id}/cancel`);
    expect(ok.statusCode).toBe(200);
    const offers = await get(`${API_PREFIX}/customers/${demo.c2}/offers`);
    expect(offers.json().offers[0].status).toBe('cancelled');
    // Only a live offer can be redeemed.
    const redeem = await post(`${API_PREFIX}/personal-offers/${id}/redeem`);
    expect(redeem.statusCode).toBe(409);
  });
});
