import { randomUUID } from 'node:crypto';
import { API_PREFIX } from '@velnes/contracts';
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
const C = `${API_PREFIX}/client`;
const EMAIL = 'cards.tester@example.test';
const PASSWORD = 'cards-pass-1234';
let token = '';
const made: string[] = [];

/** A Tuesday six weeks out. */
const day = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 44 - ((d.getDay() + 5) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

const call = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url: `${C}${url}`, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });

async function bookSignedIn() {
  const slots = await app.inject({
    method: 'POST',
    url: `${API_PREFIX}/public/slots`,
    payload: { key: 'salon:velnes-fizio', locationId: demo.locAerodrom, date: day, employeeId: 'any', items: [{ serviceId: demo.s1 }] },
  });
  const slot = slots.json().slots.find((x: { free: boolean }) => x.free);
  expect(slot).toBeDefined();
  const res = await call('POST', '/book', {
    key: randomUUID(),
    slug: 'velnes-fizio',
    locationId: demo.locAerodrom,
    serviceId: demo.s1,
    date: day,
    time: slot.t,
    employeeId: 'any',
    items: [{ serviceId: demo.s1 }],
  });
  expect(res.statusCode).toBe(200);
  made.push(res.json().ref as string);
  return res.json() as { ref: string; price: number };
}

const visa = { number: '4242424242424242', expMonth: 11, expYear: 2032, cvc: '123', holder: 'Cards Tester' };

