import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, withTenant } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';
import { chainAvailability } from './booking.service.js';

/**
 * A blank day says why, when the door knows.
 *
 * The case: at Centar the only bookable, active professional who does
 * Physiotherapy session (s1) is Maria, measured at 51 min on a 45-min
 * catalog line. "Any professional" offers the catalog's 45 and skips
 * anyone slower — so nobody, and the door must say so rather than
 * look like a full day.
 *
 * The suite shares one seeded database and files run in an order
 * that differs between a fresh CI database and a developer's; this
 * test therefore pins its own precondition rather than trusting what
 * earlier files left behind: timing on, Maria's seeded pace row in
 * place, and — for its duration — nobody else at Centar bookable.
 * Everything is put back afterwards.
 */

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });

const wednesday = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 21 - ((d.getDay() + 4) % 7));
  d.setDate(d.getDate() + 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

/** Who else at Centar was bookable when we arrived — restored after. */
let othersBookable: string[] = [];
let timingWas = true;

describe('a blank day, explained', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    timingWas = (
      await admin.query(`SELECT timing_enabled FROM businesses WHERE id=$1`, [demo.business])
    ).rows[0].timing_enabled;
    await admin.query(`UPDATE businesses SET timing_enabled=true WHERE id=$1`, [demo.business]);
    // Maria's pace on s1, exactly as the seed has it — whatever a
    // timing test may have approved or dismissed since.
    await admin.query(
      `UPDATE emp_timings SET observed_n=18, observed_median_min=51, pace_factor=1.13,
         approved_min=NULL, status='suggested'
       WHERE employee_id=$1 AND service_id=$2 AND variant_id IS NULL AND location_id IS NULL`,
      [demo.empMaria, demo.s1],
    );
    othersBookable = (
      await admin.query(
        `SELECT e.id FROM employees e
           JOIN employee_locations el ON el.employee_id=e.id AND el.location_id=$1
          WHERE e.tenant_id=$2 AND e.id<>$3 AND e.bookable=true`,
        [demo.locCentar, demo.business, demo.empMaria],
      )
    ).rows.map((r: { id: string }) => r.id);
    if (othersBookable.length)
      await admin.query(`UPDATE employees SET bookable=false WHERE id = ANY($1::uuid[])`, [othersBookable]);
  });
  afterAll(async () => {
    if (othersBookable.length)
      await admin.query(`UPDATE employees SET bookable=true WHERE id = ANY($1::uuid[])`, [othersBookable]);
    await admin.query(`UPDATE businesses SET timing_enabled=$2 WHERE id=$1`, [demo.business, timingWas]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('"any professional" on a line everyone runs slow on: no free slot, and the reason', async () => {
    await withTenant(demo.business, async (trx) => {
      const r = await chainAvailability(trx, {
        locationId: demo.locCentar,
        items: [{ serviceId: demo.s1 }],
        employeeId: 'any',
        date: wednesday,
      });
      expect(r.slots.length).toBeGreaterThan(0);
      // Named, so a failure says who was free rather than just "true".
      expect(r.slots.filter((s) => s.free).map((s) => `${s.t} ${s.emp}`)).toEqual([]);
      expect(r.reason).toBe('NOBODY_AT_PACE');
    });
  });

  it('the same line with Maria by name: her own times, at her own pace, no reason needed', async () => {
    await withTenant(demo.business, async (trx) => {
      const r = await chainAvailability(trx, {
        locationId: demo.locCentar,
        items: [{ serviceId: demo.s1 }],
        employeeId: demo.empMaria,
        date: wednesday,
      });
      expect(r.slots.some((s) => s.free)).toBe(true);
      expect(r.reason).toBeUndefined();
    });
  });

  it('a line somebody fits: free slots, no reason', async () => {
    await withTenant(demo.business, async (trx) => {
      const r = await chainAvailability(trx, {
        locationId: demo.locCentar,
        items: [{ serviceId: demo.s3 }],
        employeeId: 'any',
        date: wednesday,
      });
      expect(r.slots.some((s) => s.free)).toBe(true);
      expect(r.reason).toBeUndefined();
    });
  });
});
