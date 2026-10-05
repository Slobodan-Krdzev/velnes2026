import { LOYALTY_RULES, QUIET_SLOT_RULE } from '@velnes/contracts';
import { sql } from 'kysely';
import type { Trx } from '../../db/index.js';
import { withHq, withTenant } from '../../db/index.js';
import { hhmm, mins, nowAt, scheduleFor, wdIdx } from '../scheduling/scheduling.service.js';

/**
 * Quiet slots (Alex, 2026-10-05) — docs/LOYALTY.md "Quiet slots".
 *
 * The algorithm that decides which of a location's times earn the
 * quiet-time bonus. Per location, over the last `windowWeeks`, every
 * weekday-and-start pair the location was open at is judged by how many
 * of those weeks something was booked over it (an appointment that
 * runs across the quarter hour counts — the question is "was this time
 * free", not "did something start here"). A pair is quiet when it has
 * enough open weeks to be judged, its fill is under `maxFill` and under
 * half the location's own fill — so a half-empty salon does not get
 * its whole week tagged — and at most `maxShare` of each weekday's
 * judged pairs are tagged, the quietest first. Ties (a quiet salon has
 * many pairs nobody ever booked) go to the hours of the day the salon
 * as a whole is least booked at, so the tags say "evenings are quiet
 * here" rather than landing on whichever weekday sorts first. Only a
 * location with `minCompleted` completed visits in its history
 * qualifies at all.
 *
 * Decided nightly, per location, written whole; the availability doors
 * only read. Nothing here is computed at request time, so a tag cannot
 * flip while someone is choosing.
 */

const STEP = 15;
const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return dt.toISOString().slice(0, 10);
};

export interface QuietRun {
  completed: number;
  qualified: boolean;
  openPairs: number;
  locationFill: number;
  quietCount: number;
}

