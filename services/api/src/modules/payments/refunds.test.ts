import { randomUUID } from 'node:crypto';
import { API_PREFIX, ClientAppointmentsSchema } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';
import { MockPaymentProvider } from './payments.provider.js';
import { retryRefunds } from './refunds.service.js';

/**
 * Refunds (Alex, 2026-09-30): a cancelled prepaid visit creates a refund
 * intent, the mock provider is asked after the booking is settled, and
 * a refusal leaves a failed intent behind a cancelled booking — never
 * a live one. The amount is the invoice's, never the client's.
 */
const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
const C = `${API_PREFIX}/client`;
const P = `${API_PREFIX}/public`;
const EMAIL = `refunds.${Date.now()}@example.test`;
let token = '';
let clientId = '';
const made: string[] = [];
const DAY = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 49 - ((d.getDay() + 5) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
const visa = { number: '4242 4242 4242 4242', expMonth: 12, expYear: 2031, cvc: '123', holder: 'Refund Tester' };
const client = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({ method, url: `${C}${url}`, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });

async function bookPaid(): Promise<{ id: string; price: number }> {
  const slots = await app.inject({ method: 'POST', url: `${P}/slots`, payload: { key: 'salon:velnes-fizio', locationId: demo.locAerodrom, date: DAY, employeeId: 'any', items: [{ serviceId: demo.s1 }] } });
  const free = (slots.json().slots as { t: string; free: boolean }[]).filter((s) => s.free);
  const res = await client('POST', '/book', { slug: 'velnes-fizio', key: randomUUID(), locationId: demo.locAerodrom, serviceId: demo.s1, date: DAY, time: free[made.length]!.t, employeeId: 'any' });
  expect(res.statusCode).toBe(200);
  const id = res.json().ref as string;
  made.push(id);
  const pay = await client('POST', '/pay', { appointmentId: id, method: 'card', card: visa });
  expect(pay.statusCode).toBe(200);
  expect(pay.json().status).toBe('paid');
  return { id, price: res.json().price as number };
}
const refundOf = async (id: string) => (await admin.query(`SELECT status, amount, attempts, failure_reason, provider_ref, charge_ref FROM refunds WHERE appointment_id = $1`, [id])).rows;
const mine = async (id: string) => ClientAppointmentsSchema.parse((await client('GET', '/me/appointments')).json()).appointments.find((a) => a.id === id)!;

describe('refunds behind a cancellation', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    await app.inject({ method: 'POST', url: `${C}/register`, payload: { email: EMAIL, password: 'velnes-test-12345', first: 'Refund', last: 'Tester', phone: '+389 70 777 010', dob: null, lang: 'en' } });
    const code = (await admin.query(`SELECT body FROM mail_outbox WHERE to_email=$1 AND kind='client_email_verify' ORDER BY sent_at DESC LIMIT 1`, [EMAIL.toLowerCase()])).rows[0].body.match(/code is (\d{6})/)![1];
    const v = await app.inject({ method: 'POST', url: `${C}/verify-email`, payload: { email: EMAIL, code } });
    token = v.json().token;
    clientId = v.json().profile.id;
  });
  afterAll(async () => {
    const keys = made.map((id) => `pay:${id}`);
    await admin.query(`DELETE FROM refunds WHERE appointment_id = ANY($1)`, [made]);
    await admin.query(`DELETE FROM checkout_items WHERE checkout_id IN (SELECT c.id FROM checkouts c JOIN invoices i ON i.id = c.invoice_id WHERE i.idempotency_key = ANY($1))`, [keys]);
    await admin.query(`DELETE FROM merchant_transactions WHERE checkout_id IN (SELECT c.id FROM checkouts c JOIN invoices i ON i.id = c.invoice_id WHERE i.idempotency_key = ANY($1))`, [keys]);
    await admin.query(`DELETE FROM checkouts WHERE invoice_id IN (SELECT id FROM invoices WHERE idempotency_key = ANY($1))`, [keys]);
    await admin.query(`DELETE FROM invoice_lines WHERE appointment_id = ANY($1)`, [made]);
    await admin.query(`DELETE FROM invoices WHERE idempotency_key = ANY($1)`, [keys]);
    await admin.query(`DELETE FROM member_recs WHERE slot_key IS NOT NULL AND tenant_id = $1`, [demo.business]);
    await admin.query(`DELETE FROM appointment_history WHERE appointment_id = ANY($1)`, [made]);
    await admin.query(`DELETE FROM appointments WHERE id = ANY($1)`, [made]);
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
    await admin.query(`DELETE FROM audit_log WHERE actor_name IN ('Refund Tester', 'Velnes app') AND action IN ('Appointment cancelled', 'Refund', 'Sale')`);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('the mock provider refunds, and refuses a charge marked to fail', async () => {
    const p = new MockPaymentProvider();
    expect((await p.refund({ chargeRef: 'mock_ch_abc', amount: 1800, invoiceId: randomUUID() })).ok).toBe(true);
    expect(await p.refund({ chargeRef: 'mock_ch_fail_1', amount: 1800, invoiceId: randomUUID() })).toMatchObject({ ok: false, retry: true });
    expect((await p.refund({ chargeRef: null, amount: 1800, invoiceId: randomUUID() })).retry).toBe(false);
  });

  it('an unpaid visit needs no refund', async () => {
    const slots = await app.inject({ method: 'POST', url: `${P}/slots`, payload: { key: 'salon:velnes-fizio', locationId: demo.locAerodrom, date: DAY, employeeId: 'any', items: [{ serviceId: demo.s5 }] } });
    const free = (slots.json().slots as { t: string; free: boolean }[]).filter((s) => s.free);
    const res = await client('POST', '/book', { slug: 'velnes-fizio', key: randomUUID(), locationId: demo.locAerodrom, serviceId: demo.s5, date: DAY, time: free[free.length - 1]!.t, employeeId: 'any' });
    const id = res.json().ref as string;
    made.push(id);
    expect((await client('POST', `/me/appointments/${id}/cancel`)).statusCode).toBe(200);
    expect(await refundOf(id)).toEqual([]);
    expect((await mine(id)).refund).toBeNull();
  });

  it('a prepaid visit: cancelled first, then refunded in full from the invoice — invoice flipped, both sides told', async () => {
    const { id, price } = await bookPaid();
    expect((await mine(id)).payment).toMatchObject({ status: 'paid', method: 'Online card', amount: price });
    const c = await client('POST', `/me/appointments/${id}/cancel`);
    expect(c.statusCode).toBe(200);
    const [r] = await refundOf(id);
    expect(r).toMatchObject({ status: 'refunded', amount: price, attempts: 1 });
    expect(r.provider_ref).toMatch(/^mock_rf_/);
    expect(r.charge_ref).toMatch(/^mock_ch_/);
    const inv = await admin.query(`SELECT status FROM invoices WHERE idempotency_key = $1`, [`pay:${id}`]);
    expect(inv.rows[0].status).toBe('Refunded');
    const a = await mine(id);
    expect(a.status).toBe('cancelled');
    expect(a.refund).toMatchObject({ status: 'refunded', amount: price });
    expect(a.payment.status).toBe('unpaid'); // the invoice truth: refunded
    const history = (await admin.query(`SELECT what FROM appointment_history WHERE appointment_id = $1 ORDER BY at`, [id])).rows.map((h) => h.what);
    expect(history.slice(-3)).toEqual(['Cancelled', 'Refund requested', 'Refund completed']);
    const mails = (await admin.query(`SELECT kind FROM mail_outbox WHERE ref_id = $1 ORDER BY created_at`, [id])).rows.map((m) => m.kind);
    expect(mails).toContain('booking_cancelled_customer');
    expect(mails).toContain('refund_completed');
    const bell = (await admin.query(`SELECT title FROM client_notifications WHERE ref_id = $1 ORDER BY created_at`, [id])).rows.map((n) => n.title);
    expect(bell).toContain('Refund completed');
    const audit = await admin.query(`SELECT source, reason FROM audit_log WHERE action = 'Refund' AND actor_name = 'Velnes app' ORDER BY ts DESC LIMIT 1`);
    expect(audit.rows[0]).toEqual({ source: 'Velnes app', reason: 'Appointment cancelled' });
    // A second cancellation is refused and makes no second refund.
    expect((await client('POST', `/me/appointments/${id}/cancel`)).statusCode).toBe(409);
    expect(await refundOf(id)).toHaveLength(1);
  });

  it('the provider refuses: the booking stays cancelled, the intent is failed with its reason, the salon is told, a retry clears it', async () => {
    const { id, price } = await bookPaid();
    await admin.query(
      `UPDATE merchant_transactions SET provider_ref = 'mock_ch_fail_test' WHERE checkout_id IN (SELECT c.id FROM checkouts c JOIN invoices i ON i.id = c.invoice_id WHERE i.idempotency_key = $1)`,
      [`pay:${id}`],
    );
    expect((await client('POST', `/me/appointments/${id}/cancel`)).statusCode).toBe(200);
    const [r] = await refundOf(id);
    expect(r).toMatchObject({ status: 'failed', amount: price, attempts: 1, failure_reason: 'Mock provider refused the refund' });
    expect((await admin.query(`SELECT status FROM appointments WHERE id = $1`, [id])).rows[0].status).toBe('cancelled');
    expect((await admin.query(`SELECT status FROM invoices WHERE idempotency_key = $1`, [`pay:${id}`])).rows[0].status).toBe('Paid');
    const a = await mine(id);
    expect(a.refund?.status).toBe('failed');
    const bell = (await admin.query(`SELECT kind FROM platform_notices WHERE ref_id = $1`, [id])).rows.map((n) => n.kind);
    expect(bell).toContain('booking_refund');
    // The customer hears about money only when it moved or finally did not.
    expect((await admin.query(`SELECT kind FROM mail_outbox WHERE ref_id = $1 AND kind LIKE 'refund_%'`, [id])).rows).toEqual([]);
    // The charge reference is corrected (a real gateway would come back); the loop retries.
    await admin.query(`UPDATE refunds SET charge_ref = 'mock_ch_ok', requested_at = now() - interval '2 hours' WHERE appointment_id = $1`, [id]);
    expect(await retryRefunds()).toBeGreaterThanOrEqual(1);
    const [r2] = await refundOf(id);
    expect(r2).toMatchObject({ status: 'refunded', attempts: 2 });
    expect((await admin.query(`SELECT status FROM invoices WHERE idempotency_key = $1`, [`pay:${id}`])).rows[0].status).toBe('Refunded');
    // Retrying a refunded intent does nothing.
    expect(await retryRefunds()).toBe(0);
    expect((await refundOf(id))[0].attempts).toBe(2);
  });
});
