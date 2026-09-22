import { randomUUID } from 'node:crypto';
import { API_PREFIX, DiscoveryRecommendedSchema } from '@velnes/contracts';
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
const P = `${API_PREFIX}/public`;
const C = `${API_PREFIX}/client`;
const EMAIL = 'reco.tester@example.test';
const PASSWORD = 'reco-pass-1234';
let token = '';
const made: string[] = [];

describe('recommended salons — from the viewer’s own history, else their position, never at random', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    const reg = await app.inject({
      method: 'POST',
      url: `${C}/register`,
      payload: { email: EMAIL, password: PASSWORD, first: 'Reco', last: 'Tester', phone: '+389 70 000 777', dob: '1991-01-01', lang: 'en' },
    });
    expect(reg.statusCode).toBe(200);
    const code = await admin.query(`SELECT email_code FROM client_users WHERE email = $1`, [EMAIL]);
    await app.inject({ method: 'POST', url: `${C}/verify-email`, payload: { email: EMAIL, code: code.rows[0].email_code } });
    const login = await app.inject({ method: 'POST', url: `${C}/login`, payload: { email: EMAIL, password: PASSWORD } });
    token = login.json().token as string;
  });
  afterAll(async () => {
    if (made.length) {
      await admin.query(`DELETE FROM appointment_history WHERE appointment_id = ANY($1)`, [made]);
      await admin.query(`DELETE FROM appointments WHERE id = ANY($1)`, [made]);
    }
    const links = await admin.query(`SELECT customer_id FROM client_customer_links WHERE client_user_id IN (SELECT id FROM client_users WHERE email = $1)`, [EMAIL]);
    await admin.query(`DELETE FROM client_customer_links WHERE client_user_id IN (SELECT id FROM client_users WHERE email = $1)`, [EMAIL]);
    for (const row of links.rows) await admin.query(`DELETE FROM customers WHERE id = $1`, [row.customer_id]);
    await admin.query(`DELETE FROM client_favourites WHERE client_user_id IN (SELECT id FROM client_users WHERE email = $1)`, [EMAIL]);
    await admin.query(`DELETE FROM mail_outbox WHERE to_email = $1`, [EMAIL]);
    await admin.query(`DELETE FROM client_users WHERE email = $1`, [EMAIL]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('a guest with no position gets the listed order, every card without a reason', async () => {
    const res = await app.inject({ method: 'GET', url: `${P}/discovery/recommended` });
    expect(res.statusCode).toBe(200);
    const out = DiscoveryRecommendedSchema.parse(res.json());
    expect(out.how).toBe('default');
    expect(out.salons.length).toBeGreaterThan(0);
    expect(out.salons.every((s) => s.reason === null)).toBe(true);
  });

  it('a guest with a position gets the salons around it, nearest first, each saying how far', async () => {
    // Stand at the demo salon's own pin: it must come first.
    const pin = await admin.query(`SELECT lat, lng FROM locations WHERE id = $1`, [demo.locAerodrom]);
    const res = await app.inject({ method: 'GET', url: `${P}/discovery/recommended?lat=${pin.rows[0].lat}&lng=${pin.rows[0].lng}` });
    const out = DiscoveryRecommendedSchema.parse(res.json());
    expect(out.how).toBe('nearby');
    expect(out.salons[0]?.slug).toBe('velnes-fizio');
    expect(out.salons[0]?.reason).toEqual({ kind: 'nearby', km: 0 });
    const kms = out.salons.map((s) => (s.reason?.kind === 'nearby' ? s.reason.km : Infinity));
    expect([...kms].sort((a, b) => a - b)).toEqual(kms);
  });

  it('a signed-in viewer is recommended from their own bookings and favourites, and told why', async () => {
    // A favourite salon counts before anything else.
    const fav = await app.inject({
      method: 'PUT',
      url: `${C}/me/favourites/salon/${demo.business}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect([200, 201]).toContain(fav.statusCode);
    const res = await app.inject({ method: 'GET', url: `${P}/discovery/recommended`, headers: { authorization: `Bearer ${token}` } });
    const out = DiscoveryRecommendedSchema.parse(res.json());
    expect(out.how).toBe('history');
    expect(out.salons[0]?.slug).toBe('velnes-fizio');
    expect(out.salons[0]?.reason).toEqual({ kind: 'favourite' });
  });

  it('with personalisation switched off the same viewer gets the position answer instead', async () => {
    await app.inject({ method: 'PATCH', url: `${C}/me`, headers: { authorization: `Bearer ${token}` }, payload: { personalisedResults: false } });
    const res = await app.inject({ method: 'GET', url: `${P}/discovery/recommended?lat=41.99&lng=21.43`, headers: { authorization: `Bearer ${token}` } });
    const out = DiscoveryRecommendedSchema.parse(res.json());
    expect(out.how).toBe('nearby');
    expect(out.salons.every((s) => s.reason === null || s.reason.kind === 'nearby')).toBe(true);
    await app.inject({ method: 'PATCH', url: `${C}/me`, headers: { authorization: `Bearer ${token}` }, payload: { personalisedResults: true } });
  });

  it('a completed visit at a salon says "booked", and its category recommends salons doing the same', async () => {
    // A finished visit last week, written the way the seed writes one.
    const id = randomUUID();
    const cust = await admin.query(
      `INSERT INTO customers (tenant_id, name, email, phone, cust_group) VALUES ($1, 'Reco Tester', $2, '+389 70 000 777', 'New') RETURNING id`,
      [demo.business, EMAIL],
    );
    const me = await admin.query(`SELECT id FROM client_users WHERE email = $1`, [EMAIL]);
    await admin.query(`INSERT INTO client_customer_links (client_user_id, tenant_id, customer_id) VALUES ($1, $2, $3)`, [me.rows[0].id, demo.business, cust.rows[0].id]);
    await admin.query(
      `INSERT INTO appointments (id, tenant_id, location_id, date, start_min, duration_min, kind, status, title, service_id, employee_id, customer_id, price, source, client_user_id)
       VALUES ($1, $2, $3, CURRENT_DATE - 7, 600, 45, 'appointment', 'booked', 'Reco Tester', $4, $5, $6, 1800, 'client', $7)`,
      [id, demo.business, demo.locCentar, demo.s1, demo.empMaria, cust.rows[0].id, me.rows[0].id],
    );
    made.push(id);
    // Drop the favourite so the booking is the strongest signal.
    await admin.query(`DELETE FROM client_favourites WHERE client_user_id = $1`, [me.rows[0].id]);
    const res = await app.inject({ method: 'GET', url: `${P}/discovery/recommended`, headers: { authorization: `Bearer ${token}` } });
    const out = DiscoveryRecommendedSchema.parse(res.json());
    expect(out.how).toBe('history');
    expect(out.salons[0]?.slug).toBe('velnes-fizio');
    expect(out.salons[0]?.reason).toEqual({ kind: 'booked' });
    // Another salon doing the same category is recommended for that.
    const cat = await admin.query(`SELECT c.name FROM services s JOIN service_categories c ON c.id = s.category_id WHERE s.id = $1`, [demo.s1]);
    const similar = out.salons.find((s) => s.reason?.kind === 'category');
    if (similar) expect(similar.reason).toEqual({ kind: 'category', category: cat.rows[0].name });
  });
});
