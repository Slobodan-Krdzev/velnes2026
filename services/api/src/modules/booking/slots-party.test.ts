import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, withTenant } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';
import { nowAt } from '../scheduling/scheduling.service.js';
import { firstStartOn } from './booking.service.js';

/**
 * "For two" (Alex, 2026-09-30): a start is free for a party only when
 * that many professionals are free for it at once, and the location
 * has a room for each. The seeded world's bookable hands: Maria (both
 * places), Ana (Aerodrom), Elena (Centar) — Nikola and Bojan are front
 * desk and books, not bookable. Rehab training (s4) is Maria's, Ana's
 * and Elena's, so two can be seated at either place; Sports massage
 * (s8) is Elena's alone. Centar has three rooms, Aerodrom two. The
 * clock is injected; the day is a Wednesday, when everybody works.
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

describe('the first start for a party', () => {
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('two at Aerodrom: Maria and Ana, two rooms — the first grid start of the day', async () => {
    await withTenant(demo.business, async (trx) => {
      const one = await firstStartOn(trx, { locationId: demo.locAerodrom, serviceId: demo.s4, date: wednesday, now: skopje(wednesday, '08:00'), party: 1 });
      const two = await firstStartOn(trx, { locationId: demo.locAerodrom, serviceId: demo.s4, date: wednesday, now: skopje(wednesday, '08:00'), party: 2 });
      expect(one).toBe('09:00');
      expect(two).toBe('09:00');
    });
  });

  it('three at Aerodrom: two hands, so no start on any day', async () => {
    await withTenant(demo.business, async (trx) => {
      const three = await firstStartOn(trx, { locationId: demo.locAerodrom, serviceId: demo.s4, date: wednesday, now: skopje(wednesday, '08:00'), party: 3 });
      expect(three).toBeNull();
    });
  });

  it('two at Centar: Maria and Elena — seated; a treatment only Elena does seats one', async () => {
    await withTenant(demo.business, async (trx) => {
      const two = await firstStartOn(trx, { locationId: demo.locCentar, serviceId: demo.s4, date: wednesday, now: skopje(wednesday, '08:00'), party: 2 });
      const massageForOne = await firstStartOn(trx, { locationId: demo.locCentar, serviceId: demo.s8, date: wednesday, now: skopje(wednesday, '08:00'), party: 1 });
      const massageForTwo = await firstStartOn(trx, { locationId: demo.locCentar, serviceId: demo.s8, date: wednesday, now: skopje(wednesday, '08:00'), party: 2 });
      expect(two).toBe('09:00');
      expect(massageForOne).toBe('09:00');
      expect(massageForTwo).toBeNull();
    });
  });

  it('a second seat needs a second room: with one room left, two are not seated', async () => {
    // Aerodrom has two rooms. One appointment at 09:00 with Ana leaves
    // Maria free and one room — one seat, not two. Put back after.
    const ids: string[] = [];
    await withTenant(demo.business, async (trx) => {
      const row = await trx
        .insertInto('appointments')
        .values({
          tenantId: demo.business,
          locationId: demo.locAerodrom,
          date: new Date(wednesday),
          startMin: 540,
          durationMin: 60,
          prepMin: 0,
          resetMin: 0,
          serviceId: demo.s4,
          employeeId: demo.empAna,
          kind: 'appointment',
          status: 'booked',
          title: 'Party test',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      ids.push(row.id);
    });
    try {
      await withTenant(demo.business, async (trx) => {
        const one = await firstStartOn(trx, { locationId: demo.locAerodrom, serviceId: demo.s4, date: wednesday, now: skopje(wednesday, '08:00'), party: 1 });
        const two = await firstStartOn(trx, { locationId: demo.locAerodrom, serviceId: demo.s4, date: wednesday, now: skopje(wednesday, '08:00'), party: 2 });
        expect(one).toBe('09:00');
        // Ana is busy till 10:00 — and so is her room.
        expect(two).toBe('10:00');
      });
    } finally {
      await withTenant(demo.business, (trx) => trx.deleteFrom('appointments').where('id', 'in', ids).execute());
    }
  });

  it('a closed day seats nobody, whatever the party', async () => {
    const sunday = (() => {
      const d = new Date(`${wednesday}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 4);
      return d.toISOString().slice(0, 10);
    })();
    await withTenant(demo.business, async (trx) => {
      expect(await firstStartOn(trx, { locationId: demo.locCentar, serviceId: demo.s8, date: sunday, now: skopje(wednesday, '08:00'), party: 1 })).toBeNull();
    });
  });
});
