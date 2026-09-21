import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, withTenant } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';
import { chainAvailability } from './booking.service.js';

/**
 * A blank day says why, when the door knows.
 *
 * The seeded world has exactly this case: at Centar the only bookable,
 * active professional who does Physiotherapy session (s1) is Maria,
 * measured at 51 min on a 45-min catalog line. "Any professional"
 * offers the catalog's 45 and skips anyone slower — so nobody, and
 * the door must say so rather than look like a full day.
 */

const app = await buildServer();

const wednesday = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 21 - ((d.getDay() + 4) % 7));
  d.setDate(d.getDate() + 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

describe('a blank day, explained', () => {
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
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
      expect(r.slots.some((s) => s.free)).toBe(false);
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
