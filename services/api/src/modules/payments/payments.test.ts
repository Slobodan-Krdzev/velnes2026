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
const P = `${API_PREFIX}/public`;
const KEY = 'salon:velnes-fizio';
const made: string[] = [];

/** A Tuesday five weeks out — its own week, nobody else's bookings. */
const day = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 37 - ((d.getDay() + 5) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

async function bookAsGuest(email: string) {
  const slots = await app.inject({
    method: 'POST',
    url: `${P}/slots`,
    payload: { key: KEY, locationId: demo.locAerodrom, date: day, employeeId: 'any', items: [{ serviceId: demo.s1 }] },
  });
  const slot = slots.json().slots.find((x: { free: boolean }) => x.free);
  expect(slot).toBeDefined();
  const res = await app.inject({
    method: 'POST',
    url: `${P}/book`,
    payload: {
      widgetKey: KEY,
      key: randomUUID(),
      locationId: demo.locAerodrom,
      serviceId: demo.s1,
      date: day,
      time: slot.t,
      employeeId: 'any',
      items: [{ serviceId: demo.s1 }],
      name: 'Pay Tester',
      phone: '+389 70 999 440',
      email,
    },
  });
  expect(res.statusCode).toBe(200);
  made.push(res.json().ref as string);
  return res.json() as { ref: string; status: string; price: number; payToken: string };
}

const quote = (body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `${P}/pay/quote`, payload: { key: KEY, ...body } });
const pay = (body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `${P}/pay`, payload: { key: KEY, ...body } });
const visa = { number: '4242 4242 4242 4242', expMonth: 12, expYear: 2031, cvc: '123', holder: 'Pay Tester' };

