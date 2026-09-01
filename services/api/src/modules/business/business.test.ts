import { API_PREFIX, BusinessProfileSchema, BusinessSettingsSchema } from '@velnes/contracts';
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

const get = (url: string, token = ownerToken) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
const patch = (url: string, payload: unknown, token = ownerToken) =>
  app.inject({
    method: 'PATCH',
    url,
    headers: { authorization: `Bearer ${token}` },
    payload: payload as Record<string, unknown>,
  });

describe('the business card, the settings document and the new patch doors', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    for (const [email, set] of [
      ['maria@velnes.mk', (t: string) => (ownerToken = t)],
      ['ana@velnes.mk', (t: string) => (anaToken = t)],
    ] as const) {
      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/auth/login`,
        payload: { email, password: 'velnes-demo' },
      });
      set(res.json().accessToken);
    }
  });
  afterAll(async () => {
    // Put the seeded values back so other suites read the same world.
    await admin.query(
      `UPDATE businesses SET description='Physiotherapy, rehab and recovery in the centre of Skopje.',
       settings = settings - 'x' WHERE id=$1`,
      [demo.business],
    );
    await admin.query(
      `UPDATE businesses SET settings = jsonb_set(settings,'{sales,roundCash}','false') WHERE id=$1`,
      [demo.business],
    );
    await admin.query(
      `UPDATE locations SET cancel_hours=24, hours=jsonb_set(hours,'{6}','null') WHERE id=$1`,
      [demo.locAerodrom],
    );
    const anaHours = {
      0: null, 1: [['09:00', '19:00']], 2: [['09:00', '19:00']], 3: [['09:00', '19:00']],
      4: [['09:00', '19:00']], 5: [['09:00', '15:00']], 6: null,
    };
    await admin.query(`UPDATE employees SET role_title='Rehab coach', hours=$2 WHERE id=$1`, [
      demo.empAna,
      JSON.stringify(anaHours),
    ]);
    await admin.query(`DELETE FROM employee_skills WHERE employee_id=$1`, [demo.empAna]);
    for (const sid of [demo.s1, demo.s4, demo.s5])
      await admin.query(
        `INSERT INTO employee_skills (tenant_id, employee_id, service_id) VALUES ($1,$2,$3)`,
        [demo.business, demo.empAna, sid],
      );
    await admin.query(
      `DELETE FROM audit_log WHERE action IN ('Business renamed','Working hours changed')`,
    );
    await admin.query(`UPDATE businesses SET name='Velnes Fizio Centar' WHERE id=$1`, [demo.business]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('serves the business card with the HQ-managed legal block read-only', async () => {
    const res = await get(`${API_PREFIX}/business`);
    expect(res.statusCode).toBe(200);
    const b = BusinessProfileSchema.parse(res.json());
    expect(b.name).toBe('Velnes Fizio Centar');
    expect(b.address).toBe('Partizanski Odredi 14');
    expect(b.gallery).toHaveLength(4);
    expect(b.legal?.name).toBe('Velnes Studio DOOEL Skopje');
    expect(b.legal?.status).toBe('verified');
  });

  it('edits the card behind locations.manage and audits a rename', async () => {
    const denied = await patch(`${API_PREFIX}/business`, { description: 'x' }, anaToken);
    expect(denied.statusCode).toBe(403);
    const res = await patch(`${API_PREFIX}/business`, {
      name: 'Velnes Fizio Centar',
      description: 'Updated description.',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().description).toBe('Updated description.');
  });

  it('serves the settings document with defaults and merges section patches', async () => {
    const res = await get(`${API_PREFIX}/business-settings`);
    const s = BusinessSettingsSchema.parse(res.json());
    expect(s.ranking.criteria).toEqual(['rank_reviews', 'rank_upsellcount']);
    expect(s.customers.groups.map((g) => g.name)).toEqual(['New', 'Regulars', 'VIP']);
    expect(s.sales.defaultVat).toBe(18);
    expect(s.marketplace.listed).toBe(true);

    // A section patch replaces only its own section.
    const upd = await patch(`${API_PREFIX}/business-settings`, {
      sales: { defaultVat: 18, autoReceipt: true, allowDiscounts: true, roundCash: true },
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().sales.roundCash).toBe(true);
    expect(upd.json().customers.groups).toHaveLength(3); // untouched

    // At least one ranking criterion stays on — the contract refuses.
    const none = await patch(`${API_PREFIX}/business-settings`, { ranking: { criteria: [] } });
    expect(none.statusCode).toBe(400);

    // Sections keep the prototype's permission split.
    const denied = await patch(
      `${API_PREFIX}/business-settings`,
      { ranking: { criteria: ['rank_turnover'] } },
      anaToken,
    );
    expect(denied.statusCode).toBe(403);
  });

  it('edits a location week through the audited hours door', async () => {
    const res = await patch(`${API_PREFIX}/locations/${demo.locAerodrom}`, {
      hours: {
        '0': [['09:00', '19:00']], '1': [['09:00', '19:00']], '2': [['09:00', '19:00']],
        '3': [['09:00', '19:00']], '4': [['09:00', '19:00']], '5': [['09:00', '15:00']],
        '6': [['10:00', '14:00']],
      },
      cancelHours: 48,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().cancelHours).toBe(48);
    // The booking gate reads the same truth: Sunday is now open.
    const nextSunday = (() => {
      const d = new Date();
      d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    const sch = await get(
      `${API_PREFIX}/locations/${demo.locAerodrom}/schedule?date=${nextSunday}`,
    );
    expect(sch.json().open).toBe(true);
    const audit = await admin.query(
      `SELECT 1 FROM audit_log WHERE action='Working hours changed' AND object='Location · Aerodrom'`,
    );
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it('the save door refuses bad weeks, unbookable states and losing the last owner', async () => {
    // An inverted period names its weekday.
    const inverted = await patch(`${API_PREFIX}/employees/${demo.empAna}`, {
      hours: { '0': null, '1': [['18:00', '09:00']], '2': null, '3': null, '4': null, '5': null, '6': null },
    });
    expect(inverted.statusCode).toBe(422);
    expect(inverted.json().message).toBe('Tue: 18:00–09:00 ends before it starts');
    // Overlapping periods name both.
    const overlap = await patch(`${API_PREFIX}/employees/${demo.empAna}`, {
      hours: { '0': null, '1': [['09:00', '13:00'], ['12:00', '17:00']], '2': null, '3': null, '4': null, '5': null, '6': null },
    });
    expect(overlap.statusCode).toBe(422);
    expect(overlap.json().message).toBe('Tue: 09:00–13:00 and 12:00–17:00 overlap');
    // Bookable with no skills is a refused state, not a warning.
    const noSkills = await patch(`${API_PREFIX}/employees/${demo.empAna}`, {
      bookable: true,
      skillServiceIds: [],
    });
    expect(noSkills.statusCode).toBe(422);
    expect(noSkills.json().message).toBe('Pick at least one service, or switch off bookable');
    // The last active owner cannot demote themselves.
    const demote = await patch(`${API_PREFIX}/employees/${demo.empMaria}`, { access: 'staff' });
    expect(demote.statusCode).toBe(409);
    expect(demote.json().message).toBe('Make someone else owner first — a salon needs one');
  });

  it('persists an employee week, job title and skills through the team door', async () => {
    const res = await patch(`${API_PREFIX}/employees/${demo.empAna}`, {
      roleTitle: 'Senior rehab coach',
      hours: { '0': [['10:00', '18:00']], '1': null, '2': [['10:00', '18:00']], '3': null, '4': null, '5': null, '6': null },
      skillServiceIds: [demo.s4],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().roleTitle).toBe('Senior rehab coach');
    expect(res.json().skillServiceIds).toEqual([demo.s4]);
    const hrs = await admin.query(`SELECT hours FROM employees WHERE id=$1`, [demo.empAna]);
    expect(hrs.rows[0].hours['0']).toEqual([['10:00', '18:00']]);
  });
});
