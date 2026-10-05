import { randomUUID } from 'node:crypto';
import { API_PREFIX, LOYALTY_RULES, QUIET_SLOT_RULE } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, withTenant } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';
import { availableSlots, confirmChain } from '../booking/booking.service.js';
import { requestReschedule } from '../booking/changes.service.js';
import { hhmm, wdIdx } from '../scheduling/scheduling.service.js';
import { runLoyaltySweep, settleVisit } from './loyalty.service.js';
import { quietSlotsBetween, quietTimesFor, recomputeAllQuietSlots } from './quiet-slots.service.js';

/**
 * Quiet slots (Alex, 2026-10-05) — docs/LOYALTY.md "Quiet slots".
 * Against the seeded world: Velnes Fizio Centar has ten weeks of
 * history, so it qualifies; the judgement, the bonus on the free start,
 * the stamp at booking (Velnes-app bookings only, the first leg), its
 * loss on any move, its payment at settlement as its own ledger row,
 * and its reversal when the visit is undone.
 */
const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
const C = `${API_PREFIX}/client`;
const EMAIL = `quiet.${Date.now()}@example.test`;
const made: string[] = [];
let clientId = '';
let mariaToken = '';
let quiet: { weekday: number; startMin: number }[] = [];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The first date at least `minAhead` days ahead that falls on `weekday` (0 = Monday). */
const nextDateOn = (weekday: number, minAhead: number) => {
  const d = new Date();
  d.setDate(d.getDate() + minAhead);
  while (wdIdx(iso(d)) !== weekday) d.setDate(d.getDate() + 1);
  return iso(d);
};
const bonusOf = async (id: string) => Number((await admin.query(`SELECT quiet_bonus FROM appointments WHERE id = $1`, [id])).rows[0].quiet_bonus);

/** A quiet start at Centar that is actually free on a future date, as
 *  the availability door sees it — with the slot the door answered. */
async function freeQuietStart(skip: string[] = [], minAhead = 8) {
  for (const q of quiet) {
    const date = nextDateOn(q.weekday, minAhead);
    const time = hhmm(q.startMin);
    if (skip.includes(`${date} ${time}`)) continue;
    const slots = await withTenant(demo.business, (trx) =>
      availableSlots(trx, { locationId: demo.locCentar, serviceId: demo.s3, employeeId: 'any', date }),
    );
    const slot = slots.find((s) => s.t === time);
    if (slot?.free) return { date, time, slot, slots };
  }
  throw new Error('No free quiet start found');
}

async function bookAt(date: string, time: string, source: string) {
  const [a] = await withTenant(demo.business, (trx) =>
    confirmChain(trx, null, {
      key: randomUUID(),
      locationId: demo.locCentar,
      date,
      time,
      employeeId: 'any',
      source,
      name: 'Quiet Tester',
      phone: '+389 70 000 777',
      deposit: 0,
      items: [{ serviceId: demo.s3 }],
    }),
  );
  made.push(a!.id);
  return a!;
}

