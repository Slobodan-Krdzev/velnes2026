import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, withTenant } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';
import { nowAt } from '../scheduling/scheduling.service.js';
import { firstStartWithin } from './booking.service.js';

/**
 * "Available now": the soonest a treatment can start, if that is within
 * the next half hour — in the salon's clock. The seeded world is open
 * on a Wednesday; the clock is injected.
 */

const app = await buildServer();

const wednesday = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 21 - ((d.getDay() + 4) % 7));
  d.setDate(d.getDate() + 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

/** A Date that reads `hhmm` on `date` in Skopje. */
function skopje(date: string, hhmm: string): Date {
  const guess = new Date(`${date}T${hhmm}:00Z`);
  const local = nowAt('Europe/Skopje', guess);
  const wanted = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  const dayShift = local.date === date ? 0 : local.date < date ? 1 : -1;
  return new Date(guess.getTime() + (wanted - local.min + dayShift * 1440) * 60_000);
}

describe('the soonest start, within the half hour', () => {
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('at 09:50 the next grid start is 10:00 — ten minutes away, offered', async () => {
    await withTenant(demo.business, async (trx) => {
      const at = await firstStartWithin(trx, {
        locationId: demo.locCentar,
        serviceId: demo.s3,
        windowMin: 30,
        now: skopje(wednesday, '09:50'),
      });
      expect(at).toBe('10:00');
    });
  });

  it('at 09:20 both 09:30 and 10:00 are inside the window; the soonest wins', async () => {
    await withTenant(demo.business, async (trx) => {
      const at = await firstStartWithin(trx, {
        locationId: demo.locCentar,
        serviceId: demo.s3,
        windowMin: 30,
        now: skopje(wednesday, '09:20'),
      });
      expect(at).toBe('09:30');
    });
  });

  it('after the last start of the day there is nothing — null, not a time tomorrow', async () => {
    await withTenant(demo.business, async (trx) => {
      const at = await firstStartWithin(trx, {
        locationId: demo.locCentar,
        serviceId: demo.s3,
        windowMin: 30,
        now: skopje(wednesday, '18:45'),
      });
      expect(at).toBeNull();
    });
  });
  // The pace rule ("nobody fits at the offered duration") is asserted in
  // slots-pace.test.ts, next to the door that explains it.
});
