import { randomUUID } from 'node:crypto';
import { API_PREFIX, PublicWidgetSchema } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../db/index.js';
import { demo } from '../db/seed-demo.js';
import { buildServer } from '../server.js';

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
const PK = 'pk_live_velnes_demo';
const P = `${API_PREFIX}/public`;

const futureWednesday = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 21 - ((d.getDay() + 4) % 7));
  d.setDate(d.getDate() + 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

describe('the public widget surface', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
  });
  afterAll(async () => {
    await admin.query(`DELETE FROM appointment_history WHERE appointment_id IN (SELECT id FROM appointments WHERE source='widget')`);
    await admin.query(`DELETE FROM appointments WHERE source='widget'`);
    await admin.query(`DELETE FROM customers WHERE phone='+389 70 999 111'`);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('serves the widget config by publishable key — live locations only', async () => {
    const res = await app.inject({ method: 'GET', url: `${P}/widget?key=${PK}` });
    expect(res.statusCode).toBe(200);
    const w = PublicWidgetSchema.parse(res.json());
    expect(w.businessName).toBe('Velnes Fizio Centar');
    expect(w.locations.map((l) => l.name).sort()).toEqual(['Aerodrom', 'Centar']);
  });

  it('refuses an unknown key, and an unregistered origin (logging the event)', async () => {
    const bad = await app.inject({ method: 'GET', url: `${P}/widget?key=pk_nope` });
    expect(bad.statusCode).toBe(404);
    const foreign = await app.inject({
      method: 'GET',
      url: `${P}/widget?key=${PK}`,
      headers: { origin: 'https://evil.example.com' },
    });
    expect(foreign.statusCode).toBe(403);
    const ev = await admin.query(
      `SELECT code FROM integration_events ORDER BY ts DESC LIMIT 1`,
    );
    expect(ev.rows[0].code).toBe('DOMAIN_NOT_ALLOWED');
    // The registered domain passes and gets the CORS header back.
    const good = await app.inject({
      method: 'GET',
      url: `${P}/widget?key=${PK}`,
      headers: { origin: 'https://velnesstudio.mk' },
    });
    expect(good.statusCode).toBe(200);
    expect(good.headers['access-control-allow-origin']).toBe('https://velnesstudio.mk');
  });

  it('resolves the hosted booking page by slug', async () => {
    const res = await app.inject({ method: 'GET', url: `${P}/booking-page/velnes-fizio` });
    expect(res.statusCode).toBe(200);
    expect(res.json().widgetId).toBeDefined();
    const nope = await app.inject({ method: 'GET', url: `${P}/booking-page/no-such-salon` });
    expect(nope.statusCode).toBe(404);
  });

  it('lists only online-bookable services with variants and modifiers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${P}/services?key=${PK}&locationId=${demo.locCentar}`,
    });
    expect(res.statusCode).toBe(200);
    const names = res.json().services.map((s: { name: string }) => s.name);
    expect(names).toContain('Sports massage');
    const massage = res.json().services.find((s: { name: string }) => s.name === 'Sports massage');
    expect(massage.variants).toHaveLength(3);
    expect(massage.priceFrom).toBe(1900);
  });

  it('logs SERVICE_NOT_FOUND when availability is asked for a ghost service', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${P}/availability?key=${PK}&locationId=${demo.locCentar}&serviceId=${randomUUID()}&date=${futureWednesday}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().slots).toEqual([]);
    const ev = await admin.query(
      `SELECT code FROM integration_events WHERE code='SERVICE_NOT_FOUND' LIMIT 1`,
    );
    expect(ev.rows).toHaveLength(1);
  });

  it('holds and books through the public doors — idempotent, priced at the door', async () => {
    const key = randomUUID();
    const avail = await app.inject({
      method: 'GET',
      url: `${P}/availability?key=${PK}&locationId=${demo.locCentar}&serviceId=${demo.s3}&date=${futureWednesday}&holdKey=${key}`,
    });
    const slot = avail.json().slots.find((s: { free: boolean }) => s.free);
    expect(slot).toBeDefined();

    const hold = await app.inject({
      method: 'POST',
      url: `${P}/holds`,
      payload: {
        widgetKey: PK,
        key,
        locationId: demo.locCentar,
        serviceId: demo.s3,
        date: futureWednesday,
        time: slot.t,
      },
    });
    expect(hold.statusCode).toBe(200);
    expect(new Date(hold.json().until).getTime()).toBeGreaterThan(Date.now());

    const book = await app.inject({
      method: 'POST',
      url: `${P}/book`,
      payload: {
        widgetKey: PK,
        key,
        locationId: demo.locCentar,
        serviceId: demo.s3,
        date: futureWednesday,
        time: slot.t,
        name: 'Web Visitor',
        phone: '+389 70 999 111',
        email: 'web@example.com',
      },
    });
    expect(book.statusCode).toBe(200);
    expect(book.json().price).toBe(1200); // the door priced it, not the client
    const again = await app.inject({
      method: 'POST',
      url: `${P}/book`,
      payload: {
        widgetKey: PK,
        key,
        locationId: demo.locCentar,
        serviceId: demo.s3,
        date: futureWednesday,
        time: slot.t,
        name: 'Web Visitor',
        phone: '+389 70 999 111',
      },
    });
    expect(again.json().ref).toBe(book.json().ref); // same key, same appointment

    const source = await admin.query(`SELECT source FROM appointments WHERE id=$1`, [
      book.json().ref,
    ]);
    expect(source.rows[0].source).toBe('widget');
  });
});