describe('paying for a booking from the Velnes app', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
  });
  afterAll(async () => {
    if (made.length) {
      await admin.query(
        `DELETE FROM checkout_items WHERE checkout_id IN (SELECT c.id FROM checkouts c JOIN invoices i ON i.id = c.invoice_id WHERE i.idempotency_key = ANY($1))`,
        [made.map((id) => `pay:${id}`)],
      );
      await admin.query(
        `DELETE FROM merchant_transactions WHERE checkout_id IN (SELECT c.id FROM checkouts c JOIN invoices i ON i.id = c.invoice_id WHERE i.idempotency_key = ANY($1))`,
        [made.map((id) => `pay:${id}`)],
      );
      await admin.query(`DELETE FROM checkouts WHERE invoice_id IN (SELECT id FROM invoices WHERE idempotency_key = ANY($1))`, [
        made.map((id) => `pay:${id}`),
      ]);
      await admin.query(`DELETE FROM invoice_lines WHERE appointment_id = ANY($1)`, [made]);
      await admin.query(`DELETE FROM invoices WHERE idempotency_key = ANY($1)`, [made.map((id) => `pay:${id}`)]);
      await admin.query(`DELETE FROM appointment_history WHERE appointment_id = ANY($1)`, [made]);
      await admin.query(`DELETE FROM appointments WHERE id = ANY($1)`, [made]);
      await admin.query(`DELETE FROM platform_notices WHERE ref_id = ANY($1)`, [made]);
      await admin.query(`DELETE FROM mail_outbox WHERE ref_id = ANY($1)`, [made]);
    }
    await admin.query(`UPDATE gift_cards SET remaining = 50 WHERE code = 'VEL-3317-9042'`);
    await admin.query(`UPDATE discount_codes SET used = 132 WHERE code = 'WELCOME10'`);
    await admin.query(`DELETE FROM loyalty_ledger WHERE customer_id IN (SELECT id FROM customers WHERE tenant_id = $1 AND name = 'Pay Tester')`, [demo.business]);
    await admin.query(`DELETE FROM customers WHERE tenant_id = $1 AND name = 'Pay Tester'`, [demo.business]);
    await admin.query(`DELETE FROM audit_log WHERE action = 'Sale' AND source = 'Velnes app'`);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('quotes the visit, applies the salon’s promo code and gift card, and refuses a bad code honestly', async () => {
    const b = await bookAsGuest('pay1@example.test');
    expect(b.payToken).toBeTruthy();
    const plain = await quote({ appointmentId: b.ref, token: b.payToken });
    expect(plain.statusCode).toBe(200);
    expect(plain.json().status).toBe('payable');
    expect(plain.json().total).toBe(b.price);
    const withCodes = await quote({ appointmentId: b.ref, token: b.payToken, promoCode: 'welcome10', giftCode: 'VEL-3317-9042' });
    const q = withCodes.json();
    expect(q.promo).toMatchObject({ code: 'WELCOME10', amount: 10 });
    expect(q.gift).toMatchObject({ code: 'VEL-3317-9042', amount: 50, remaining: 50 });
    expect(q.total).toBe(b.price - 10 - 50);
    expect(q.codeError).toBeNull();
    const bad = await quote({ appointmentId: b.ref, token: b.payToken, promoCode: 'NOPE' });
    expect(bad.json().promo).toBeNull();
    expect(bad.json().codeError).toBe('Unknown code');
    // Wrong token: not their appointment.
    const stranger = await quote({ appointmentId: b.ref, token: 'not-the-token' });
    expect(stranger.statusCode).toBe(403);
  });

  it('a card payment is a sale: invoice, transaction with the provider ref, codes redeemed, appointment paid, bells and mail', async () => {
    const b = await bookAsGuest('pay2@example.test');
    const res = await pay({ appointmentId: b.ref, token: b.payToken, method: 'card', card: visa, promoCode: 'WELCOME10', giftCode: 'VEL-3317-9042' });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.status).toBe('paid');
    expect(out.amount).toBe(b.price - 60);
    expect(out.card).toEqual({ brand: 'Visa', last4: '4242' });
    expect(out.invoiceNumber).toMatch(/^AER-|^[A-Z]+-\d+/);
    const inv = await admin.query(`SELECT method, total, promo_code, promo_amount, gift_amount, employee_name FROM invoices WHERE idempotency_key = $1`, [`pay:${b.ref}`]);
    expect(inv.rows[0]).toMatchObject({ method: 'Online card', total: b.price - 60, promo_code: 'WELCOME10', promo_amount: 10, gift_amount: 50 });
    const mtx = await admin.query(
      `SELECT m.status, m.provider_ref FROM merchant_transactions m JOIN checkouts c ON c.id = m.checkout_id JOIN invoices i ON i.id = c.invoice_id WHERE i.idempotency_key = $1`,
      [`pay:${b.ref}`],
    );
    expect(mtx.rows.length).toBeGreaterThan(0);
    expect(mtx.rows[0].provider_ref).toMatch(/^mock_ch_/);
    const gift = await admin.query(`SELECT remaining FROM gift_cards WHERE code = 'VEL-3317-9042'`);
    expect(gift.rows[0].remaining).toBe(0);
    const promo = await admin.query(`SELECT used FROM discount_codes WHERE code = 'WELCOME10'`);
    expect(promo.rows[0].used).toBe(133);
    const appt = await admin.query(`SELECT paid FROM appointments WHERE id = $1`, [b.ref]);
    expect(appt.rows[0].paid).toBe('paid');
    // The workspace's truth is the invoice line: the drawer says paid.
    const login = await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email: 'maria@velnes.mk', password: 'velnes-demo' } });
    const seen = await app.inject({ method: 'GET', url: `${API_PREFIX}/appointments/${b.ref}`, headers: { authorization: `Bearer ${login.json().accessToken}` } });
    expect(seen.json().paid).toBe(true);
    const bell = await admin.query(`SELECT kind FROM platform_notices WHERE ref_id = $1 ORDER BY created_at`, [b.ref]);
    expect(bell.rows.map((r) => r.kind)).toEqual(['booking', 'payment']);
    const mail = await admin.query(`SELECT kind FROM mail_outbox WHERE ref_id = $1 ORDER BY created_at`, [b.ref]);
    expect(mail.rows.map((r) => r.kind)).toEqual(['booking_confirmed', 'payment_received']);
    // Paying twice is refused, never charged twice.
    const again = await pay({ appointmentId: b.ref, token: b.payToken, method: 'card', card: visa });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('ALREADY_PAID');
  });

  it('the mock provider declines the one card it declines, and a bad expiry', async () => {
    const b = await bookAsGuest('pay3@example.test');
    const declined = await pay({ appointmentId: b.ref, token: b.payToken, method: 'card', card: { ...visa, number: '4000 0000 0000 0000' } });
    expect(declined.statusCode).toBe(409);
    expect(declined.json().code).toBe('CARD_DECLINED');
    const expired = await pay({ appointmentId: b.ref, token: b.payToken, method: 'card', card: { ...visa, expYear: 2024 } });
    expect(expired.json().code).toBe('CARD_DECLINED');
    // Nothing was sold.
    const inv = await admin.query(`SELECT id FROM invoices WHERE idempotency_key = $1`, [`pay:${b.ref}`]);
    expect(inv.rows).toHaveLength(0);
  });

  it('Apple Pay is a sale too, labelled as such', async () => {
    const b = await bookAsGuest('pay4@example.test');
    const res = await pay({ appointmentId: b.ref, token: b.payToken, method: 'apple_pay', applePayToken: 'mock_ap_token' });
    expect(res.statusCode).toBe(200);
    expect(res.json().card).toEqual({ brand: 'Apple Pay', last4: '' });
    const inv = await admin.query(`SELECT method FROM invoices WHERE idempotency_key = $1`, [`pay:${b.ref}`]);
    expect(inv.rows[0].method).toBe('Apple Pay');
  });

  it('paying at the venue charges nothing and leaves the appointment for the till', async () => {
    const b = await bookAsGuest('pay5@example.test');
    const res = await pay({ appointmentId: b.ref, token: b.payToken, method: 'venue' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'venue', amount: b.price, invoiceNumber: null, card: null });
    const inv = await admin.query(`SELECT id FROM invoices WHERE idempotency_key = $1`, [`pay:${b.ref}`]);
    expect(inv.rows).toHaveLength(0);
    const hist = await admin.query(`SELECT what FROM appointment_history WHERE appointment_id = $1 ORDER BY at`, [b.ref]);
    expect(hist.rows.map((r) => r.what)).toEqual(['Created', 'Will pay at the venue']);
  });

  it('a request cannot be paid until the salon accepts it', async () => {
    await admin.query(`UPDATE businesses SET settings = jsonb_set(settings, '{marketplace,autoConfirm}', 'false') WHERE id = $1`, [demo.business]);
    try {
      const b = await bookAsGuest('pay6@example.test');
      expect(b.status).toBe('requested');
      const q = await quote({ appointmentId: b.ref, token: b.payToken });
      expect(q.json().status).toBe('requested');
      const res = await pay({ appointmentId: b.ref, token: b.payToken, method: 'card', card: visa });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('NOT_PAYABLE');
    } finally {
      await admin.query(`UPDATE businesses SET settings = jsonb_set(settings, '{marketplace,autoConfirm}', 'true') WHERE id = $1`, [demo.business]);
    }
  });
});
