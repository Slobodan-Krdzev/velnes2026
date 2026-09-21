import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, withTenant } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';
import { nowAt } from '../scheduling/scheduling.service.js';
import { availableChainSlots, availableSlots } from './booking.service.js';

/**
 * Nothing in the past is offered — in the salon's clock, not the
 * server's. The seeded world (Velnes Fizio Centar, Centar) is open on
 * a Wednesday; the clock is injected so the assertions do not depend
 * on when the suite runs.
 */

const app = await buildServer();

// A Wednesday three-plus weeks out: open, and clear of seed data.
const wednesday = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 21 - ((d.getDay() + 4) % 7));
  d.setDate(d.getDate() + 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

/** A Date that reads `hhmm` on `date` in the salon's own zone. */
function clockAt(date: string, hhmm: string, tz = 'Europe/Skopje'): Date {
  // Start from the UTC reading and shift by that zone's offset there.
  const guess = new Date(`${date}T${hhmm}:00Z`);
  const local = nowAt(tz, guess);
  const wanted = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  const dayShift = local.date === date ? 0 : local.date < date ? 1 : -1;
  return new Date(guess.getTime() + (wanted - local.min + dayShift * 1440) * 60_000);
}

describe('slots and the clock', () => {
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('nowAt reads a location clock, and shrugs at a bad zone', () => {
    const t = new Date('2026-06-01T10:30:00Z');
    expect(nowAt('Europe/Skopje', t)).toEqual({ date: '2026-06-01', min: 12 * 60 + 30 });
    expect(nowAt('Asia/Tokyo', t)).toEqual({ date: '2026-06-01', min: 19 * 60 + 30 });
    expect(nowAt('Not/AZone', t)).toEqual(nowAt('Europe/Skopje', t));
  });

  it('a future day is untouched; today loses what has passed; a day gone has nothing', async () => {
    await withTenant(demo.business, async (trx) => {
      const base = { locationId: demo.locCentar, serviceId: demo.s3, employeeId: 'any' as const };

      // Seen from the day before: every slot the schedule allows.
      const dayBefore = clockAt(wednesday, '12:00', 'Europe/Skopje');
      dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
      const whole = await availableSlots(trx, { ...base, date: wednesday, now: dayBefore });
      expect(whole.length).toBeGreaterThan(0);
      expect(whole[0]!.t).toBe('08:00');

      // At 12:10 on the day: 12:00 and earlier are gone, 12:30 is the first.
      const midday = await availableSlots(trx, {
        ...base,
        date: wednesday,
        now: clockAt(wednesday, '12:10', 'Europe/Skopje'),
      });
      expect(midday.length).toBeGreaterThan(0);
      expect(midday[0]!.t).toBe('12:30');
      expect(midday.map((s) => s.t)).toEqual(whole.map((s) => s.t).filter((t) => t >= '12:30'));

      // The next day: nothing at all — not "busy", absent.
      const dayAfter = clockAt(wednesday, '09:00', 'Europe/Skopje');
      dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
      expect(await availableSlots(trx, { ...base, date: wednesday, now: dayAfter })).toEqual([]);
    });
  });

  it('the whole-visit door cuts the same way', async () => {
    await withTenant(demo.business, async (trx) => {
      const q = {
        locationId: demo.locCentar,
        items: [{ serviceId: demo.s3 }, { serviceId: demo.s1 }],
        employeeId: 'any' as const,
        date: wednesday,
      };
      const whole = await availableChainSlots(trx, {
        ...q,
        now: clockAt(wednesday, '07:00', 'Europe/Skopje'),
      });
      expect(whole.length).toBeGreaterThan(0);
      const later = await availableChainSlots(trx, {
        ...q,
        now: clockAt(wednesday, '13:45', 'Europe/Skopje'),
      });
      expect(later.every((s) => s.t >= '14:00')).toBe(true);
      expect(later.map((s) => s.t)).toEqual(whole.map((s) => s.t).filter((t) => t >= '14:00'));
    });
  });

  it('is the salon’s clock, not the server’s', async () => {
    // 22:30 UTC on the Wednesday is already Thursday 00:30 in Skopje:
    // the Wednesday is over there, whatever the VPS thinks.
    await withTenant(demo.business, async (trx) => {
      const lateUtc = new Date(`${wednesday}T22:30:00Z`);
      expect(
        await availableSlots(trx, {
          locationId: demo.locCentar,
          serviceId: demo.s3,
          employeeId: 'any',
          date: wednesday,
          now: lateUtc,
        }),
      ).toEqual([]);
    });
  });
});
