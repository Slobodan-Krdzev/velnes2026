import { randomUUID } from 'node:crypto';
import { API_PREFIX } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';

/**
 * Products with a booking (Alex, 2026-10-01). A customer adds products
 * from the salon's shelf to a visit; the reservation rides on the visit's
 * first treatment, the shelf at that location is the judge, and the
 * money moves on the invoice — the app's pay door writes them as product
 * lines beside the treatment, and stock moves there, as over the counter.
 */
const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
const C = `${API_PREFIX}/client`;
const EMAIL = `products.${Date.now()}@example.test`;
const visa = { number: '4242 4242 4242 4242', expMonth: 12, expYear: 2031, cvc: '123', holder: 'Shelf Tester' };
let token = '';
let clientId = '';
let mariaToken = '';
const made: string[] = [];

const daysAhead = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const client = (method: 'GET' | 'POST', url: string, payload?: unknown, tok = token) =>
  app.inject({ method, url: `${C}${url}`, headers: { authorization: `Bearer ${tok}` }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });

/** A start where Maria is free for a 45-minute visit at Aerodrom. */
async function freeStart(date: string): Promise<string | null> {
  const need = 45 + 20;
  const busy = (
    await admin.query(
      `SELECT start_min - prep_min AS s, start_min + duration_min + reset_min AS e FROM appointments
       WHERE employee_id = $1 AND date = $2::date AND status <> 'cancelled' AND kind = 'appointment'`,
      [demo.empMaria, date],
    )
  ).rows as { s: number; e: number }[];
  const close = new Date(`${date}T00:00:00`).getDay() === 6 ? 15 * 60 : 19 * 60;
  for (let m = 9 * 60; m + need <= close; m += 30)
    if (!busy.some((b) => b.s < m + need && m < b.e)) return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return null;
}

async function book(products: { productId: string; qty?: number }[], from = 3) {
  let date = '';
  let time: string | null = null;
  for (let n = from; n < from + 14 && !time; n++) {
    date = daysAhead(n);
    time = await freeStart(date);
  }
  if (!time) throw new Error('No free start');
  return client('POST', '/book', {
    slug: 'velnes-fizio',
    key: randomUUID(),
    locationId: demo.locAerodrom,
    serviceId: demo.s1,
    date,
    time,
    employeeId: demo.empMaria,
    products,
  });
}

