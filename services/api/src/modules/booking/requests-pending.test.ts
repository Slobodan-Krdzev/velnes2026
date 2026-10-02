import { randomUUID } from 'node:crypto';
import { API_PREFIX, PendingRequestsSchema } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';

/**
 * What waits for the salon's answer (Alex, 2026-10-01): one door lists
 * the booking requests still `requested` and the pending reschedules,
 * for the flight deck's card and the Requests screen. Pinned here with
 * one of each, made and removed by the test.
 */
const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
const REQ = randomUUID();
const BOOKED = randomUUID();
const CHANGE = randomUUID();
let mariaToken = '';

describe('pending requests', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    mariaToken = (await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email: 'maria@velnes.mk', password: 'velnes-demo' } })).json().accessToken as string;
    // A booking request from the app, and a booked visit asking to move.
    await admin.query(
      `INSERT INTO appointments (id, tenant_id, location_id, date, start_min, duration_min, kind, status, title, service_id, employee_id, customer_id, price, source)
       VALUES ($1, $2, $3, CURRENT_DATE + 30, 600, 45, 'appointment', 'requested', 'Pending Tester', $4, $5, $6, 1800, 'client'),
              ($7, $2, $3, CURRENT_DATE + 31, 600, 45, 'appointment', 'booked', 'Moving Tester', $4, $5, $6, 1800, 'client')`,
      [REQ, demo.business, demo.locCentar, demo.s1, demo.empMaria, demo.c1, BOOKED],
    );
    await admin.query(`INSERT INTO appointment_products (tenant_id, appointment_id, product_id, name, qty, unit_price) VALUES ($1, $2, $3, 'Resistance band set', 2, 1200)`, [demo.business, REQ, demo.p1]);
    await admin.query(
      `INSERT INTO booking_change_requests (id, tenant_id, appointment_id, original_date, original_start_min, original_duration_min, original_employee_id, requested_date, requested_start_min, requested_employee_id)
       VALUES ($1, $2, $3, CURRENT_DATE + 31, 600, 45, $4, CURRENT_DATE + 32, 660, $4)`,
      [CHANGE, demo.business, BOOKED, demo.empMaria],
    );
  });
  afterAll(async () => {
    await admin.query(`DELETE FROM booking_change_requests WHERE id = $1`, [CHANGE]);
    await admin.query(`DELETE FROM appointments WHERE id IN ($1, $2)`, [REQ, BOOKED]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('lists the booking requests and the pending reschedules, with what the screen needs to act', async () => {
    const res = await app.inject({ method: 'GET', url: `${API_PREFIX}/requests/pending`, headers: { authorization: `Bearer ${mariaToken}` } });
    expect(res.statusCode, res.body).toBe(200);
    const out = PendingRequestsSchema.parse(res.json());
    const b = out.bookings.find((x) => x.id === REQ)!;
    expect(b).toMatchObject({ customerName: 'Pending Tester', serviceName: 'Physiotherapy session', employeeName: 'Maria Petrovska', locationName: 'Centar', time: '10:00', end: '10:45', price: 1800, source: 'client', productUnits: 2 });
    const r = out.reschedules.find((x) => x.id === CHANGE)!;
    expect(r).toMatchObject({ appointmentId: BOOKED, status: 'pending', customerName: 'Moving Tester', originalTime: '10:00', requestedTime: '11:00', requestedEnd: '11:45' });
    // Decided requests leave the list.
    await admin.query(`UPDATE appointments SET status = 'cancelled' WHERE id = $1`, [REQ]);
    await admin.query(`UPDATE booking_change_requests SET status = 'approved' WHERE id = $1`, [CHANGE]);
    const after = PendingRequestsSchema.parse((await app.inject({ method: 'GET', url: `${API_PREFIX}/requests/pending`, headers: { authorization: `Bearer ${mariaToken}` } })).json());
    expect(after.bookings.some((x) => x.id === REQ)).toBe(false);
    expect(after.reschedules.some((x) => x.id === CHANGE)).toBe(false);
  });
});
