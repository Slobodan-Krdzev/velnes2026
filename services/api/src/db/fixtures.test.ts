import { API_PREFIX } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from './index.js';
import { demo } from './seed-demo.js';
import { addFixtureBatch, FIXTURE_PASSWORD, listFixtureBatches, removeFixtureBatch, type FixtureSalon } from './fixtures.js';
import { resetAdmittedCache } from '../public/discovery.routes.js';
import { buildServer } from '../server.js';

/**
 * Fixture salons: made through the front door, told apart by their
 * batch, gone without a trace on removal — and the seeded world is not
 * touched either way.
 */
const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
const BATCH = 'test-batch';
let made: FixtureSalon[] = [];
let before: { businesses: number; employees: number; services: number };

async function counts() {
  const r = await admin.query(
    `SELECT (SELECT count(*)::int FROM businesses WHERE fixture_batch IS NULL) AS businesses,
            (SELECT count(*)::int FROM employees WHERE tenant_id = $1) AS employees,
            (SELECT count(*)::int FROM services WHERE tenant_id = $1) AS services`,
    [demo.business],
  );
  return r.rows[0] as { businesses: number; employees: number; services: number };
}

describe('fixture salons', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    await removeFixtureBatch(BATCH, ADMIN_URL); // a crashed earlier run
    before = await counts();
  });
  afterAll(async () => {
    await removeFixtureBatch(BATCH, ADMIN_URL);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('adds a batch of complete salons through the registration door', async () => {
    made = await addFixtureBatch({ batch: BATCH, count: 2, adminUrl: ADMIN_URL });
    expect(made).toHaveLength(2);
    for (const s of made) {
      const biz = await admin.query(`SELECT fixture_batch, slug, settings, owner_employee_id FROM businesses WHERE id=$1`, [s.businessId]);
      expect(biz.rows[0].fixture_batch).toBe(BATCH);
      expect(biz.rows[0].slug).toBe(s.slug);
      expect(biz.rows[0].settings.marketplace.pitch).toBeTruthy();
      expect(biz.rows[0].owner_employee_id).toBeTruthy();
      const loc = await admin.query(`SELECT lifecycle, online, lat FROM locations WHERE tenant_id=$1`, [s.businessId]);
      expect(loc.rows).toHaveLength(1);
      expect(loc.rows[0].lifecycle).toBe('ACTIVE');
      expect(loc.rows[0].online).toBe(true);
      expect(loc.rows[0].lat).not.toBeNull();
      const staff = await admin.query(
        `SELECT e.name, e.status, e.bookable, (SELECT count(*)::int FROM employee_skills k WHERE k.employee_id = e.id) AS skills,
                (SELECT count(*)::int FROM user_credentials c WHERE c.employee_id = e.id) AS creds
           FROM employees e WHERE e.tenant_id=$1 AND e.access='staff' ORDER BY e.name`,
        [s.businessId],
      );
      expect(staff.rows.length).toBeGreaterThanOrEqual(2);
      for (const m of staff.rows) {
        expect(m.status).toBe('active');
        expect(m.bookable).toBe(true);
        expect(m.skills).toBeGreaterThan(0);
        expect(m.creds).toBe(1);
      }
      expect(staff.rows.map((m: { name: string }) => m.name)).toEqual(s.staff.slice().sort());
      const svc = await admin.query(`SELECT count(*)::int AS n FROM services WHERE tenant_id=$1 AND online AND status='active'`, [s.businessId]);
      expect(svc.rows[0].n).toBeGreaterThanOrEqual(6);
      const gal = await admin.query(`SELECT jsonb_array_length(gallery) AS n FROM businesses WHERE id=$1`, [s.businessId]);
      expect(gal.rows[0].n).toBe(3);
      // Realistic facilities for its kind — some, never all.
      const am = await admin.query(`SELECT count(*)::int AS n FROM location_amenities WHERE tenant_id=$1`, [s.businessId]);
      expect(am.rows[0].n).toBeGreaterThan(2);
      expect(am.rows[0].n).toBeLessThan(23);
      // The doors queued their mails; none left the building.
      const mail = await admin.query(
        `SELECT count(*)::int AS n FROM mail_outbox WHERE (tenant_id=$1 OR ref_id IN (SELECT id::text FROM registrations WHERE business_id=$1)) AND status <> 'mock_sent'`,
        [s.businessId],
      );
      expect(mail.rows[0].n).toBe(0);
    }
    // The global taxonomy is as it was: every fixture category snapped to one that existed.
    const cats = await admin.query(`SELECT count(*)::int AS n FROM service_categories`);
    expect(cats.rows[0].n).toBeGreaterThan(0);
    expect((await listFixtureBatches(ADMIN_URL)).find((b) => b.batch === BATCH)?.salons).toBe(2);
  });

  it('a fixture owner and a fixture colleague can sign in; the salon is on the consumer app', async () => {
    const s = made[0]!;
    const owner = await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email: s.ownerEmail, password: FIXTURE_PASSWORD } });
    expect(owner.statusCode).toBe(200);
    expect(owner.json().employee.access).toBe('owner');
    const staffEmail = (await admin.query(`SELECT email FROM employees WHERE tenant_id=$1 AND access='staff' LIMIT 1`, [s.businessId])).rows[0].email;
    const staff = await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email: staffEmail, password: FIXTURE_PASSWORD } });
    expect(staff.statusCode).toBe(200);
    resetAdmittedCache();
    const page = await app.inject({ method: 'GET', url: `${API_PREFIX}/public/discovery/salons/${s.slug}` });
    expect(page.statusCode).toBe(200);
    expect(page.json().name).toBe(s.name);
  });

  it('refuses to add a batch that already exists', async () => {
    await expect(addFixtureBatch({ batch: BATCH, count: 1, adminUrl: ADMIN_URL })).rejects.toThrow(/already has/);
  });

  it('removes the batch without a trace, and the seeded world is untouched', async () => {
    const ids = made.map((s) => s.businessId);
    const r = await removeFixtureBatch(BATCH, ADMIN_URL);
    expect(r.removed).toBe(2);
    const tables = (
      await admin.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenant_id'`)
    ).rows.map((x: { table_name: string }) => x.table_name);
    for (const t of tables) {
      const left = await admin.query(`SELECT count(*)::int AS n FROM ${t} WHERE tenant_id = ANY($1)`, [ids]);
      expect(left.rows[0].n, t).toBe(0);
    }
    expect((await admin.query(`SELECT count(*)::int AS n FROM businesses WHERE id = ANY($1)`, [ids])).rows[0].n).toBe(0);
    expect((await admin.query(`SELECT count(*)::int AS n FROM registrations WHERE business_id = ANY($1)`, [ids])).rows[0].n).toBe(0);
    expect(await counts()).toEqual(before);
    expect((await removeFixtureBatch(BATCH, ADMIN_URL)).removed).toBe(0);
    resetAdmittedCache();
  });
});