describe('saved cards — a client keeps a card at checkout and pays with it next time', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    const reg = await app.inject({
      method: 'POST',
      url: `${C}/register`,
      payload: { email: EMAIL, password: PASSWORD, first: 'Cards', last: 'Tester', phone: '+389 70 000 555', dob: '1990-05-05', lang: 'en' },
    });
    expect(reg.statusCode).toBe(200);
    const code = await admin.query(`SELECT email_code FROM client_users WHERE email = $1`, [EMAIL]);
    const ver = await app.inject({ method: 'POST', url: `${C}/verify-email`, payload: { email: EMAIL, code: code.rows[0].email_code } });
    expect(ver.statusCode).toBe(200);
    const login = await app.inject({ method: 'POST', url: `${C}/login`, payload: { email: EMAIL, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    token = login.json().token as string;
  });
  afterAll(async () => {
    const keys = made.map((id) => `pay:${id}`);
    if (made.length) {
      await admin.query(
        `DELETE FROM checkout_items WHERE checkout_id IN (SELECT c.id FROM checkouts c JOIN invoices i ON i.id = c.invoice_id WHERE i.idempotency_key = ANY($1))`,
        [keys],
      );
      await admin.query(
        `DELETE FROM merchant_transactions WHERE checkout_id IN (SELECT c.id FROM checkouts c JOIN invoices i ON i.id = c.invoice_id WHERE i.idempotency_key = ANY($1))`,
        [keys],
      );
      await admin.query(`DELETE FROM checkouts WHERE invoice_id IN (SELECT id FROM invoices WHERE idempotency_key = ANY($1))`, [keys]);
      await admin.query(`DELETE FROM invoice_lines WHERE appointment_id = ANY($1)`, [made]);
      await admin.query(`DELETE FROM invoices WHERE idempotency_key = ANY($1)`, [keys]);
      await admin.query(`DELETE FROM appointment_history WHERE appointment_id = ANY($1)`, [made]);
      await admin.query(`DELETE FROM appointments WHERE id = ANY($1)`, [made]);
      await admin.query(`DELETE FROM platform_notices WHERE ref_id = ANY($1)`, [made]);
      await admin.query(`DELETE FROM mail_outbox WHERE ref_id = ANY($1)`, [made]);
    }
    const links = await admin.query(
      `SELECT customer_id FROM client_customer_links WHERE client_user_id IN (SELECT id FROM client_users WHERE email = $1)`,
      [EMAIL],
    );
    await admin.query(`DELETE FROM client_customer_links WHERE client_user_id IN (SELECT id FROM client_users WHERE email = $1)`, [EMAIL]);
    for (const row of links.rows) {
      await admin.query(`DELETE FROM loyalty_ledger WHERE customer_id = $1`, [row.customer_id]);
      await admin.query(`DELETE FROM customers WHERE id = $1`, [row.customer_id]);
    }
    await admin.query(`DELETE FROM mail_outbox WHERE to_email = $1`, [EMAIL]);
    await admin.query(`DELETE FROM client_users WHERE email = $1`, [EMAIL]);
    await admin.query(`DELETE FROM audit_log WHERE action = 'Sale' AND source = 'Velnes app'`);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('starts with no cards; paying with "save this card" keeps brand, last four and expiry — never the number', async () => {
    expect((await call('GET', '/me/cards')).json().cards).toEqual([]);
    const b = await bookSignedIn();
    const res = await call('POST', '/pay', { appointmentId: b.ref, method: 'card', card: visa, saveCard: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('paid');
    const cards = (await call('GET', '/me/cards')).json().cards;
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ brand: 'Visa', last4: '4242', expMonth: 11, expYear: 2032, holder: 'Cards Tester' });
    const raw = await admin.query(`SELECT provider_ref FROM client_payment_methods WHERE last4 = '4242'`);
    expect(raw.rows[0].provider_ref).toMatch(/^mock_pm_/);
    expect(JSON.stringify(raw.rows)).not.toContain('4242424242424242');
    // My appointments says paid, so the page drops its Pay now.
    const mine = await call('GET', '/me/appointments');
    expect(mine.json().appointments.find((a: { id: string }) => a.id === b.ref)?.paid).toBe(true);
    // The client's own bell heard the payment.
    const bell = await call('GET', '/me/notifications');
    expect(bell.json().notifications.some((n: { title: string }) => n.title === 'Payment received')).toBe(true);
  });

  it('pays the next booking with the saved card, and the same card is not saved twice', async () => {
    const cards = (await call('GET', '/me/cards')).json().cards;
    const b = await bookSignedIn();
    const res = await call('POST', '/pay', { appointmentId: b.ref, method: 'card', savedCardId: cards[0].id });
    expect(res.statusCode).toBe(200);
    expect(res.json().card).toEqual({ brand: 'Visa', last4: '4242' });
    const inv = await admin.query(`SELECT method FROM invoices WHERE idempotency_key = $1`, [`pay:${b.ref}`]);
    expect(inv.rows[0].method).toBe('Online card');
    // Saving the very same card again is a no-op.
    const b2 = await bookSignedIn();
    await call('POST', '/pay', { appointmentId: b2.ref, method: 'card', card: visa, saveCard: true });
    expect((await call('GET', '/me/cards')).json().cards).toHaveLength(1);
  });

  it('forgets a card; a stranger’s card id is unknown', async () => {
    const cards = (await call('GET', '/me/cards')).json().cards;
    const gone = await call('DELETE', `/me/cards/${cards[0].id}`);
    expect(gone.statusCode).toBe(200);
    expect((await call('GET', '/me/cards')).json().cards).toEqual([]);
    const nope = await call('DELETE', `/me/cards/${randomUUID()}`);
    expect(nope.statusCode).toBe(404);
  });

  it('a guest never saves a card, whatever the request says', async () => {
    const guest = await admin.query(`SELECT count(*)::int AS n FROM client_payment_methods`);
    const slots = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/public/slots`,
      payload: { key: 'salon:velnes-fizio', locationId: demo.locAerodrom, date: day, employeeId: 'any', items: [{ serviceId: demo.s1 }] },
    });
    const slot = slots.json().slots.find((x: { free: boolean }) => x.free);
    const booked = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/public/book`,
      payload: {
        widgetKey: 'salon:velnes-fizio',
        key: randomUUID(),
        locationId: demo.locAerodrom,
        serviceId: demo.s1,
        date: day,
        time: slot.t,
        employeeId: 'any',
        items: [{ serviceId: demo.s1 }],
        name: 'Cards Tester',
        phone: '+389 70 000 556',
        email: 'cards.guest@example.test',
      },
    });
    made.push(booked.json().ref as string);
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/public/pay`,
      payload: { key: 'salon:velnes-fizio', token: booked.json().payToken, appointmentId: booked.json().ref, method: 'card', card: visa, saveCard: true },
    });
    expect(res.statusCode).toBe(200);
    const after = await admin.query(`SELECT count(*)::int AS n FROM client_payment_methods`);
    expect(after.rows[0].n).toBe(guest.rows[0].n);
    await admin.query(`DELETE FROM mail_outbox WHERE to_email = 'cards.guest@example.test'`);
  });
});
