import { randomUUID } from 'node:crypto';
import { API_PREFIX, ClientAppointmentsSchema, ChangeRequestSchema, ChangeRequestListSchema, AppointmentChangesSchema, CustomerApptsSchema } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';

/**
 * Booking changes (Alex, 2026-09-30) — docs/BOOKING-CHANGES.md.
 *
 * A customer's reschedule is a request the salon approves or declines;
 * the original stays until then. A cancellation is policy-governed,
 * whole-visit, recorded with its actor, and it frees the slot, feeds
 * Premium once and tells both sides. Against the seeded world: Velnes
 * Fizio Centar (Maria owns it, Ana is staff with appointments.edit),
 * with one consumer account made here and removed after.
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
const EMAIL = `changes.${Date.now()}@example.test`;
const PASSWORD = 'velnes-test-12345';
let token = '';
let clientId = '';
let mariaToken = '';
let anaToken = '';
const made: string[] = [];

/** Tuesdays five and six weeks out — the visit tests use the same
 *  rule for their own weeks, so nobody's booking is in anybody's way. */
const tuesday = (weeks: number) => {
  const d = new Date();
  d.setDate(d.getDate() + weeks * 7 - ((d.getDay() + 5) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const DAY = tuesday(5);
const DAY2 = tuesday(6);

const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const client = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({ method, url: `${C}${url}`, headers: auth(token), ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });

async function myAppointment(id: string) {
  const res = await client('GET', '/me/appointments');
  expect(res.statusCode).toBe(200);
  const a = ClientAppointmentsSchema.parse(res.json()).appointments.find((x) => x.id === id);
  expect(a).toBeDefined();
  return a!;
}

async function freeAt(date: string, employeeId: string, serviceId = demo.s3): Promise<string[]> {
  const slots = await app.inject({
    method: 'POST',
    url: `${P}/slots`,
    payload: { key: 'salon:velnes-fizio', locationId: demo.locCentar, date, employeeId, items: [{ serviceId }] },
  });
  return (slots.json().slots as { t: string; free: boolean }[]).filter((s) => s.free).map((s) => s.t);
}

/** A visit of the client's own: Follow-up session with Maria at Centar. */
async function bookMine(date: string, time?: string): Promise<{ id: string; time: string }> {
  const t = time ?? (await freeAt(date, demo.empMaria))[0]!;
  const res = await client('POST', '/book', {
    slug: 'velnes-fizio',
    key: randomUUID(),
    locationId: demo.locCentar,
    serviceId: demo.s3,
    date,
    time: t,
    employeeId: demo.empMaria,
  });
  expect(res.statusCode).toBe(200);
  const id = res.json().ref as string;
  made.push(id);
  return { id, time: t };
}

// The booking's own messages (the confirmation) are not the change's.
const bell = async (refId: string) => (await admin.query(`SELECT kind, title FROM platform_notices WHERE ref_id = $1 AND kind <> 'booking' ORDER BY created_at`, [refId])).rows as { kind: string; title: string }[];
const mails = async (refId: string) => (await admin.query(`SELECT kind, to_email FROM mail_outbox WHERE ref_id = $1 AND kind NOT IN ('booking_confirmed', 'booking_requested') ORDER BY created_at`, [refId])).rows as { kind: string; to_email: string }[];
const clientBell = async (refId: string) => (await admin.query(`SELECT kind, title FROM client_notifications WHERE ref_id = $1 AND title NOT IN ('Booking confirmed', 'Request sent') ORDER BY created_at`, [refId])).rows as { kind: string; title: string }[];
const historyOf = async (id: string) => (await admin.query(`SELECT what, source FROM appointment_history WHERE appointment_id = $1 ORDER BY at`, [id])).rows as { what: string; source: string }[];
const rowOf = async (id: string) => (await admin.query(`SELECT status, date::text AS date, start_min, cancelled_by, cancel_reason, cancelled_at, cancel_hours FROM appointments WHERE id = $1`, [id])).rows[0] as { status: string; date: string; start_min: number; cancelled_by: string | null; cancel_reason: string | null; cancelled_at: Date | null; cancel_hours: number };

describe('booking changes — reschedule requests and cancellation', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    const login = async (email: string) =>
      (await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email, password: 'velnes-demo' } })).json().accessToken as string;
    mariaToken = await login('maria@velnes.mk');
    anaToken = await login('ana@velnes.mk');
    // One consumer account, through the front door.
    await app.inject({ method: 'POST', url: `${C}/register`, payload: { email: EMAIL, password: PASSWORD, first: 'Change', last: 'Tester', phone: '+389 70 777 001', dob: null, lang: 'mk' } });
    const code = (await admin.query(`SELECT body FROM mail_outbox WHERE to_email=$1 AND kind='client_email_verify' ORDER BY sent_at DESC LIMIT 1`, [EMAIL.toLowerCase()])).rows[0].body.match(/code is (\d{6})/)![1];
    const v = await app.inject({ method: 'POST', url: `${C}/verify-email`, payload: { email: EMAIL, code } });
    token = v.json().token;
    clientId = v.json().profile.id;
  });
  afterAll(async () => {
    await admin.query(`DELETE FROM refunds WHERE appointment_id = ANY($1)`, [made]);
    await admin.query(`DELETE FROM booking_change_requests WHERE appointment_id = ANY($1)`, [made]);
    await admin.query(`DELETE FROM premium_offers WHERE rec_id IN (SELECT id FROM member_recs WHERE slot_key IS NOT NULL AND tenant_id = $1)`, [demo.business]);
    await admin.query(`DELETE FROM member_recs WHERE slot_key IS NOT NULL AND tenant_id = $1`, [demo.business]);
    await admin.query(`DELETE FROM appointment_history WHERE appointment_id = ANY($1)`, [made]);
    await admin.query(`DELETE FROM appointments WHERE id = ANY($1)`, [made]);
    await admin.query(`DELETE FROM platform_notices WHERE ref_id = ANY($1)`, [made]);
    await admin.query(`DELETE FROM mail_outbox WHERE ref_id = ANY($1) OR to_email = $2`, [made, EMAIL.toLowerCase()]);
    await admin.query(`DELETE FROM client_notifications WHERE client_user_id = $1`, [clientId]);
    const links = await admin.query(`SELECT customer_id FROM client_customer_links WHERE client_user_id = $1`, [clientId]);
    await admin.query(`DELETE FROM client_customer_links WHERE client_user_id = $1`, [clientId]);
    for (const l of links.rows) await admin.query(`DELETE FROM customers WHERE id = $1`, [l.customer_id]);
    await admin.query(`DELETE FROM client_users WHERE id = $1`, [clientId]);
    await admin.query(`DELETE FROM audit_log WHERE actor_name = 'Change Tester' OR action IN ('Reschedule approved','Reschedule declined')`);
    await admin.end();
    await app.close();
    await closeDb();
  });

  describe('a request, approved', () => {
    let id = '';
    let start = '';
    let requestedTime = '';
    let blocker = '';

    it('a fresh visit carries its rights: reschedule and cancel, with the deadline the snapshot gives', async () => {
      ({ id, time: start } = await bookMine(DAY));
      const a = await myAppointment(id);
      expect(a.canReschedule).toBe(true);
      expect(a.canCancel).toBe(true);
      expect(a.cancelHours).toBe(24);
      expect((await rowOf(id)).cancel_hours).toBe(24);
      expect(a.cancelBlockedReason).toBeNull();
      // The deadline is start − 24h, in Skopje: the visit's local start
      // converted, not the date string re-read in the server's zone.
      const startAt = new Date(a.cancelDeadline!).getTime() + 24 * 3_600_000;
      const skopje = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Skopje', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(startAt));
      expect(skopje).toBe(start);
      expect(a.payment.status).toBe('unpaid');
      expect(a.changeRequest).toBeNull();
      expect(a.history.map((h) => h.what)).toEqual(['Created']);
    });

    it('refuses its own time, a time that has passed, and a stranger\'s appointment', async () => {
      const same = await client('POST', `/me/appointments/${id}/reschedule`, { date: DAY, time: start });
      expect(same.statusCode).toBe(409);
      expect(same.json().code).toBe('SAME_TIME');
      const past = await client('POST', `/me/appointments/${id}/reschedule`, { date: '2020-01-01', time: '10:00' });
      expect(past.json().code).toBe('TIME_PASSED');
      const stranger = await client('POST', `/me/appointments/${randomUUID()}/reschedule`, { date: DAY, time: '10:00' });
      expect(stranger.statusCode).toBe(404);
    });

    it('offers the visit\'s free starts on another day, its own slot out of the way', async () => {
      const res = await client('GET', `/me/appointments/${id}/reschedule-slots?date=${DAY2}`);
      expect(res.statusCode).toBe(200);
      const free = (res.json().slots as { t: string; free: boolean }[]).filter((s) => s.free);
      expect(free.length).toBeGreaterThan(0);
      requestedTime = free[free.length - 1]!.t;
      // Its own day too: the slot it holds is offered back (it is not in its own way).
      const own = await client('GET', `/me/appointments/${id}/reschedule-slots?date=${DAY}`);
      expect((own.json().slots as { t: string; free: boolean }[]).find((s) => s.t === start)?.free).toBe(true);
    });

    it('the request is recorded, the original untouched, the salon rung and mailed — and a second request refused', async () => {
      const res = await client('POST', `/me/appointments/${id}/reschedule`, { date: DAY2, time: requestedTime });
      expect(res.statusCode).toBe(200);
      const r = ChangeRequestSchema.parse(res.json());
      expect(r.status).toBe('pending');
      expect(r.originalDate).toBe(DAY);
      expect(r.originalTime).toBe(start);
      expect(r.requestedDate).toBe(DAY2);
      expect(r.requestedTime).toBe(requestedTime);
      const row = await rowOf(id);
      expect(row.status).toBe('booked');
      expect(row.date).toBe(DAY);
      expect(await bell(id)).toEqual([{ kind: 'booking_change', title: 'Reschedule request' }]);
      expect(await mails(id)).toEqual([{ kind: 'reschedule_requested', to_email: 'maria@velnes.mk' }]);
      expect((await historyOf(id)).map((h) => h.what)).toEqual(['Created', 'Reschedule requested']);
      const again = await client('POST', `/me/appointments/${id}/reschedule`, { date: DAY2, time: requestedTime });
      expect(again.statusCode).toBe(409);
      expect(again.json().code).toBe('REQUEST_ACTIVE');
      const a = await myAppointment(id);
      expect(a.changeRequest?.status).toBe('pending');
      expect(a.canReschedule).toBe(false);
      expect(a.canCancel).toBe(true);
      // The original slot is still occupied while the request waits.
      expect((await freeAt(DAY, demo.empMaria)).includes(start)).toBe(false);
    });

    it('the salon sees it in the inbox, and own-agenda staff only their own', async () => {
      const res = await app.inject({ method: 'GET', url: `${API_PREFIX}/change-requests?status=pending`, headers: auth(mariaToken) });
      expect(res.statusCode).toBe(200);
      const list = ChangeRequestListSchema.parse(res.json());
      const mine = list.requests.find((r) => r.appointmentId === id);
      expect(mine).toMatchObject({ customerName: 'Change Tester', serviceName: 'Follow-up session', employeeName: 'Maria Petrovska', locationName: 'Centar' });
      const ana = await app.inject({ method: 'GET', url: `${API_PREFIX}/change-requests?status=pending`, headers: auth(anaToken) });
      expect(ana.statusCode).toBe(200);
      expect(ana.json().requests.find((r: { appointmentId: string }) => r.appointmentId === id)).toBeUndefined();
    });

    it('approval fails safely when the requested time was taken meanwhile — no double booking', async () => {
      const book = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/appointments`,
        headers: auth(mariaToken),
        payload: { key: randomUUID(), locationId: demo.locCentar, serviceId: demo.s3, date: DAY2, time: requestedTime, employeeId: demo.empMaria, name: 'Blocker Person', phone: '+389 70 777 002' },
      });
      expect(book.statusCode).toBe(200);
      blocker = book.json().appointment.id;
      made.push(blocker);
      const a = await myAppointment(id);
      const res = await app.inject({ method: 'POST', url: `${API_PREFIX}/change-requests/${a.changeRequest!.id}/approve`, headers: auth(mariaToken) });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('SLOT_TAKEN');
      expect((await rowOf(id)).date).toBe(DAY);
      expect((await myAppointment(id)).changeRequest?.status).toBe('pending');
    });

    it('approved: every leg moves, the old slot frees, the new one is taken, the customer hears in their language', async () => {
      await app.inject({ method: 'PATCH', url: `${API_PREFIX}/appointments/${blocker}`, headers: auth(mariaToken), payload: { status: 'cancelled' } });
      const a = await myAppointment(id);
      const res = await app.inject({ method: 'POST', url: `${API_PREFIX}/change-requests/${a.changeRequest!.id}/approve`, headers: auth(mariaToken) });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('approved');
      expect(res.json().resolvedByName).toBe('Maria Petrovska');
      const row = await rowOf(id);
      expect(row.date).toBe(DAY2);
      expect(row.status).toBe('booked');
      const moved = await myAppointment(id);
      expect(moved.date).toBe(DAY2);
      expect(moved.time).toBe(requestedTime);
      expect(moved.changeRequest?.status).toBe('approved');
      expect(moved.canReschedule).toBe(true);
      // Availability: the old start is free again, the new one is not.
      expect((await freeAt(DAY, demo.empMaria)).includes(start)).toBe(true);
      expect((await freeAt(DAY2, demo.empMaria)).includes(requestedTime)).toBe(false);
      expect(await clientBell(id)).toEqual([{ kind: 'appointment', title: 'Вашето презакажување е одобрено' }]);
      expect(await mails(id)).toEqual([
        { kind: 'reschedule_requested', to_email: 'maria@velnes.mk' },
        { kind: 'reschedule_approved', to_email: EMAIL.toLowerCase() },
      ]);
      expect((await historyOf(id)).map((h) => h.what)).toEqual(['Created', 'Reschedule requested', 'Reschedule approved']);
      // The deadline follows the new time, with the same snapshot.
      const startAt = new Date(moved.cancelDeadline!).getTime() + 24 * 3_600_000;
      expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Skopje', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(startAt))).toBe(requestedTime);
      // Retried: the transition is gone, nothing is sent twice.
      const again = await app.inject({ method: 'POST', url: `${API_PREFIX}/change-requests/${a.changeRequest!.id}/approve`, headers: auth(mariaToken) });
      expect(again.statusCode).toBe(409);
      expect(again.json().code).toBe('NO_REQUEST');
      expect((await mails(id)).filter((m) => m.kind === 'reschedule_approved')).toHaveLength(1);
      // The workspace's view of the visit.
      const ch = await app.inject({ method: 'GET', url: `${API_PREFIX}/appointments/${id}/changes`, headers: auth(mariaToken) });
      const changes = AppointmentChangesSchema.parse(ch.json());
      expect(changes.changeRequest?.status).toBe('approved');
      expect(changes.history.map((h) => h.what)).toContain('Reschedule approved');
      expect(changes.cancelHours).toBe(24);
    });

    it('a pending request can be withdrawn; the original never moved', async () => {
      const slots = await freeAt(DAY, demo.empMaria);
      const res = await client('POST', `/me/appointments/${id}/reschedule`, { date: DAY, time: slots[0]! });
      expect(res.statusCode).toBe(200);
      const w = await client('POST', `/me/appointments/${id}/reschedule/withdraw`);
      expect(w.statusCode).toBe(200);
      expect(w.json().status).toBe('withdrawn');
      expect((await rowOf(id)).date).toBe(DAY2);
      const twice = await client('POST', `/me/appointments/${id}/reschedule/withdraw`);
      expect(twice.json().code).toBe('NO_REQUEST');
      expect((await myAppointment(id)).canReschedule).toBe(true);
    });
  });

  describe('a request, declined', () => {
    let id = '';
    let start = '';

    it('declined by staff with a reason: the original stays, the customer is asked, and cannot request again until they answer', async () => {
      ({ id, time: start } = await bookMine(DAY));
      const slots = (await freeAt(DAY2, demo.empMaria)).filter((t) => t !== start);
      const res = await client('POST', `/me/appointments/${id}/reschedule`, { date: DAY2, time: slots[0]! });
      expect(res.statusCode).toBe(200);
      const d = await app.inject({ method: 'POST', url: `${API_PREFIX}/change-requests/${res.json().id}/decline`, headers: auth(anaToken), payload: { reason: 'Fully booked that day' } });
      expect(d.statusCode).toBe(200);
      expect(d.json().status).toBe('declined');
      expect(d.json().declineReason).toBe('Fully booked that day');
      expect((await rowOf(id))).toMatchObject({ status: 'booked', date: DAY });
      expect(await clientBell(id)).toEqual([{ kind: 'appointment', title: 'Вашето барање за презакажување не е одобрено' }]);
      expect((await mails(id)).map((m) => m.kind)).toEqual(['reschedule_requested', 'reschedule_declined']);
      const a = await myAppointment(id);
      expect(a.changeRequest?.status).toBe('declined');
      expect(a.changeRequest?.customerDecision).toBeNull();
      expect(a.canReschedule).toBe(false);
      expect(a.canCancel).toBe(true);
      const again = await client('POST', `/me/appointments/${id}/reschedule`, { date: DAY2, time: slots[0]! });
      expect(again.json().code).toBe('REQUEST_ACTIVE');
    });

    it('the customer keeps the original: recorded, the salon told, rights restored', async () => {
      const k = await client('POST', `/me/appointments/${id}/reschedule/keep`);
      expect(k.statusCode).toBe(200);
      expect(k.json()).toMatchObject({ status: 'resolved', customerDecision: 'keep' });
      expect((await bell(id)).map((b) => b.kind)).toEqual(['booking_change', 'booking_change']);
      expect((await bell(id))[1]!.title).toBe('Customer is keeping the original appointment');
      expect((await mails(id)).map((m) => m.kind)).toEqual(['reschedule_requested', 'reschedule_declined', 'reschedule_kept']);
      expect((await historyOf(id)).map((h) => h.what)).toEqual(['Created', 'Reschedule requested', 'Reschedule declined', 'Original appointment kept']);
      const a = await myAppointment(id);
      expect(a.canReschedule).toBe(true);
      expect((await rowOf(id)).status).toBe('booked');
      const twice = await client('POST', `/me/appointments/${id}/reschedule/keep`);
      expect(twice.json().code).toBe('NO_REQUEST');
    });

    it('declined, then cancelled by the customer: the request records the choice, the visit is cancelled by the customer', async () => {
      const slots = (await freeAt(DAY2, demo.empMaria)).filter((t) => t !== start);
      const res = await client('POST', `/me/appointments/${id}/reschedule`, { date: DAY2, time: slots[0]! });
      await app.inject({ method: 'POST', url: `${API_PREFIX}/change-requests/${res.json().id}/decline`, headers: auth(mariaToken) });
      const c = await client('POST', `/me/appointments/${id}/cancel`, { reason: 'Cannot make it' });
      expect(c.statusCode).toBe(200);
      const row = await rowOf(id);
      expect(row.status).toBe('cancelled');
      expect(row.cancelled_by).toBe('customer');
      expect(row.cancel_reason).toBe('Cannot make it');
      expect(row.cancelled_at).not.toBeNull();
      const req = (await admin.query(`SELECT status, customer_decision FROM booking_change_requests WHERE id = $1`, [res.json().id])).rows[0];
      expect(req).toEqual({ status: 'resolved', customer_decision: 'cancel' });
      const a = await myAppointment(id);
      expect(a.status).toBe('cancelled');
      expect(a.cancellation).toMatchObject({ by: 'customer', reason: 'Cannot make it' });
      expect(a.canCancel).toBe(false);
      expect(a.canReschedule).toBe(false);
      expect(a.cancelBlockedReason).toBe('cancelled');
      expect(a.canReview).toBe(false);
      // Everybody hears, once.
      expect((await bell(id)).map((b) => b.kind)).toContain('booking_cancelled');
      expect((await mails(id)).map((m) => m.kind).slice(-2)).toEqual(['booking_cancelled', 'booking_cancelled_customer']);
      expect((await clientBell(id)).map((n) => n.title)).toContain('Вашиот термин е откажан');
      expect((await historyOf(id)).map((h) => h.what).pop()).toBe('Cancelled');
      const audit = await admin.query(`SELECT source, before, after FROM audit_log WHERE action = 'Appointment cancelled' AND actor_name = 'Change Tester' ORDER BY ts DESC LIMIT 1`);
      expect(audit.rows[0]).toEqual({ source: 'client', before: 'booked', after: 'cancelled' });
      // The slot is free again; a second cancel and a reschedule are refused.
      expect((await freeAt(DAY, demo.empMaria)).includes(start)).toBe(true);
      expect((await client('POST', `/me/appointments/${id}/cancel`)).json().code).toBe('ALREADY_CANCELLED');
      expect((await client('POST', `/me/appointments/${id}/reschedule`, { date: DAY2, time: slots[0]! })).json().code).toBe('ALREADY_CANCELLED');
    });
  });

  describe('the cancellation policy', () => {
    it('blocks past the deadline with the reason, whatever the screen showed; zero hours allows until the start', async () => {
      const { id } = await bookMine(DAY2);
      // The snapshot governs: widen this visit's window past the visit itself.
      await admin.query(`UPDATE appointments SET cancel_hours = 2000 WHERE id = $1`, [id]);
      const a = await myAppointment(id);
      expect(a.cancelHours).toBe(2000);
      expect(a.canCancel).toBe(false);
      expect(a.cancelBlockedReason).toBe('too_late');
      expect(a.canReschedule).toBe(true); // no such rule for a request
      const c = await client('POST', `/me/appointments/${id}/cancel`);
      expect(c.statusCode).toBe(409);
      expect(c.json().code).toBe('CANCEL_TOO_LATE');
      expect(c.json().params.hours).toBe(2000);
      expect((await rowOf(id)).status).toBe('booked');
      await admin.query(`UPDATE appointments SET cancel_hours = 0 WHERE id = $1`, [id]);
      expect((await myAppointment(id)).canCancel).toBe(true);
      expect((await client('POST', `/me/appointments/${id}/cancel`)).statusCode).toBe(200);
    });

    it('the salon\'s own cancellation is not policed, is recorded as the salon\'s, and tells the customer', async () => {
      const { id } = await bookMine(DAY2);
      await admin.query(`UPDATE appointments SET cancel_hours = 2000 WHERE id = $1`, [id]);
      const res = await app.inject({ method: 'PATCH', url: `${API_PREFIX}/appointments/${id}`, headers: auth(mariaToken), payload: { status: 'cancelled', reason: 'Therapist ill' } });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('cancelled');
      const row = await rowOf(id);
      expect(row.cancelled_by).toBe('salon');
      expect(row.cancel_reason).toBe('Therapist ill');
      expect((await mails(id)).map((m) => m.kind)).toEqual(['booking_cancelled_salon']);
      expect((await bell(id)).map((b) => b.kind)).not.toContain('booking_cancelled');
      expect((await clientBell(id)).map((n) => n.title)).toContain('Вашиот термин е откажан');
      expect((await myAppointment(id)).cancellation?.by).toBe('salon');
    });
  });

  describe('what the salon learns', () => {
    it('the customer\'s history counts cancellations by actor; requests and kept originals are not cancellations', async () => {
      const cust = (await admin.query(`SELECT customer_id FROM client_customer_links WHERE client_user_id = $1 AND tenant_id = $2`, [clientId, demo.business])).rows[0].customer_id as string;
      const res = await app.inject({ method: 'GET', url: `${API_PREFIX}/customers/${cust}/appointments`, headers: auth(mariaToken) });
      expect(res.statusCode).toBe(200);
      const d = CustomerApptsSchema.parse(res.json());
      // Booked here: approved+withdrawn (live), declined→kept→cancelled by
      // customer, too-late→zero-hours→cancelled by customer, salon-cancelled.
      expect(d.stats.cancelledByCustomer).toBe(2);
      expect(d.stats.cancelledBySalon).toBe(1);
      expect(d.stats.upcoming).toBe(1);
      expect(d.stats.noShows).toBe(0);
      expect(d.upcoming.filter((a) => a.status === 'cancelled').map((a) => a.cancelledBy).sort()).toEqual(['customer', 'customer', 'salon']);
    });

    it('a customer cancellation releases the slot to the existing Premium queue exactly once — a request never does', async () => {
      // A day no earlier cancellation here has touched.
      const FRESH = tuesday(7);
      const { id, time } = await bookMine(FRESH);
      const slotKey = `${demo.locCentar}|${FRESH}|${demo.empMaria}|${time}`;
      const recs = async () => (await admin.query(`SELECT candidates, status FROM member_recs WHERE slot_key = $1`, [slotKey])).rows;
      const slots = (await freeAt(DAY2, demo.empMaria)).filter((t) => t !== time);
      const r = await client('POST', `/me/appointments/${id}/reschedule`, { date: DAY2, time: slots[0]! });
      expect((await recs()).length).toBe(0);
      await app.inject({ method: 'POST', url: `${API_PREFIX}/change-requests/${r.json().id}/decline`, headers: auth(mariaToken) });
      expect((await recs()).length).toBe(0);
      await client('POST', `/me/appointments/${id}/reschedule/keep`);
      expect((await recs()).length).toBe(0);
      expect((await client('POST', `/me/appointments/${id}/cancel`)).statusCode).toBe(200);
      const after = await recs();
      expect(after).toHaveLength(1);
      expect(after[0].status).toBe('pending');
      // Only Premium members, scored the existing way, never the one who freed it.
      const names = (after[0].candidates as { name: string }[]).map((c) => c.name);
      expect(names.length).toBeGreaterThan(0);
      expect(names).not.toContain('Change Tester');
      expect(names).not.toContain('Elena Todorova');
      // A retried cancellation adds nothing.
      expect((await client('POST', `/me/appointments/${id}/cancel`)).statusCode).toBe(409);
      expect(await recs()).toHaveLength(1);
      // And the salon approves it through the door that already exists.
      const rec = (await admin.query(`SELECT id FROM member_recs WHERE slot_key = $1`, [slotKey])).rows[0].id;
      const ok = await app.inject({ method: 'POST', url: `${API_PREFIX}/premium/recommendations/${rec}/approve`, headers: auth(mariaToken) });
      expect(ok.statusCode).toBe(200);
      expect((await recs())[0].status).toBe('approved');
    });
  });
});