/** Judge one location now and write what it found. Tenant context inside. */
export async function recomputeLocation(tenantId: string, locationId: string, now = new Date()): Promise<QuietRun> {
  return withTenant(tenantId, async (trx) => {
    const loc = await trx.selectFrom('locations').select(['tz']).where('id', '=', locationId).executeTakeFirstOrThrow();
    const today = nowAt(loc.tz, now).date;
    const done = await trx
      .selectFrom('appointments')
      .select(sql<number>`count(*)`.as('n'))
      .where('locationId', '=', locationId)
      .where('kind', '=', 'appointment')
      .where('status', 'in', ['booked', 'confirmed'])
      .where('date', '<', new Date(today))
      .executeTakeFirst();
    const completed = Number(done?.n ?? 0);
    const write = async (run: QuietRun, slots: { weekday: number; startMin: number; openWeeks: number; bookedWeeks: number; fill: number }[]) => {
      await trx.deleteFrom('locationQuietSlots').where('locationId', '=', locationId).execute();
      if (slots.length)
        await trx
          .insertInto('locationQuietSlots')
          .values(slots.map((s) => ({ tenantId, locationId, weekday: s.weekday, startMin: s.startMin, openWeeks: s.openWeeks, bookedWeeks: s.bookedWeeks, fill: s.fill.toFixed(4) })))
          .execute();
      await trx
        .insertInto('locationQuietRuns')
        .values({ tenantId, locationId, computedAt: now, completed: run.completed, qualified: run.qualified, openPairs: run.openPairs, locationFill: run.locationFill.toFixed(4), quietCount: run.quietCount })
        .onConflict((oc) =>
          oc.columns(['tenantId', 'locationId']).doUpdateSet({ computedAt: now, completed: run.completed, qualified: run.qualified, openPairs: run.openPairs, locationFill: run.locationFill.toFixed(4), quietCount: run.quietCount }),
        )
        .execute();
      return run;
    };
    if (completed < QUIET_SLOT_RULE.minCompleted)
      return write({ completed, qualified: false, openPairs: 0, locationFill: 0, quietCount: 0 }, []);

    const from = addDays(today, -QUIET_SLOT_RULE.windowWeeks * 7);
    const to = addDays(today, -1);
    const rows = await trx
      .selectFrom('appointments')
      .select(['date', 'startMin', 'durationMin'])
      .where('locationId', '=', locationId)
      .where('kind', '=', 'appointment')
      // Demand, as it was: a no-show wanted the time; a cancellation
      // and an unanswered request did not hold it.
      .where('status', 'in', ['booked', 'confirmed', 'no_show'])
      .where('date', '>=', new Date(from))
      .where('date', '<=', new Date(to))
      .execute();
    const byDay = new Map<string, { s: number; e: number }[]>();
    for (const r of rows) {
      const iso = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10);
      const list = byDay.get(iso) ?? [];
      list.push({ s: r.startMin, e: r.startMin + r.durationMin });
      byDay.set(iso, list);
    }
    const pairs = new Map<string, { weekday: number; startMin: number; open: number; booked: number }>();
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const sch = await scheduleFor(trx, locationId, d);
      if (!sch.open) continue;
      const wd = wdIdx(d);
      const dayAppts = byDay.get(d) ?? [];
      for (const [s, e] of sch.periods) {
        for (let m = mins(s); m + STEP <= mins(e); m += STEP) {
          const k = `${wd}:${m}`;
          const p = pairs.get(k) ?? { weekday: wd, startMin: m, open: 0, booked: 0 };
          p.open += 1;
          if (dayAppts.some((a) => a.s < m + STEP && a.e > m)) p.booked += 1;
          pairs.set(k, p);
        }
      }
    }
    let openSum = 0;
    let bookedSum = 0;
    for (const p of pairs.values()) {
      openSum += p.open;
      bookedSum += p.booked;
    }
    const locationFill = openSum ? bookedSum / openSum : 0;
    const judged = [...pairs.values()].filter((p) => p.open >= QUIET_SLOT_RULE.minOpenWeeks);
    // How booked each hour of the day is across the whole week — the
    // tie-breaker between pairs nobody ever booked.
    const byStart = new Map<number, { open: number; booked: number }>();
    for (const p of judged) {
      const h = byStart.get(p.startMin) ?? { open: 0, booked: 0 };
      h.open += p.open;
      h.booked += p.booked;
      byStart.set(p.startMin, h);
    }
    const hourFill = (m: number) => {
      const h = byStart.get(m);
      return h && h.open ? h.booked / h.open : 0;
    };
    const candidates = judged
      .map((p) => ({ ...p, fill: p.booked / p.open }))
      .filter((p) => locationFill > 0 && p.fill < QUIET_SLOT_RULE.maxFill && p.fill * 2 <= locationFill)
      .sort((a, b) => a.fill - b.fill || hourFill(a.startMin) - hourFill(b.startMin) || a.booked - b.booked || a.startMin - b.startMin);
    const quiet: typeof candidates = [];
    for (let wd = 0; wd < 7; wd++) {
      const cap = Math.floor(judged.filter((p) => p.weekday === wd).length * QUIET_SLOT_RULE.maxShare);
      quiet.push(...candidates.filter((p) => p.weekday === wd).slice(0, cap));
    }
    quiet.sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin);
    return write(
      { completed, qualified: true, openPairs: judged.length, locationFill, quietCount: quiet.length },
      quiet.map((p) => ({ weekday: p.weekday, startMin: p.startMin, openWeeks: p.open, bookedWeeks: p.booked, fill: p.fill })),
    );
  });
}

/** Every location, once. The seed and the HQ button use it; tests too. */
export async function recomputeAllQuietSlots(now = new Date()): Promise<number> {
  const locs = await withHq((trx) => trx.selectFrom('locations').select(['id', 'tenantId']).execute());
  let n = 0;
  for (const l of locs) {
    try {
      await recomputeLocation(l.tenantId, l.id, now);
      n += 1;
    } catch {
      /* one bad location must not stop the rest; the next pass retries */
    }
  }
  return n;
}

/** Locations whose last run is older than a day, or that never ran. */
async function recomputeStale(now = new Date(), maxAgeMs = 20 * 60 * 60_000): Promise<number> {
  const locs = await withHq((trx) =>
    trx
      .selectFrom('locations as l')
      .leftJoin('locationQuietRuns as r', 'r.locationId', 'l.id')
      .select(['l.id', 'l.tenantId', 'r.computedAt'])
      .execute(),
  );
  let n = 0;
  for (const l of locs) {
    if (l.computedAt && now.getTime() - new Date(l.computedAt).getTime() < maxAgeMs) continue;
    try {
      await recomputeLocation(l.tenantId, l.id, now);
      n += 1;
    } catch {
      /* retried next pass */
    }
  }
  return n;
}

let running: Promise<number> | null = null;
export function runQuietSlots(now = new Date()) {
  if (running) return running;
  running = recomputeStale(now).finally(() => {
    running = null;
  });
  return running;
}

/** In-process, like the other loops: a pass an hour, each location
 *  rejudged once a day. A second instance only repeats the same answer. */
