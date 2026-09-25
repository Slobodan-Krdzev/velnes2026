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
let ownerToken = '';
let anaToken = '';
let id = '';

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown, token = ownerToken) =>
  app.inject({ method, url: `${API_PREFIX}${url}`, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
const iso = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// The booking half of the story needs a day with a free slot at
// Aerodrom. A fixed "45 days ahead" is a different weekday every day
// and lands, some weeks, on one the seeded team has fully off — so the
// test pins its own precondition: a Thursday, 45–51 days out (the
// payments suite pins one a week nearer).
const bookDay = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 51 - ((d.getDay() + 5) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

describe('discount codes — made in Marketing, switched off in one place, honoured everywhere', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    const login = async (email: string) =>
      (await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email, password: 'velnes-demo' } })).json().accessToken as string;
    ownerToken = await login('maria@velnes.mk');
    anaToken = await login('ana@velnes.mk');
  });
  afterAll(async () => {
    await admin.query(`DELETE FROM discount_codes WHERE tenant_id = $1 AND code IN ('TESTCODE10', 'TESTFIX')`, [demo.business]);
    await admin.query(`DELETE FROM audit_log WHERE action LIKE 'Discount code %'`);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('creates a code (upper-cased, validated), refuses a duplicate and the wrong right', async () => {
    const res = await call('POST', '/discount-codes', { code: 'testcode10', type: 'Percentage', value: 10, starts: iso(-1), ends: iso(30), usageLimit: 5 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ code: 'TESTCODE10', type: 'Percentage', value: 10, used: 0, usageLimit: 5, active: true, status: 'Active' });
    id = res.json().id;
    const dup = await call('POST', '/discount-codes', { code: 'TESTCODE10', type: 'Percentage', value: 5, starts: iso(0), ends: iso(1) });
    expect(dup.statusCode).toBe(409);
    const tooBig = await call('POST', '/discount-codes', { code: 'TESTBIG', type: 'Percentage', value: 120, starts: iso(0), ends: iso(1) });
    expect(tooBig.statusCode).toBe(400);
    const denied = await call('POST', '/discount-codes', { code: 'TESTNOPE', type: 'Fixed amount', value: 100, starts: iso(0), ends: iso(1) }, anaToken);
    expect(denied.statusCode).toBe(403);
    const list = await call('GET', '/discount-codes');
    expect(list.json().codes.some((c: { code: string }) => c.code === 'TESTCODE10')).toBe(true);
  });

  it('the till and the Velnes app both take it while on — and both refuse it once switched off', async () => {
    const till = await call('POST', '/till/validate-code', { code: 'testcode10', subtotal: 2000 });
    expect(till.json()).toMatchObject({ kind: 'promo', code: 'TESTCODE10', amount: 200 });
    const off = await call('PATCH', `/discount-codes/${id}`, { active: false });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toMatchObject({ active: false, status: 'Off' });
    const tillOff = await call('POST', '/till/validate-code', { code: 'TESTCODE10', subtotal: 2000 });
    expect(tillOff.json()).toMatchObject({ kind: 'invalid' });
    expect(tillOff.json().message).toContain('switched off');
    // The app's quote reads the very same door.
    const slots = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/public/slots`,
      payload: { key: 'salon:velnes-fizio', locationId: demo.locAerodrom, date: bookDay, employeeId: 'any', items: [{ serviceId: demo.s1 }] },
    });
    const slot = slots.json().slots.find((x: { free: boolean }) => x.free);
    expect(slot, `no free slot at Aerodrom on ${bookDay}`).toBeDefined();
    const booked = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/public/book`,
      payload: { widgetKey: 'salon:velnes-fizio', key: `codes-${Date.now()}-${Math.random()}`, locationId: demo.locAerodrom, serviceId: demo.s1, date: bookDay, time: slot.t, employeeId: 'any', items: [{ serviceId: demo.s1 }], name: 'Code Tester', phone: '+389 70 999 660', email: 'codes@example.test' },
    });
    expect(booked.statusCode).toBe(200);
    const quoteOff = await app.inject({ method: 'POST', url: `${API_PREFIX}/public/pay/quote`, payload: { key: 'salon:velnes-fizio', token: booked.json().payToken, appointmentId: booked.json().ref, promoCode: 'TESTCODE10' } });
    expect(quoteOff.json().promo).toBeNull();
    expect(quoteOff.json().codeError).toContain('switched off');
    await call('PATCH', `/discount-codes/${id}`, { active: true });
    const quoteOn = await app.inject({ method: 'POST', url: `${API_PREFIX}/public/pay/quote`, payload: { key: 'salon:velnes-fizio', token: booked.json().payToken, appointmentId: booked.json().ref, promoCode: 'TESTCODE10' } });
    expect(quoteOn.json().promo).toMatchObject({ code: 'TESTCODE10' });
    // Tidy the booking this test made.
    await admin.query(`DELETE FROM appointment_history WHERE appointment_id = $1`, [booked.json().ref]);
    await admin.query(`DELETE FROM appointments WHERE id = $1`, [booked.json().ref]);
    await admin.query(`DELETE FROM platform_notices WHERE ref_id = $1`, [booked.json().ref]);
    await admin.query(`DELETE FROM mail_outbox WHERE ref_id = $1`, [booked.json().ref]);
    await admin.query(`DELETE FROM customers WHERE tenant_id = $1 AND name = 'Code Tester'`, [demo.business]);
  });

  it('an unused code can be deleted; a used one is kept for the record', async () => {
    const gone = await call('DELETE', `/discount-codes/${id}`);
    expect(gone.statusCode).toBe(200);
    const used = await admin.query(`SELECT id FROM discount_codes WHERE code = 'WELCOME10'`);
    const keep = await call('DELETE', `/discount-codes/${used.rows[0].id}`);
    expect(keep.statusCode).toBe(409);
  });
});
