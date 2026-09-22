import { API_PREFIX, ReadinessResponseSchema } from '@velnes/contracts';
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
let mariaToken = '';
let saved: { employee_id: string; service_id: string }[] = [];

/** The readiness gate's staff item follows the booking door's rule:
 *  a bookable, active member with no skill rows does everything. */
describe('readiness — staff who can deliver', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/auth/login`,
      payload: { email: 'maria@velnes.mk', password: 'velnes-demo' },
    });
    mariaToken = (res.json() as { accessToken: string }).accessToken;
  });
  afterAll(async () => {
    for (const r of saved)
      await admin.query(
        `INSERT INTO employee_skills (tenant_id, employee_id, service_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [demo.business, r.employee_id, r.service_id],
      );
    await admin.end();
    await app.close();
    await closeDb();
  });

  const readiness = async (id: string) => {
    const res = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/locations/${id}/readiness`,
      headers: { authorization: `Bearer ${mariaToken}` },
    });
    return ReadinessResponseSchema.parse(res.json());
  };

  it('counts a bookable member with no skill rows — they do everything', async () => {
    expect((await readiness(demo.locAerodrom)).items.find((i) => i.k === 'staff')?.ok).toBe(true);
    // Strip every skill row of the people at Aerodrom, keeping them
    // bookable: the booking page would still sell every service there.
    const rows = await admin.query(
      `SELECT k.employee_id, k.service_id FROM employee_skills k
        WHERE k.tenant_id = $1
          AND k.employee_id IN (SELECT employee_id FROM employee_locations WHERE location_id = $2)`,
      [demo.business, demo.locAerodrom],
    );
    saved = rows.rows;
    await admin.query(
      `DELETE FROM employee_skills WHERE tenant_id = $1
         AND employee_id IN (SELECT employee_id FROM employee_locations WHERE location_id = $2)`,
      [demo.business, demo.locAerodrom],
    );
    const r = await readiness(demo.locAerodrom);
    expect(r.items.find((i) => i.k === 'staff')?.ok).toBe(true);
  });
});
