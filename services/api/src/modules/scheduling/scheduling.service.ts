import type { DaySchedule, ScheduleException } from '@velnes/contracts';
import type { Trx } from '../../db/index.js';
import type { Json } from '../../db/types.js';

export class ScheduleError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'CLASH' | 'BAD_INPUT',
    message: string,
  ) {
    super(message);
  }
}

/* ── Time helpers — the prototype's, verbatim ─────────────────── */
export const mins = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
export const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** 0 = Monday … 6 = Sunday (from an ISO date, computed locally). */
export const wdIdx = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(y!, m! - 1, d!).getDay() + 6) % 7;
};
export const DAY_FULL = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
export const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y!, m! - 1, d! + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};
/** Format a pg DATE (local-midnight Date object) without the UTC
 *  shift that toISOString() causes. */
export const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Every reader of stored hours goes through whList: always a list of
 *  [start,end] pairs, possibly empty. */
export function whList(h: unknown): [string, string][] {
  if (!h || !Array.isArray(h) || !h.length) return [];
  return typeof h[0] === 'string'
    ? [[h[0] as string, h[1] as string]]
    : (h as [string, string][]).map((v) => [v[0], v[1]]);
}
/** Fits within ONE period — never across the split-shift break. */
export const whFits = (h: unknown, startM: number, endM: number) =>
  whList(h).some((v) => startM >= mins(v[0]) && endM <= mins(v[1]));
export const whLabel = (h: unknown) =>
  whList(h)
    .map((v) => `${v[0]}–${v[1]}`)
    .join(', ');

export const withinSchedule = (sch: DaySchedule, startM: number, endM: number) =>
  sch.open && sch.periods.some((p) => startM >= mins(p[0]) && endM <= mins(p[1]));
export const periodAt = (sch: DaySchedule, startM: number) =>
  (sch.open ? sch.periods : []).find((p) => startM >= mins(p[0]) && startM < mins(p[1])) ??
  null;
/** Prep as it really applies: never longer than the gap since the
 *  period opened. */
export function clipPrep(prep: number, startM: number, sch: DaySchedule) {
  if (!prep) return 0;
  const per = periodAt(sch, startM);
  if (!per) return prep;
  return Math.max(0, Math.min(prep, startM - mins(per[0])));
}
export const schedLabel = (sch: DaySchedule) =>
  sch.open ? sch.periods.map((p) => `${p[0]}–${p[1]}`).join(', ') : 'Closed';

const weekHours = (hours: Json | null, wd: number): [string, string][] => {
  if (!hours || typeof hours !== 'object' || Array.isArray(hours)) return [];
  return whList((hours as Record<string, unknown>)[String(wd)]);
};

async function excFor(trx: Trx, locationId: string, date: string) {
  // Several exceptions on one date cannot arise through the door, but
  // if it happens the last-created one counts (prototype rule).
  return trx
    .selectFrom('scheduleExceptions')
    .selectAll()
    .where('locationId', '=', locationId)
    .where('startDate', '<=', new Date(date))
    .where((eb) =>
      eb.or([
        eb('endDate', '>=', new Date(date)),
        eb.and([eb('endDate', 'is', null), eb('startDate', '=', new Date(date))]),
      ]),
    )
    .orderBy('createdAt', 'desc')
    .executeTakeFirst();
}

/**
 * The one question, the one answer: is this location open on this
 * date, and between which times? Exception first — it overlays the
 * week pattern for that date, never edits it.
 */
export async function scheduleFor(
  trx: Trx,
  locationId: string,
  date: string,
): Promise<DaySchedule> {
  const x = await excFor(trx, locationId, date);
  if (x) {
    if (x.type === 'CLOSED')
      return { open: false, periods: [], source: 'exception', reason: x.reason };
    return {
      open: true,
      periods: whList(x.periods),
      source: 'exception',
      reason: x.reason,
    };
  }
  const l = await trx
    .selectFrom('locations')
    .select('hours')
    .where('id', '=', locationId)
    .executeTakeFirst();
  if (!l) throw new ScheduleError('NOT_FOUND', 'Unknown location');
  const reg = weekHours(l.hours, wdIdx(date));
  return { open: reg.length > 0, periods: reg, source: 'regular', reason: null };
}

const toContract = (x: {
  id: string;
  startDate: Date;
  endDate: Date | null;
  type: 'CLOSED' | 'CUSTOM_HOURS';
  periods: Json | null;
  reason: string | null;
  source: 'MANUAL' | 'PUBLIC_HOLIDAY';
  holidayId: string | null;
}): ScheduleException => ({
  id: x.id,
  startDate: localIso(x.startDate),
  endDate: x.endDate ? localIso(x.endDate) : null,
  type: x.type,
  periods: x.periods ? whList(x.periods) : null,
  reason: x.reason,
  source: x.source,
  holidayId: x.holidayId,
});

export async function listExceptions(trx: Trx, locationId: string) {
  const rows = await trx
    .selectFrom('scheduleExceptions')
    .selectAll()
    .where('locationId', '=', locationId)
    .orderBy('startDate')
    .execute();
  return rows.map(toContract);
}