describe('products with a booking', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    await app.inject({ method: 'POST', url: `${C}/register`, payload: { email: EMAIL, password: 'velnes-test-12345', first: 'Shelf', last: 'Tester', phone: '+389 70 777 030', dob: null, lang: 'en' } });
    const code = (await admin.query(`SELECT body FROM mail_outbox WHERE to_email=$1 AND kind='client_email_verify' ORDER BY sent_at DESC LIMIT 1`, [EMAIL.toLowerCase()])).rows[0].body.match(/code is (\d{6})/)![1] as string;
    const v = await app.inject({ method: 'POST', url: `${C}/verify-email`, payload: { email: EMAIL, code } });
    token = v.json().token as string;
    clientId = v.json().profile.id as string;
    mariaToken = (await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email: 'maria@velnes.mk', password: 'velnes-demo' } })).json().accessToken as string;
  });
  afterAll(async () => {
    const legs = await admin.query(`SELECT id FROM appointments WHERE client_user_id = $1`, [clientId]);
    for (const r of legs.rows) if (!made.includes(r.id)) made.push(r.id as string);
    const keys = made.map((id) => `pay:${id}`);
    await admin.query(`DELETE FROM checkout_items WHERE checkout_id IN (SELECT c.id FROM checkouts c WHERE c.invoice_id IN (SELECT invoice_id FROM invoice_lines WHERE appointment_id = ANY($1)))`, [made]);
    await admin.query(`DELETE FROM merchant_transactions WHERE checkout_id IN (SELECT c.id FROM checkouts c WHERE c.invoice_id IN (SELECT invoice_id FROM invoice_lines WHERE appointment_id = ANY($1)))`, [made]);
    await admin.query(`DELETE FROM checkouts WHERE invoice_id IN (SELECT invoice_id FROM invoice_lines WHERE appointment_id = ANY($1))`, [made]);
    await admin.query(`DELETE FROM stock_movements WHERE ref IN (SELECT number FROM invoices WHERE idempotency_key = ANY($1))`, [keys]);
    await admin.query(`DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE idempotency_key = ANY($1))`, [keys]);
    await admin.query(`DELETE FROM invoices WHERE idempotency_key = ANY($1)`, [keys]);
    await admin.query(`DELETE FROM appointment_history WHERE appointment_id = ANY($1)`, [made]);
    await admin.query(`DELETE FROM appointments WHERE id = ANY($1)`, [made]); // appointment_products cascade
    await admin.query(`DELETE FROM platform_notices WHERE ref_id = ANY($1)`, [made]);
    await admin.query(`DELETE FROM mail_outbox WHERE ref_id = ANY($1) OR to_email = $2`, [made, EMAIL.toLowerCase()]);
    await admin.query(`DELETE FROM client_notifications WHERE client_user_id = $1`, [clientId]);
    const links = await admin.query(`SELECT customer_id FROM client_customer_links WHERE client_user_id = $1`, [clientId]);
    await admin.query(`DELETE FROM client_customer_links WHERE client_user_id = $1`, [clientId]);
    for (const l of links.rows) {
      await admin.query(`DELETE FROM loyalty_ledger WHERE customer_id = $1`, [l.customer_id]);
      await admin.query(`DELETE FROM customers WHERE id = $1`, [l.customer_id]);
    }
    await admin.query(`DELETE FROM client_users WHERE id = $1`, [clientId]);
    await admin.query(`DELETE FROM audit_log WHERE actor_name = 'Shelf Tester'`);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('the salon page says where each product is sold and for how much there', async () => {
    const res = await app.inject({ method: 'GET', url: `${API_PREFIX}/public/discovery/salons/velnes-fizio` });
    expect(res.statusCode).toBe(200);
    const products = res.json().products as { id: string; price: number; at: { locationId: string; price: number }[] }[];
    const band = products.find((p) => p.id === demo.p1)!;
    expect(band.at.map((a) => a.locationId).sort()).toEqual([demo.locCentar, demo.locAerodrom].sort());
    expect(band.at.every((a) => a.price === 1200)).toBe(true);
    // The inactive brace is not on the shelf at all.
    expect(products.some((p) => p.id === demo.p6)).toBe(false);
  });

  it('a booking reserves products against its first treatment; every door after it lists them; the pay door charges them on the same invoice and moves stock', async () => {
    const res = await book([{ productId: demo.p1, qty: 2 }, { productId: demo.p3 }, { productId: demo.p1 }]);
    expect(res.statusCode, res.body).toBe(200);
    const out = res.json();
    made.push(out.ref);
    // The same product twice is one line; the shelf price is snapshotted.
    expect(out.products).toEqual([
      { productId: demo.p1, name: 'Resistance band set', qty: 3, unitPrice: 1200 },
      { productId: demo.p3, name: 'Kinesiology tape roll', qty: 1, unitPrice: 550 },
    ]);
    expect(out.price).toBe(out.items[0].price); // treatments only
    const rows = await admin.query(`SELECT product_id, qty, unit_price FROM appointment_products WHERE appointment_id = $1 ORDER BY created_at`, [out.ref]);
    expect(rows.rows).toEqual([
      { product_id: demo.p1, qty: 3, unit_price: 1200 },
      { product_id: demo.p3, qty: 1, unit_price: 550 },
    ]);

    // The customer's own list carries them.
    const mine = await client('GET', '/me/appointments');
    const a = (mine.json().appointments as { id: string; products: unknown[] }[]).find((x) => x.id === out.ref)!;
    expect(a.products).toHaveLength(2);

    // The salon's calendar list carries them, so the drawer and the till can.
    const list = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/appointments?locationId=${demo.locAerodrom}&from=${out.date}&to=${out.date}`,
      headers: { authorization: `Bearer ${mariaToken}` },
    });
    expect(list.statusCode).toBe(200);
    const row = (list.json().appointments as { id: string; products: { qty: number }[] }[]).find((x) => x.id === out.ref)!;
    expect(row.products.map((p) => p.qty)).toEqual([3, 1]);

    // The quote: products at the shelf price, counted in the subtotal.
    const quote = await client('POST', '/pay/quote', { appointmentId: out.ref });
    expect(quote.statusCode, quote.body).toBe(200);
    expect(quote.json().products).toEqual([
      { productId: demo.p1, name: 'Resistance band set', qty: 3, unitPrice: 1200, total: 3600 },
      { productId: demo.p3, name: 'Kinesiology tape roll', qty: 1, unitPrice: 550, total: 550 },
    ]);
    expect(quote.json().subtotal).toBe(out.price + 3600 + 550);

    // Paying writes the products as lines of the treatment's invoice,
    // and the shelf's stock ledger records the sale.
    const before = Number((await admin.query(`SELECT stock FROM location_catalog_products WHERE location_id = $1 AND product_id = $2`, [demo.locAerodrom, demo.p1])).rows[0].stock);
    const pay = await client('POST', '/pay', { appointmentId: out.ref, method: 'card', card: visa });
    expect(pay.statusCode, pay.body).toBe(200);
    expect(pay.json().amount).toBe(out.price + 3600 + 550);
    const lines = await admin.query(
      `SELECT l.item_class, l.product_id, l.qty, l.unit_price AS price FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.idempotency_key = $1 ORDER BY l.item_class, l.unit_price DESC`,
      [`pay:${out.ref}`],
    );
    expect(lines.rows).toEqual([
      { item_class: 'product', product_id: demo.p1, qty: 3, price: 1200 },
      { item_class: 'product', product_id: demo.p3, qty: 1, price: 550 },
      { item_class: 'service', product_id: null, qty: 1, price: out.price },
    ]);
    const after = Number((await admin.query(`SELECT stock FROM location_catalog_products WHERE location_id = $1 AND product_id = $2`, [demo.locAerodrom, demo.p1])).rows[0].stock);
    expect(after).toBe(Math.max(0, before - 3));
    const moves = await admin.query(`SELECT qty FROM stock_movements WHERE product_id = $1 AND location_id = $2 AND kind = 'sale' AND ref = (SELECT number FROM invoices WHERE idempotency_key = $3)`, [demo.p1, demo.locAerodrom, `pay:${out.ref}`]);
    expect(moves.rows).toEqual([{ qty: -3 }]);
  });

  it('a product the location does not sell is refused, and nothing is booked', async () => {
    const res = await book([{ productId: demo.p6 }], 20);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('PRODUCT_UNAVAILABLE');
    expect(res.json().params.name).toBe('Posture support brace');
    const own = await book([{ productId: demo.o1 }], 20);
    expect(own.statusCode).toBe(409);
    const left = await admin.query(`SELECT count(*)::int AS n FROM appointments WHERE client_user_id = $1`, [clientId]);
    expect(left.rows[0].n).toBe(1); // only the paid visit above
  });
});
