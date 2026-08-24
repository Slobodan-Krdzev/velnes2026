import { randomUUID } from 'node:crypto';
import { API_PREFIX, AvailabilityResponseSchema, BookResponseSchema } from '@velnes/contracts';
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

// A clean weekday well in the future (a Wednesday), away from seed data.
const future = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 21 - ((new Date().getDay() + 4) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
const futureSunday = (() => {
  const [y, m, dd] = future.split('-').map(Number);
  const d = new Date(y!, m! - 1, dd!);
  d.setDate(d.getDate() + (7 - ((d.getDay() + 6) % 7) - 1)); // that week's Sunday
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

const get = (url: string) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${maria}` } });
const post = (url: string, payload: object) =>
  app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${maria}` }, payload });

describe('scheduling & booking doors', () => {
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
    await admin.query(
      `DELETE FROM appointment_history WHERE appointment_id IN (SELECT id FROM appointments WHERE date >= $1)`,
      [future],
    );
    await admin.query(`DELETE FROM appointments WHERE date >= $1`, [future]);
    await admin.query(`DELETE FROM holds`);
    await admin.query(`DELETE FROM schedule_exceptions`);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('scheduleFor: regular week, then an exception overlays a single date', async () => {
    const reg = await get(`${API_PREFIX}/locations/${demo.locCentar}/schedule?date=${future}`);
    expect(reg.json()).toMatchObject({ open: true, source: 'regular' });
    expect(reg.json().periods).toEqual([['09:00', '19:00']]);
    const sun = await get(
      `${API_PREFIX}/locations/${demo.locCentar}/schedule?date=${futureSunday}`,
    );
    expect(sun.json().open).toBe(false);

    const exc = await post(`${API_PREFIX}/locations/${demo.locCentar}/exceptions`, {
      startDate: future,
      type: 'CUSTOM_HOURS',
      periods: [['10:00', '14:00']],
      reason: 'Renovation morning',
    });
    expect(exc.statusCode).toBe(200);
    const day = await get(`${API_PREFIX}/locations/${demo.locCentar}/schedule?date=${future}`);
    expect(day.json()).toMatchObject({
      open: true,
      source: 'exception',
      periods: [['10:00', '14:00']],
    });
    // One exception per date: an overlapping second one is refused.
    const clash = await post(`${API_PREFIX}/locations/${demo.locCentar}/exceptions`, {
      startDate: future,
      type: 'CLOSED',
    });
    expect(clash.statusCode).toBe(409);
    await admin.query(`DELETE FROM schedule_exceptions`);
  });

  it('holidays: list carries state, apply creates a CLOSED exception idempotently', async () => {
    const list = await get(`${API_PREFIX}/locations/${demo.locCentar}/holidays`);
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.years.map((y: { year: number }) => y.year)).toEqual([2026, 2027]);
    const day = body.holidays.find((h: { id: string }) => h.id === 'mk-2026-12-08');
    expect(day.state).toBe('open');
    const applied = await post(
      `${API_PREFIX}/locations/${demo.locCentar}/holidays/mk-2026-12-08/apply`,
      {},
    );
    expect(applied.statusCode).toBe(200);
    expect(applied.json()).toMatchObject({ type: 'CLOSED', source: 'PUBLIC_HOLIDAY' });
    const again = await post(
      `${API_PREFIX}/locations/${demo.locCentar}/holidays/mk-2026-12-08/apply`,
      {},
    );
    expect(again.json().id).toBe(applied.json().id); // idempotent
    const after = await get(`${API_PREFIX}/locations/${demo.locCentar}/holidays`);
    expect(
      after.json().holidays.find((h: { id: string }) => h.id === 'mk-2026-12-08').state,
    ).toBe('applied');
    await admin.query(`DELETE FROM schedule_exceptions`);
  });

  it('the booking gate refuses with the prototype sentences', async () => {
    const attempt = (over: object) =>
      post(`${API_PREFIX}/appointments`, {
        key: randomUUID(),
        locationId: demo.locCentar,
        serviceId: demo.s1,
        date: future,
        time: '10:00',
        employeeId: demo.empMaria,
        source: 'staff',
        ...over,
      });
    // Sunday: closed.
    let r = await attempt({ date: futureSunday });
    expect(r.statusCode).toBe(409);
    expect(r.json().message).toContain('closed on Sundays');
    // Ana is off on Mondays.
    const monday = (() => {
      const [y, m, d] = future.split('-').map(Number);
      const dt = new Date(y!, m! - 1, d! - 2); // future is a Wednesday
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    })();
    r = await attempt({ date: monday, employeeId: demo.empAna, locationId: demo.locAerodrom });
    expect(r.json().message).toContain('does not work on Mondays');
    // Nikola has not accepted the invite.
    r = await attempt({ employeeId: demo.empNikola });
    expect(r.json().message).toContain('not bookable');
    // Elena does not do s1 (skills: s4-s8).
    r = await attempt({ employeeId: demo.empElena });
    expect(r.json().message).toContain('does not do this service');
    // Blacklisted customer.
    r = await attempt({ customerId: demo.c3 });
    expect(r.json().message).toContain('blacklisted after 3 no-shows');
    // Runs past the day window: refused with the opening hours.
    r = await attempt({ time: '18:30' });
    expect(r.json().message).toContain('is open 09:00–19:00');
  });

  it('availability serves the grid; booking consumes it; idempotent key returns the same appointment', async () => {
    const av = await get(
      `${API_PREFIX}/availability?locationId=${demo.locCentar}&serviceId=${demo.s1}&employeeId=${demo.empMaria}&date=${future}`,
    );
    expect(av.statusCode).toBe(200);
    const slots = AvailabilityResponseSchema.parse(av.json()).slots;
    expect(slots.length).toBeGreaterThan(10);
    const first = slots.find((s) => s.free);
    expect(first?.t).toBe('09:00');

    const key = randomUUID();
    const book = await post(`${API_PREFIX}/appointments`, {
      key,
      locationId: demo.locCentar,
      serviceId: demo.s1,
      date: future,
      time: '10:00',
      employeeId: demo.empMaria,
      customerId: demo.c2,
      source: 'staff',
    });
    expect(book.statusCode).toBe(200);
    const appt = BookResponseSchema.parse(book.json()).appointment;
    // Maria's suggested pace is NOT approved -> catalog would apply,
    // but et1 has 18 observations ≥ 12 so employee-pace applies: 45*1.13→50.
    expect(appt.durationMin).toBe(50);
    expect(appt.basis).toBe('employee-pace');
    expect(appt.price).toBe(1800); // pace never changes the price

    const again = await post(`${API_PREFIX}/appointments`, {
      key,
      locationId: demo.locCentar,
      serviceId: demo.s1,
      date: future,
      time: '10:00',
      employeeId: demo.empMaria,
      source: 'staff',
    });
    expect(again.json().appointment.id).toBe(appt.id); // same key, same appointment

    // The slot is now busy; a clash reads as the prototype sentence.
    const clash = await post(`${API_PREFIX}/appointments`, {
      key: randomUUID(),
      locationId: demo.locCentar,
      serviceId: demo.s1,
      date: future,
      time: '10:00',
      employeeId: demo.empMaria,
      source: 'staff',
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().message).toContain('already booked');

    // Cancelling frees the time.
    const cancel = await app.inject({
      method: 'PATCH',
      url: `${API_PREFIX}/appointments/${appt.id}`,
      headers: { authorization: `Bearer ${maria}` },
      payload: { status: 'cancelled' },
    });
    expect(cancel.statusCode).toBe(200);
    const retry = await post(`${API_PREFIX}/appointments`, {
      key: randomUUID(),
      locationId: demo.locCentar,
      serviceId: demo.s1,
      date: future,
      time: '10:00',
      employeeId: demo.empMaria,
      source: 'staff',
    });
    expect(retry.statusCode).toBe(200);
  });

  it('holds block others but not their own key, and confirming consumes the hold', async () => {
    const key = randomUUID();
    const hold = await post(`${API_PREFIX}/holds`, {
      key,
      locationId: demo.locCentar,
      serviceId: demo.s3,
      date: future,
      time: '13:00',
      employeeId: demo.empMaria,
    });
    expect(hold.statusCode).toBe(200);
    // Someone else is refused with the prototype sentence.
    const other = await post(`${API_PREFIX}/appointments`, {
      key: randomUUID(),
      locationId: demo.locCentar,
      serviceId: demo.s3,
      date: future,
      time: '13:00',
      employeeId: demo.empMaria,
      source: 'staff',
    });
    expect(other.statusCode).toBe(409);
    expect(other.json().message).toContain('paying for that time');
    // The holder confirms fine.
    const mine = await post(`${API_PREFIX}/appointments`, {
      key,
      locationId: demo.locCentar,
      serviceId: demo.s3,
      date: future,
      time: '13:00',
      employeeId: demo.empMaria,
      customerId: demo.c4,
      source: 'widget',
    });
    expect(mine.statusCode).toBe(200);
    const held = await admin.query(`SELECT count(*)::int AS n FROM holds WHERE key=$1`, [key]);
    expect(held.rows[0].n).toBe(0); // consumed
  });

  it('any-employee resolves to whoever is free and fits the offered duration', async () => {
    const r = await post(`${API_PREFIX}/appointments`, {
      key: randomUUID(),
      locationId: demo.locCentar,
      serviceId: demo.s7, // posture screening: Elena's skill
      date: future,
      time: '11:00',
      employeeId: 'any',
      name: 'Walkin Person',
      phone: '+389 70 000 001',
      source: 'staff',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().appointment.employeeId).toBe(demo.empElena);
    expect(r.json().appointment.anyEmp).toBe(true);
    // The unknown phone created a customer.
    const c = await admin.query(`SELECT name FROM customers WHERE phone='+389 70 000 001'`);
    expect(c.rows[0].name).toBe('Walkin Person');
  });
});
