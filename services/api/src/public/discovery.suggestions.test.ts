import { API_PREFIX, DiscoverySuggestionsSchema } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../db/index.js';
import { demo } from '../db/seed-demo.js';
import { resetAdmittedCache } from './discovery.routes.js';
import { buildServer } from '../server.js';

/**
 * Discovery suggestions: search intents, never ahead of their evidence.
 * Against the seeded world — one listed salon, in one town, with its
 * categories — plus a client this test registers and cleans up.
 */
const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
const P = `${API_PREFIX}/public`;
const C = `${API_PREFIX}/client`;
const EMAIL = 'sugg.tester@example.test';
const PASSWORD = 'sugg-pass-1234';
let token = '';

async function suggestions(qs = '', headers: Record<string, string> = {}) {
  resetAdmittedCache();
  const res = await app.inject({ method: 'GET', url: `${P}/discovery/suggestions${qs}`, headers });
  expect(res.statusCode).toBe(200);
  return DiscoverySuggestionsSchema.parse(res.json());
}

describe('discovery suggestions', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    const reg = await app.inject({
      method: 'POST',
      url: `${C}/register`,
      payload: { email: EMAIL, password: PASSWORD, first: 'Sugg', last: 'Tester', phone: '+389 70 000 778', dob: '1991-01-01', lang: 'en' },
    });
    expect(reg.statusCode).toBe(200);
    const code = await admin.query(`SELECT email_code FROM client_users WHERE email = $1`, [EMAIL]);
    await app.inject({ method: 'POST', url: `${C}/verify-email`, payload: { email: EMAIL, code: code.rows[0].email_code } });
    const login = await app.inject({ method: 'POST', url: `${C}/login`, payload: { email: EMAIL, password: PASSWORD } });
    token = login.json().token as string;
  });
  afterAll(async () => {
    await admin.query(`DELETE FROM client_favourites WHERE client_user_id IN (SELECT id FROM client_users WHERE email = $1)`, [EMAIL]);
    await admin.query(`DELETE FROM mail_outbox WHERE to_email = $1`, [EMAIL]);
    await admin.query(`DELETE FROM client_users WHERE email = $1`, [EMAIL]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('a guest with nothing known gets "available now" and what is on offer — no personal or local wording', async () => {
    const out = await suggestions();
    expect(out.how).toBe('default');
    expect(out.suggestions[0]).toMatchObject({ kind: 'now_all', reason: 'now', intent: { now: true, nearby: false, city: null } });
    const kinds = new Set(out.suggestions.map((s) => s.kind));
    expect(kinds.has('salon_again')).toBe(false);
    expect(kinds.has('category_again')).toBe(false);
    expect(kinds.has('category_town')).toBe(false);
    expect(kinds.has('category_near')).toBe(false);
    // Every category intent stands on something: most-booked, or the offer with its count.
    for (const s of out.suggestions.filter((x) => x.intent.category)) {
      expect(['category_popular', 'category_offer']).toContain(s.kind);
      if (s.kind === 'category_offer') expect(s.salons).toBeGreaterThan(0);
      expect(s.intent.nearby).toBe(false);
      expect(s.intent.city).toBeNull();
    }
    // No category twice.
    const ids = out.suggestions.map((s) => s.intent.category?.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    expect(out.suggestions.length).toBeLessThanOrEqual(8);
  });

  it('a town named makes the offer there the context, each intent carrying the town', async () => {
    const town = (await admin.query(`SELECT city FROM businesses WHERE id = $1`, [demo.business])).rows[0].city as string;
    const out = await suggestions(`?city=${encodeURIComponent(town)}`);
    expect(out.how).toBe('context');
    const inTown = out.suggestions.filter((s) => s.kind === 'category_town');
    expect(inTown.length).toBeGreaterThan(0);
    for (const s of inTown) {
      expect(s.reason).toBe('town');
      expect(s.intent.city).toBe(town);
      expect(s.salons).toBeGreaterThan(0);
    }
    const elsewhere = await suggestions(`?city=Nowhere-on-Earth`);
    expect(elsewhere.suggestions.some((s) => s.kind === 'category_town')).toBe(false);
  });

  it('a position makes what is around it the context, each intent asking for nearby', async () => {
    const pin = (await admin.query(`SELECT lat, lng FROM locations WHERE id = $1`, [demo.locAerodrom])).rows[0];
    const out = await suggestions(`?lat=${pin.lat}&lng=${pin.lng}`);
    expect(out.how).toBe('context');
    expect(out.suggestions[0]).toMatchObject({ kind: 'now_all', intent: { now: true, nearby: true, radiusKm: 10 } });
    const near = out.suggestions.filter((s) => s.kind === 'category_near');
    expect(near.length).toBeGreaterThan(0);
    for (const s of near) expect(s.intent).toMatchObject({ nearby: true, radiusKm: 10, city: null });
  });

  it('a signed-in viewer’s favourite salon comes first, as a destination, and says why', async () => {
    const fav = await app.inject({ method: 'PUT', url: `${C}/me/favourites/salon/${demo.business}`, headers: { authorization: `Bearer ${token}` } });
    expect([200, 204]).toContain(fav.statusCode);
    const out = await suggestions('', { authorization: `Bearer ${token}` });
    expect(out.how).toBe('history');
    expect(out.suggestions[0]).toMatchObject({ kind: 'salon_again', reason: 'favourite', intent: { salon: { slug: 'velnes-fizio' } } });
    // A token that cannot be read is a guest, not an error.
    const guest = await suggestions('', { authorization: 'Bearer not-a-real-token' });
    expect(guest.how).toBe('default');
  });
});