export async function createException(
  trx: Trx,
  locationId: string,
  w: {
    startDate: string;
    endDate?: string | null | undefined;
    type: 'CLOSED' | 'CUSTOM_HOURS';
    periods?: [string, string][] | undefined;
    reason?: string | undefined;
    source?: 'MANUAL' | 'PUBLIC_HOLIDAY' | undefined;
    holidayId?: string | undefined;
  },
) {
  const loc = await trx
    .selectFrom('locations')
    .select(['id', 'tenantId'])
    .where('id', '=', locationId)
    .executeTakeFirst();
  if (!loc) throw new ScheduleError('NOT_FOUND', 'Unknown location');
  if (w.type === 'CUSTOM_HOURS' && !(w.periods && w.periods.length))
    throw new ScheduleError('BAD_INPUT', 'Custom hours need at least one period');
  const end = w.endDate ?? w.startDate;
  if (end < w.startDate) throw new ScheduleError('BAD_INPUT', 'End before start');
  // One exception per date: refuse overlap with an existing one.
  const clash = await trx
    .selectFrom('scheduleExceptions')
    .select('id')
    .where('locationId', '=', locationId)
    .where('startDate', '<=', new Date(end))
    .where((eb) =>
      eb.or([
        eb('endDate', '>=', new Date(w.startDate)),
        eb.and([eb('endDate', 'is', null), eb('startDate', '>=', new Date(w.startDate))]),
      ]),
    )
    .executeTakeFirst();
  if (clash)
    throw new ScheduleError('CLASH', 'Another exception already covers part of those dates');
  const row = await trx
    .insertInto('scheduleExceptions')
    .values({
      tenantId: loc.tenantId,
      locationId,
      startDate: new Date(w.startDate),
      endDate: w.endDate ? new Date(w.endDate) : null,
      type: w.type,
      periods: w.periods ? JSON.stringify(w.periods) : null,
      reason: w.reason ?? null,
      source: w.source ?? 'MANUAL',
      holidayId: w.holidayId ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return toContract(row);
}

export async function deleteException(trx: Trx, locationId: string, id: string) {
  const res = await trx
    .deleteFrom('scheduleExceptions')
    .where('id', '=', id)
    .where('locationId', '=', locationId)
    .executeTakeFirst();
  if (!res.numDeletedRows) throw new ScheduleError('NOT_FOUND', 'Unknown exception');
}

/** Holidays for the location's country (via its business), with the
 *  prototype's open/applied/covered state per holiday. */
export async function locationHolidays(trx: Trx, locationId: string) {
  const loc = await trx
    .selectFrom('locations as l')
    .innerJoin('businesses as b', 'b.id', 'l.tenantId')
    .select(['l.id', 'b.country'])
    .where('l.id', '=', locationId)
    .executeTakeFirst();
  if (!loc) throw new ScheduleError('NOT_FOUND', 'Unknown location');
  const years = await trx
    .selectFrom('holidayCalendarYears')
    .selectAll()
    .where('countryName', '=', loc.country)
    .orderBy('year')
    .execute();
  if (!years.length) return { years: [], holidays: [] };
  const code = years[0]!.countryCode;
  const days = await trx
    .selectFrom('holidays')
    .selectAll()
    .where('countryCode', '=', code)
    .orderBy('date')
    .execute();
  const exceptions = await trx
    .selectFrom('scheduleExceptions')
    .selectAll()
    .where('locationId', '=', locationId)
    .execute();
  const stateOf = (h: { id: string; date: Date }) => {
    const iso = localIso(h.date);
    const x = exceptions
      .filter((e) => {
        const s = localIso(e.startDate);
        const en = e.endDate ? localIso(e.endDate) : s;
        return iso >= s && iso <= en;
      })
      .slice(-1)[0];
    if (!x) return 'open' as const;
    if (x.source === 'PUBLIC_HOLIDAY' && x.holidayId === h.id) return 'applied' as const;
    return 'covered' as const;
  };
  return {
    years: years.map((y) => ({ year: y.year, verified: y.verified, source: y.source })),
    holidays: days.map((h) => ({
      id: h.id,
      date: localIso(h.date),
      name: h.name,
      type: h.type,
      applies: h.applies,
      movedFrom: h.movedFrom ? localIso(h.movedFrom) : null,
      state: stateOf(h),
    })),
  };
}

/** Apply a holiday: one CLOSED exception born from it. Idempotent —
 *  an already-applied or covered date is left alone. */
export async function applyHoliday(trx: Trx, locationId: string, holidayId: string) {
  const h = await trx
    .selectFrom('holidays')
    .selectAll()
    .where('id', '=', holidayId)
    .executeTakeFirst();
  if (!h) throw new ScheduleError('NOT_FOUND', 'Unknown holiday');
  const iso = localIso(h.date);
  const existing = await excFor(trx, locationId, iso);
  if (existing) return toContract(existing);
  return createException(trx, locationId, {
    startDate: iso,
    type: 'CLOSED',
    reason: h.name,
    source: 'PUBLIC_HOLIDAY',
    holidayId: h.id,
  });
}
