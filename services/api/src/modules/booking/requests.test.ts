import { randomUUID } from 'node:crypto';
import { API_PREFIX } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { env } from '../../env.js';
import { buildServer } from '../../server.js';
import { guestPayToken } from './requests.service.js';

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
const P = `${API_PREFIX}/public`;
let mariaToken = '';
let anaToken = '';
const made: string[] = [];

/** A Tuesday four weeks out — the visit tests use the same rule for
 *  their own weeks, so nobody's booking is in anybody's way. */
const day = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 30 - ((d.getDay() + 5) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

async function freeSlot() {
  const slots = await app.inject({
    method: 'POST',
    url: `${P}/slots`,
    payload: { key: 'salon:velnes-fizio', locationId: demo.locAerodrom, date: day, employeeId: 'any', items: [{ serviceId: demo.s1 }] },
  });
  const slot = slots.json().slots.find((x: { free: boolean }) => x.free);
  expect(slot).toBeDefined();
  return slot.t as string;
}

async function bookAsGuest(email: string, name: string) {
  const res = await app.inject({
    method: 'POST',
    url: `${P}/book`,
    payload: {
      widgetKey: 'salon:velnes-fizio',
      key: randomUUID(),
      locationId: demo.locAerodrom,
      serviceId: demo.s1,
      date: day,
      time: await freeSlot(),
      employeeId: 'any',
      items: [{ serviceId: demo.s1 }],
      name,
      phone: '+389 70 999 330',
      email,
    },
  });
  expect(res.statusCode).toBe(200);
  made.push(res.json().ref as string);
  return res.json() as { ref: string; status: string };
}

describe('booking requests — a salon that confirms by hand', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    const login = async (email: string) =>
      (await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email, password: 'velnes-demo' } })).json()
        .accessToken as string;
    mariaToken = await login('maria@velnes.mk');
    anaToken = await login('ana@velnes.mk');
    await admin.query(
      `UPDATE businesses SET settings = jsonb_set(settings, '{marketplace,autoConfirm}', 'false') WHERE id = $1`,
      [demo.business],
    );
  });
  afterAll(async () => {
    await admin.query(
      `UPDATE businesses SET settings = jsonb_set(settings, '{marketplace,autoConfirm}', 'true') WHERE id = $1`,
      [demo.business],
    );
    if (made.length) {
      await admin.query(`DELETE FROM appointment_history WHERE appointment_id = ANY($1)`, [made]);
      await admin.query(`DELETE FROM appointments WHERE id = ANY($1)`, [made]);
      await admin.query(`DELETE FROM platform_notices WHERE ref_id = ANY($1)`, [made]);
      await admin.query(`DELETE FROM mail_outbox WHERE ref_id = ANY($1)`, [made]);
    }
    await admin.query(`DELETE FROM customers WHERE tenant_id = $1 AND name LIKE 'Request Tester%'`, [demo.business]);
    await admin.query(`DELETE FROM audit_log WHERE action LIKE 'Booking request %'`);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('lands a Velnes-app booking as a request, rings the salon and mails the owner', async () => {
    const out = await bookAsGuest('req1@example.test', 'Request Tester One');
    expect(out.status).toBe('requested');
    const row = await admin.query(`SELECT status FROM appointments WHERE id = $1`, [out.ref]);
    expect(row.rows[0].status).toBe('requested');
    const bell = await admin.query(`SELECT kind, audience FROM platform_notices WHERE ref_id = $1`, [out.ref]);
    expect(bell.rows[0]).toEqual({ kind: 'booking_request', audience: 'salons' });
    const mails = await admin.query(`SELECT kind, to_email FROM mail_outbox WHERE ref_id = $1 ORDER BY kind`, [out.ref]);
    expect(mails.rows).toEqual([
      { kind: 'booking_request', to_email: 'maria@velnes.mk' },
      { kind: 'booking_requested', to_email: 'req1@example.test' },
    ]);
  });

  it('a request holds its slot — that professional is not free at that time any more', async () => {
    const out = await bookAsGuest('req2@example.test', 'Request Tester Two');
    const a = await admin.query(`SELECT employee_id, start_min FROM appointments WHERE id = $1`, [out.ref]);
    const m = Number(a.rows[0].start_min);
    const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const slots = await app.inject({
      method: 'POST',
      url: `${P}/slots`,
      payload: {
        key: 'salon:velnes-fizio',
        locationId: demo.locAerodrom,
        date: day,
        employeeId: a.rows[0].employee_id,
        items: [{ serviceId: demo.s1 }],
      },
    });
    const same = slots.json().slots.find((x: { t: string }) => x.t === t);
    expect(same === undefined || same.free === false).toBe(true);
  });

  it('a colleague holding appointments.edit at the location may decide', async () => {
    const out = await bookAsGuest('req3@example.test', 'Request Tester Three');
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/appointments/${out.ref}/decide`,
      headers: { authorization: `Bearer ${anaToken}` },
      payload: { decision: 'accept' },
    });
    // Ana's kit carries appointments.edit at her location: allowed.
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('booked');
  });

  it('accepting books it and mails the customer the payment link (a guest gets a tokened one)', async () => {
    const out = await bookAsGuest('req4@example.test', 'Request Tester Four');
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/appointments/${out.ref}/decide`,
      headers: { authorization: `Bearer ${mariaToken}` },
      payload: { decision: 'accept' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('booked');
    const hist = await admin.query(`SELECT what FROM appointment_history WHERE appointment_id = $1 ORDER BY at`, [out.ref]);
    expect(hist.rows.map((r) => r.what)).toEqual(['Requested', 'Accepted']);
    const mail = await admin.query(`SELECT body FROM mail_outbox WHERE ref_id = $1 AND kind = 'booking_accepted'`, [out.ref]);
    expect(mail.rows).toHaveLength(1);
    expect(mail.rows[0].body).toContain(`${env.consumerAppUrl}/pay/${out.ref}?t=${guestPayToken(out.ref)}`);
    // Deciding twice is refused, never silently repeated.
    const again = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/appointments/${out.ref}/decide`,
      headers: { authorization: `Bearer ${mariaToken}` },
      payload: { decision: 'decline' },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('NOT_A_REQUEST');
  });

  it('declining frees the slot and tells the customer, note included', async () => {
    const out = await bookAsGuest('req5@example.test', 'Request Tester Five');
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/appointments/${out.ref}/decide`,
      headers: { authorization: `Bearer ${mariaToken}` },
      payload: { decision: 'decline', reason: 'Fully booked that afternoon' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');
    const mail = await admin.query(`SELECT body FROM mail_outbox WHERE ref_id = $1 AND kind = 'booking_declined'`, [out.ref]);
    expect(mail.rows[0].body).toContain('Fully booked that afternoon');
    expect(mail.rows[0].body).not.toContain('/pay/');
  });

  it('with auto-confirm on, the same booking lands booked and the customer is mailed the link at once', async () => {
    await admin.query(
      `UPDATE businesses SET settings = jsonb_set(settings, '{marketplace,autoConfirm}', 'true') WHERE id = $1`,
      [demo.business],
    );
    try {
      const out = await bookAsGuest('req6@example.test', 'Request Tester Six');
      expect(out.status).toBe('booked');
      const mails = await admin.query(`SELECT kind FROM mail_outbox WHERE ref_id = $1`, [out.ref]);
      expect(mails.rows.map((r) => r.kind)).toEqual(['booking_confirmed']);
      const bell = await admin.query(`SELECT kind FROM platform_notices WHERE ref_id = $1`, [out.ref]);
      expect(bell.rows[0].kind).toBe('booking');
    } finally {
      await admin.query(
        `UPDATE businesses SET settings = jsonb_set(settings, '{marketplace,autoConfirm}', 'false') WHERE id = $1`,
        [demo.business],
      );
    }
  });
});
