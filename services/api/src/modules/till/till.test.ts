import { randomUUID } from 'node:crypto';
import { API_PREFIX, SaleResponseSchema } from '@velnes/contracts';
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
let maria = '';

const post = (url: string, payload: object, tok = maria) =>
  app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${tok}` }, payload });
const get = (url: string) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${maria}` } });

const sale = (over: object) =>
  post(`${API_PREFIX}/sales`, {
    key: randomUUID(),
    locationId: demo.locCentar,
    method: 'Cash',
    lines: [],
    ...over,
  });

describe('till & checkout doors', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    maria = (
      await post(`${API_PREFIX}/auth/login`, {
        email: 'maria@velnes.mk',
        password: 'velnes-demo',
      })
    ).json().accessToken;
  });
  afterAll(async () => {
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('sells with the prototype totals: line discount, cart discount, points→gift→promo order, tip on top', async () => {
    // Rehab (1500, line disc 100) + 2× tape roll (550) → subtotal 2500.
    // points 100 → −300 · gift asks 200 but the card holds 22 → −22 ·
    // SUMMER26 15% of 2500 → −375 · cart discount 100 · tip 150
    // → total = 2500+150−100−300−22−375 = 1853.
    const r = await sale({
      lines: [
        { kind: 'service', serviceId: demo.s4, modifierOptionIds: ['63000000-0000-4000-8000-000000000010'], lineDiscount: 100 },
        { kind: 'product', productId: demo.p3, qty: 2 },
      ],
      customerId: demo.c1,
      employeeId: demo.empMaria,
      tip: 150,
      cartDiscount: 100,
      pointsRedeemed: 100,
      giftCardCode: 'VEL-8841-2290',
      giftAmount: 200,
      promoCode: 'SUMMER26',
    });
    expect(r.statusCode).toBe(200);
    const body = SaleResponseSchema.parse(r.json());
    expect(body.total).toBe(1853);
    expect(body.invoice.number).toBe('CEN-2026-0413'); // the counter continues the prototype
    expect(body.checkoutStatus).toBe('PAID');
    // Points: −100 redeemed, earned on the PAID total ×1.5 (Katerina
    // is Velnes Premium): round(1853/60 × 1.5) = 46.
    expect(body.pointsEarned).toBe(46);
    const bal = await admin.query(
      `SELECT COALESCE(SUM(points),0)::int AS n FROM loyalty_ledger WHERE customer_id=$1`,
      [demo.c1],
    );
    const cust = await admin.query(`SELECT points FROM customers WHERE id=$1`, [demo.c1]);
    expect(cust.rows[0].points).toBe(bal.rows[0].n); // balance = ledger sum
    expect(bal.rows[0].n).toBe(320 - 100 + 46);
    const promo = await admin.query(`SELECT used FROM discount_codes WHERE code='SUMMER26'`);
    expect(promo.rows[0].used).toBe(49);
  });

  it('never lets a gift card go below zero — the sale takes what remains', async () => {
    // The previous sale asked 200 from a card holding 22: it took 22.
    const gc = await admin.query(`SELECT remaining FROM gift_cards WHERE code='VEL-8841-2290'`);
    expect(gc.rows[0].remaining).toBe(0);
  });

  it('splits the receipt by legal seller: BeautyPro line lands on its own paid transaction', async () => {
    const r = await sale({
      lines: [
        { kind: 'service', serviceId: demo.s5 }, // house seller (900)
        { kind: 'product', productId: demo.p2 }, // BeautyPro arnica oil (850)
      ],
    });
    expect(r.statusCode).toBe(200);
    const body = SaleResponseSchema.parse(r.json());
    expect(body.checkoutStatus).toBe('PAID');
    expect(body.transactions).toHaveLength(2);
    const amounts = body.transactions.map((t) => t.amount).sort((a, b) => a - b);
    expect(amounts).toEqual([850, 900]);
    const sellers = await admin.query(
      `SELECT DISTINCT seller_legal_entity_id FROM checkout_items WHERE checkout_id=$1`,
      [body.checkoutId],
    );
    expect(sellers.rows).toHaveLength(2);
  });

  it('marks a not-ready seller config_incomplete — the till does not change by a pixel', async () => {
    // Craft a product sold by Aroma Nordic (pending entity, incomplete account).
    await admin.query(`UPDATE products SET seller_legal_entity_id=$1 WHERE id=$2`, [
      demo.leAroma,
      demo.p5,
    ]);
    const r = await sale({
      lines: [
        { kind: 'product', productId: demo.p5 }, // Aroma-sold (900)
        { kind: 'product', productId: demo.p1 }, // house (1200)
      ],
    });
    expect(r.statusCode).toBe(200);
    const body = SaleResponseSchema.parse(r.json());
    expect(body.checkoutStatus).toBe('PARTIALLY_PAID');
    const bad = body.transactions.find((t) => t.status === 'config_incomplete');
    expect(bad?.amount).toBe(900);

    // Status door agrees; retry refuses until the config is complete.
    const st = await get(`${API_PREFIX}/checkouts/${body.checkoutId}/status`);
    expect(st.json().status).toBe('PARTIALLY_PAID');
    const retry = await post(`${API_PREFIX}/merchant-transactions/${bad!.id}/retry`, {});
    expect(retry.statusCode).toBe(409);
    expect(retry.json().message).toContain('configuration');
    // Paid is locked forever.
    const paid = body.transactions.find((t) => t.status === 'paid');
    const lock = await post(`${API_PREFIX}/merchant-transactions/${paid!.id}/retry`, {});
    expect(lock.statusCode).toBe(409);
    expect(lock.json().message).toContain('never collected twice');
    await admin.query(`UPDATE products SET seller_legal_entity_id=NULL WHERE id=$1`, [demo.p5]);
  });

  it('failed transactions retry with the SAME idempotency key', async () => {
    const r = await sale({ lines: [{ kind: 'product', productId: demo.p1 }] });
    const tx = r.json().transactions[0];
    await admin.query(`UPDATE merchant_transactions SET status='failed' WHERE id=$1`, [tx.id]);
    const keyBefore = (
      await admin.query(`SELECT idempotency_key FROM merchant_transactions WHERE id=$1`, [tx.id])
    ).rows[0].idempotency_key;
    const retry = await post(`${API_PREFIX}/merchant-transactions/${tx.id}/retry`, {});
    expect(retry.statusCode).toBe(200);
    const after = await admin.query(
      `SELECT status, idempotency_key FROM merchant_transactions WHERE id=$1`,
      [tx.id],
    );
    expect(after.rows[0]).toMatchObject({ status: 'paid', idempotency_key: keyBefore });
  });

  it('consumes stock and own-use recipes, reporting shortages honestly', async () => {
    const before = await admin.query(
      `SELECT stock FROM location_catalog_products WHERE location_id=$1 AND product_id=$2`,
      [demo.locCentar, demo.p3],
    );
    const r = await sale({
      lines: [
        { kind: 'product', productId: demo.p3, qty: 3 }, // tape rolls out of stock
        { kind: 'service', serviceId: demo.s8 }, // consumes 25ml arnica + couch roll
      ],
    });
    expect(r.statusCode).toBe(200);
    const after = await admin.query(
      `SELECT stock FROM location_catalog_products WHERE location_id=$1 AND product_id=$2`,
      [demo.locCentar, demo.p3],
    );
    expect(after.rows[0].stock).toBe(before.rows[0].stock - 3);
    const moves = await admin.query(
      `SELECT kind, qty FROM stock_movements WHERE ref=$1 ORDER BY kind`,
      [r.json().invoice.number],
    );
    // A 'sale' movement for the tape and 'own_use' container openings.
    expect(moves.rows.some((m) => m.kind === 'sale' && m.qty === -3)).toBe(true);
    expect(moves.rows.some((m) => m.kind === 'own_use')).toBe(true);
  });

  it('refuses own-use products and a suspended location', async () => {
    const own = await sale({ lines: [{ kind: 'product', productId: demo.o1 }] });
    expect(own.statusCode).toBe(409);
    expect(own.json().message).toContain('own use');

    await admin.query(`UPDATE locations SET lifecycle='SUSPENDED' WHERE id=$1`, [demo.locAerodrom]);
    const dead = await sale({
      locationId: demo.locAerodrom,
      lines: [{ kind: 'product', productId: demo.p1 }],
    });
    expect(dead.statusCode).toBe(409);
    expect(dead.json().message).toContain('checkout is closed there');
    await admin.query(`UPDATE locations SET lifecycle='ACTIVE' WHERE id=$1`, [demo.locAerodrom]);
  });

  it('is idempotent: the same key returns the same invoice', async () => {
    const key = randomUUID();
    const a = await sale({ key, lines: [{ kind: 'product', productId: demo.p1 }] });
    const b = await sale({ key, lines: [{ kind: 'product', productId: demo.p1 }] });
    expect(b.json().invoice.id).toBe(a.json().invoice.id);
  });

  it('validates codes through one door', async () => {
    const promo = await post(`${API_PREFIX}/till/validate-code`, { code: 'summer26', subtotal: 1000 });
    expect(promo.json()).toMatchObject({ kind: 'promo', amount: 150 });
    const sched = await post(`${API_PREFIX}/till/validate-code`, { code: 'AUTUMN20', subtotal: 1000 });
    expect(sched.json().kind).toBe('invalid');
    const expired = await post(`${API_PREFIX}/till/validate-code`, { code: 'SPRING26', subtotal: 1000 });
    expect(expired.json().message).toContain('expired');
    const gift = await post(`${API_PREFIX}/till/validate-code`, { code: 'VEL-3317-9042', subtotal: 1000 });
    expect(gift.json()).toMatchObject({ kind: 'gift', remaining: 50 });
    const empty = await post(`${API_PREFIX}/till/validate-code`, { code: 'VEL-6620-1185', subtotal: 1000 });
    expect(empty.json().message).toContain('empty');
  });

  it('refunds with a reason, audited with the prototype shape', async () => {
    const s = await sale({ lines: [{ kind: 'product', productId: demo.p1 }] });
    const inv = s.json().invoice;
    const r = await post(`${API_PREFIX}/invoices/${inv.id}/refund`, {
      reason: 'Customer unhappy with result',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('Refunded');
    const audit = await admin.query(
      `SELECT before, after, reason FROM audit_log WHERE action='Refund' ORDER BY ts DESC LIMIT 1`,
    );
    expect(audit.rows[0]).toMatchObject({
      before: `${inv.total} ден paid`,
      after: `${inv.total} ден refunded`,
      reason: 'Customer unhappy with result',
    });
    const again = await post(`${API_PREFIX}/invoices/${inv.id}/refund`, { reason: 'x' });
    expect(again.statusCode).toBe(409);
  });
});