describe('quiet slots', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    await admin.query(`UPDATE platform_features SET since = now() - interval '10 days' WHERE key = 'loyalty'`);
    await recomputeAllQuietSlots();
    quiet = (
      await admin.query(`SELECT weekday, start_min AS "startMin" FROM location_quiet_slots WHERE location_id = $1 ORDER BY weekday, start_min`, [demo.locCentar])
    ).rows as { weekday: number; startMin: number }[];
    mariaToken = (await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email: 'maria@velnes.mk', password: 'velnes-demo' } })).json()
      .accessToken as string;
  });
  afterAll(async () => {
    if (made.length) {
      await admin.query(`DELETE FROM client_loyalty_ledger WHERE source_id = ANY($1::text[]) OR source_id = ANY($2::text[])`, [made, made.map((m) => `${m}:quiet`)]);
      await admin.query(`DELETE FROM booking_change_requests WHERE appointment_id = ANY($1::uuid[])`, [made]);
      await admin.query(`DELETE FROM appointment_history WHERE appointment_id = ANY($1::uuid[])`, [made]);
      await admin.query(`DELETE FROM appointments WHERE id = ANY($1::uuid[])`, [made]);
    }
    if (clientId) await admin.query(`DELETE FROM client_users WHERE id = $1`, [clientId]);
    await admin.query(`UPDATE platform_features SET since = now() WHERE key = 'loyalty'`);
    await app.close();
    await closeDb();
    await admin.end();
  });

  describe('the judgement', () => {
    it('a location with history qualifies; its quiet pairs are the emptiest, under the cap, each under the fill bar', async () => {
      const run = (await admin.query(`SELECT * FROM location_quiet_runs WHERE location_id = $1`, [demo.locCentar])).rows[0] as {
        completed: number; qualified: boolean; open_pairs: number; location_fill: string; quiet_count: number;
      };
      expect(run.completed).toBeGreaterThanOrEqual(QUIET_SLOT_RULE.minCompleted);
      expect(run.qualified).toBe(true);
      expect(run.quiet_count).toBe(quiet.length);
      expect(quiet.length).toBeGreaterThan(0);
      expect(quiet.length).toBeLessThanOrEqual(Math.floor(run.open_pairs * QUIET_SLOT_RULE.maxShare));
      const rows = (await admin.query(`SELECT open_weeks, booked_weeks, fill FROM location_quiet_slots WHERE location_id = $1`, [demo.locCentar])).rows as {
        open_weeks: number; booked_weeks: number; fill: string;
      }[];
      for (const r of rows) {
        expect(r.open_weeks).toBeGreaterThanOrEqual(QUIET_SLOT_RULE.minOpenWeeks);
        expect(Number(r.fill)).toBeLessThan(QUIET_SLOT_RULE.maxFill);
        expect(Number(r.fill) * 2).toBeLessThanOrEqual(Number(run.location_fill) + 1e-9);
      }
      // Sunday is closed: never a pair there.
      expect(quiet.some((q) => q.weekday === 6)).toBe(false);
    });

    it('a young location is judged too and gets nothing — no pairs, not qualified', async () => {
      const young = (await admin.query(
        `SELECT r.location_id AS id, r.qualified, (SELECT count(*)::int FROM location_quiet_slots s WHERE s.location_id = r.location_id) AS n
         FROM location_quiet_runs r WHERE r.completed < $1 LIMIT 1`,
        [QUIET_SLOT_RULE.minCompleted],
      )).rows[0] as { id: string; qualified: boolean; n: number } | undefined;
      expect(young).toBeDefined();
      expect(young!.qualified).toBe(false);
      expect(young!.n).toBe(0);
    });

    it('the calendar door lists the quiet starts of a range, dated, in the location\'s week', async () => {
      const from = nextDateOn(0, 8);
      const slots = await withTenant(demo.business, (trx) => quietSlotsBetween(trx, demo.locCentar, from, from));
      const monday = quiet.filter((q) => q.weekday === 0).map((q) => hhmm(q.startMin));
      expect(slots.map((s) => s.t)).toEqual(monday);
      expect(slots.every((s) => s.date === from)).toBe(true);
    });
  });

  describe('the bonus on a free start', () => {
    it('the availability door marks a free quiet start with the bonus and leaves the others bare', async () => {
      const { slot, slots, date } = await freeQuietStart();
      expect(slot.bonus).toBe(LOYALTY_RULES.appointment.quietSlot);
      const quietToday = await withTenant(demo.business, (trx) => quietTimesFor(trx, demo.locCentar, date));
      for (const s of slots) {
        if (s.free && quietToday.has(Number(s.t.slice(0, 2)) * 60 + Number(s.t.slice(3)))) expect(s.bonus).toBe(LOYALTY_RULES.appointment.quietSlot);
        else expect(s.bonus).toBeUndefined();
      }
    });
  });

  describe('the promise on the visit', () => {
    let stamped = '';
    let stampedWhen = '';
    it('a Velnes-app booking of a quiet start is stamped; a staff booking of one is not', async () => {
      const a = await freeQuietStart();
      const booked = await bookAt(a.date, a.time, 'marketplace');
      stamped = booked.id;
      stampedWhen = `${a.date} ${a.time}`;
      expect(await bonusOf(booked.id)).toBe(LOYALTY_RULES.appointment.quietSlot);
      const b = await freeQuietStart([stampedWhen]);
      const staff = await bookAt(b.date, b.time, 'staff');
      expect(await bonusOf(staff.id)).toBe(0);
    });

    it('moving the visit to another time clears the promise — the salon\'s own move too', async () => {
      const a = await freeQuietStart([stampedWhen]);
      const booked = await bookAt(a.date, a.time, 'marketplace');
      expect(await bonusOf(booked.id)).toBe(LOYALTY_RULES.appointment.quietSlot);
      await admin.query(`UPDATE appointments SET status = 'booked' WHERE id = $1`, [booked.id]);
      const other = a.slots.find((s) => s.free && s.t !== a.time)!;
      const res = await app.inject({
        method: 'PATCH',
        url: `${API_PREFIX}/appointments/${booked.id}`,
        headers: { authorization: `Bearer ${mariaToken}` },
        payload: { time: other.t },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(await bonusOf(booked.id)).toBe(0);
    });

    it('an approved reschedule clears it as well, wherever the visit lands', async () => {
      // A consumer account, so the request can be theirs.
      await app.inject({ method: 'POST', url: `${C}/register`, payload: { email: EMAIL, password: 'velnes-test-12345', first: 'Quiet', last: 'Tester', phone: '+389 70 777 030', dob: null, lang: 'en' } });
      const code = (await admin.query(`SELECT body FROM mail_outbox WHERE to_email=$1 AND kind='client_email_verify' ORDER BY sent_at DESC LIMIT 1`, [EMAIL.toLowerCase()])).rows[0].body.match(/\b(\d{6})\b/)![1];
      const v = await app.inject({ method: 'POST', url: `${C}/verify-email`, payload: { email: EMAIL, code } });
      clientId = v.json().profile.id as string;

      const a = await freeQuietStart([stampedWhen], 15);
      const booked = await bookAt(a.date, a.time, 'marketplace');
      await admin.query(`UPDATE appointments SET status = 'booked', client_user_id = $2 WHERE id = $1`, [booked.id, clientId]);
      expect(await bonusOf(booked.id)).toBe(LOYALTY_RULES.appointment.quietSlot);
      const other = a.slots.find((s) => s.free && s.t !== a.time)!;
      const req = await withTenant(demo.business, (trx) =>
        requestReschedule(trx, { appointmentId: booked.id, client: { id: clientId, name: 'Quiet Tester' }, date: a.date, time: other.t }),
      );
      const res = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/change-requests/${req.id}/approve`,
        headers: { authorization: `Bearer ${mariaToken}` },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(await bonusOf(booked.id)).toBe(0);
    });

    it('settlement pays the promise as its own ledger row, once; undoing the visit reverses both rows', async () => {
      // The stamped visit, made the account's and already in the past.
      const back = new Date();
      back.setDate(back.getDate() - 3);
      await admin.query(`UPDATE appointments SET status = 'confirmed', client_user_id = $2, date = $3 WHERE id = $1`, [stamped, clientId, iso(back)]);
      const earned = await settleVisit(demo.business, stamped);
      expect(earned).toBe(LOYALTY_RULES.appointment.firstService + LOYALTY_RULES.appointment.quietSlot);
      const rows = (await admin.query(`SELECT type, points, source_id, meta FROM client_loyalty_ledger WHERE client_user_id = $1 AND source_id = $2 ORDER BY created_at`, [clientId, stamped])).rows as {
        type: string; points: number; meta: { reason?: string };
      }[];
      expect(rows.map((r) => [r.type, r.points])).toEqual([
        ['appointment_completed', LOYALTY_RULES.appointment.firstService],
        ['promotion_bonus', LOYALTY_RULES.appointment.quietSlot],
      ]);
      expect(rows[1]!.meta.reason).toBe('quiet_slot');
      // Again: nothing new.
      expect(await settleVisit(demo.business, stamped)).toBe(0);
      const bell = (await admin.query(`SELECT body FROM client_notifications WHERE client_user_id = $1 AND ref_id = $2`, [clientId, stamped])).rows[0] as { body: string };
      expect(bell.body).toContain(`+${LOYALTY_RULES.appointment.quietSlot}`);

      await admin.query(`UPDATE appointments SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [stamped]);
      await runLoyaltySweep();
      const rev = (await admin.query(`SELECT points, source_id FROM client_loyalty_ledger WHERE client_user_id = $1 AND type = 'appointment_reversal' ORDER BY source_id`, [clientId])).rows as {
        points: number; source_id: string;
      }[];
      expect(rev).toEqual([
        { points: -LOYALTY_RULES.appointment.firstService, source_id: stamped },
        { points: -LOYALTY_RULES.appointment.quietSlot, source_id: `${stamped}:quiet` },
      ]);
      await runLoyaltySweep();
      expect((await admin.query(`SELECT count(*)::int AS n FROM client_loyalty_ledger WHERE client_user_id = $1 AND type = 'appointment_reversal'`, [clientId])).rows[0].n).toBe(2);
    });
  });
});