export function startQuietSlotsLoop(everyMs = 60 * 60_000) {
  const tick = () => void runQuietSlots().catch(() => undefined);
  setTimeout(tick, 40_000).unref();
  return setInterval(tick, everyMs).unref();
}

/* ── Reading ────────────────────────────────────────────────────────── */

/** The quiet starts (minutes) of one location on one date — empty
 *  unless the location qualifies. Tenant context. */
export async function quietTimesFor(trx: Trx, locationId: string, date: string): Promise<Set<number>> {
  const run = await trx.selectFrom('locationQuietRuns').select('qualified').where('locationId', '=', locationId).executeTakeFirst();
  if (!run?.qualified) return new Set();
  const rows = await trx
    .selectFrom('locationQuietSlots')
    .select('startMin')
    .where('locationId', '=', locationId)
    .where('weekday', '=', wdIdx(date))
    .execute();
  return new Set(rows.map((r) => r.startMin));
}

/** Free starts, with the bonus on the quiet ones. */
export async function withQuietBonus<T extends { t: string; free: boolean }>(trx: Trx, locationId: string, date: string, slots: T[]): Promise<(T & { bonus?: number })[]> {
  if (!slots.some((s) => s.free)) return slots;
  const quiet = await quietTimesFor(trx, locationId, date);
  if (!quiet.size) return slots;
  return slots.map((s) => (s.free && quiet.has(mins(s.t)) ? { ...s, bonus: LOYALTY_RULES.appointment.quietSlot } : s));
}

/** The quiet starts of a location over a range of dates — the
 *  workspace calendar's markers. At most 62 days. */
export async function quietSlotsBetween(trx: Trx, locationId: string, from: string, to: string): Promise<{ date: string; t: string }[]> {
  const run = await trx.selectFrom('locationQuietRuns').select('qualified').where('locationId', '=', locationId).executeTakeFirst();
  if (!run?.qualified) return [];
  const rows = await trx.selectFrom('locationQuietSlots').select(['weekday', 'startMin']).where('locationId', '=', locationId).execute();
  const byWd = new Map<number, number[]>();
  for (const r of rows) byWd.set(r.weekday, [...(byWd.get(r.weekday) ?? []), r.startMin]);
  const out: { date: string; t: string }[] = [];
  const last = addDays(from, 62) < to ? addDays(from, 62) : to;
  for (let d = from; d <= last; d = addDays(d, 1))
    for (const m of (byWd.get(wdIdx(d)) ?? []).sort((a, b) => a - b)) out.push({ date: d, t: hhmm(m) });
  return out;
}

/** HQ's view: every location's last run and its quiet pairs. */
export async function hqQuietSlots() {
  return withHq(async (trx) => {
    const locs = await trx
      .selectFrom('locations as l')
      .innerJoin('businesses as b', 'b.id', 'l.tenantId')
      .leftJoin('locationQuietRuns as r', 'r.locationId', 'l.id')
      .select(['l.id', 'l.tenantId', 'l.name as locationName', 'b.name as salonName', 'r.computedAt', 'r.completed', 'r.qualified', 'r.openPairs', 'r.locationFill', 'r.quietCount'])
      // The locations that qualify first — the rest are one line each.
      .orderBy(sql`coalesce(r.qualified, false)`, 'desc')
      .orderBy('b.name')
      .orderBy('l.name')
      .execute();
    const slots = await trx.selectFrom('locationQuietSlots').select(['locationId', 'weekday', 'startMin', 'openWeeks', 'bookedWeeks', 'fill']).orderBy('weekday').orderBy('startMin').execute();
    return {
      rule: { ...QUIET_SLOT_RULE, bonus: LOYALTY_RULES.appointment.quietSlot },
      locations: locs.map((l) => ({
        locationId: l.id,
        tenantId: l.tenantId,
        locationName: l.locationName,
        salonName: l.salonName,
        computedAt: l.computedAt ? new Date(l.computedAt).toISOString() : null,
        completed: l.completed ?? 0,
        qualified: l.qualified ?? false,
        openPairs: l.openPairs ?? 0,
        locationFill: Number(l.locationFill ?? 0),
        quietCount: l.quietCount ?? 0,
        slots: slots
          .filter((s) => s.locationId === l.id)
          .map((s) => ({ weekday: s.weekday, t: hhmm(s.startMin), openWeeks: s.openWeeks, bookedWeeks: s.bookedWeeks, fill: Number(s.fill) })),
      })),
    };
  });
}
