import type { AccessClaims, Appointment, BookRequest } from '@velnes/contracts';
import type { Trx } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';
import { priceFor, svcAt, svcChoice, svcLine } from '../catalog/catalog.service.js';
import { locLive } from '../locations/locations.service.js';
import type { DaySchedule } from '@velnes/contracts';
import {
  clipPrep,
  localIso,
  DAY_FULL,
  hhmm,
  mins,
  scheduleFor,
  schedLabel,
  whFits,
  whLabel,
  whList,
  wdIdx,
  withinSchedule,
} from '../scheduling/scheduling.service.js';

export const DAY_START = 480; // 08:00
export const DAY_END = 1140; // 19:00
export const HOLD_SECONDS = 600;

export class BookingRefused extends Error {}
export class BookingError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'GONE',
    message: string,
  ) {
    super(message);
  }
}

type DayScheduleT = DaySchedule;

interface CheckReq {
  locationId: string;
  date: string;
  start: string; // HH:MM
  dur: number; // treatment minutes
  emp: string | 'any';
  sid?: string | null | undefined;
  custId?: string | null | undefined;
  key?: string | undefined; // your own hold does not block you
  ignoreId?: string | undefined; // editing yourself
  prepMin?: number | undefined;
  resetMin?: number | undefined;
}

async function empsFor(trx: Trx, locationId: string, serviceId: string) {
  return trx
    .selectFrom('employees as e')
    .innerJoin('employeeLocations as el', 'el.employeeId', 'e.id')
    .leftJoin('employeeSkills as sk', (j) =>
      j.onRef('sk.employeeId', '=', 'e.id').on('sk.serviceId', '=', serviceId),
    )
    .select(['e.id', 'e.name', 'e.hours', 'e.bookable', 'e.status'])
    .select('sk.serviceId as skillMatch')
    .where('el.locationId', '=', locationId)
    .where('e.bookable', '=', true)
    .where('e.status', '=', 'active')
    .execute()
    .then(async (rows) => {
      // "No skills registered" means "does everything" (prototype rule).
      const withAny = [];
      for (const r of rows) {
        if (r.skillMatch) {
          withAny.push(r);
          continue;
        }
        const hasSkills = await trx
          .selectFrom('employeeSkills')
          .select('serviceId')
          .where('employeeId', '=', r.id)
          .limit(1)
          .executeTakeFirst();
        if (!hasSkills) withAny.push(r);
      }
      return withAny;
    });
}

async function heldAt(
  trx: Trx,
  locationId: string,
  date: string,
  startMin: number,
  empId: string | null,
  ignoreKey?: string | undefined,
) {
  let q = trx
    .selectFrom('holds')
    .select('id')
    .where('locationId', '=', locationId)
    .where('date', '=', new Date(date))
    .where('startMin', '=', startMin)
    .where('until', '>', new Date());
  if (empId) q = q.where((eb) => eb.or([eb('employeeId', '=', empId), eb('employeeId', 'is', null)]));
  if (ignoreKey) q = q.where('key', '!=', ignoreKey);
  return !!(await q.executeTakeFirst());
}

async function timingFor(trx: Trx, req: CheckReq, sch: DayScheduleT) {
  if (req.prepMin !== undefined && req.resetMin !== undefined)
    return {
      prep: clipPrep(Math.max(0, req.prepMin), mins(req.start), sch),
      reset: Math.max(0, req.resetMin),
    };
  if (!req.sid) return { prep: 0, reset: 0 };
  const line = await svcLine(trx, {
    serviceId: req.sid,
    locationId: req.locationId,
    variantId: null,
    modifierOptionIds: [],
  });
  return { prep: clipPrep(line.prepMin, mins(req.start), sch), reset: line.resetMin };
}

/**
 * bookingCheck — the ONE gate to the calendar. Front desk, widget,
 * marketplace, till and API all ask the same question and get the
 * same answer (a human sentence, or null for "free"). The widget can
 * never be more lenient than the front desk.
 */
export async function bookingCheck(trx: Trx, req: CheckReq): Promise<string | null> {
  const loc = await trx
    .selectFrom('locations')
    .select(['id', 'name', 'rooms'])
    .where('id', '=', req.locationId)
    .executeTakeFirst();
  if (!loc) return 'That location does not exist';
  const sch = await scheduleFor(trx, req.locationId, req.date);
  const wrap = await timingFor(trx, req, sch);
  const startM0 = mins(req.start) - wrap.prep;
  const endM0 = mins(req.start) + req.dur + wrap.reset;
  if (!sch.open) {
    if (sch.source === 'exception')
      return `${loc.name} is closed on ${req.date} — ${sch.reason ?? 'a scheduled closure'}`;
    return `${loc.name} is closed on ${DAY_FULL[wdIdx(req.date)]}s`;
  }
  if (!withinSchedule(sch, startM0, endM0)) {
    if (sch.source === 'exception')
      return `${loc.name} is only open ${schedLabel(sch)} on ${req.date}`;
    return `${loc.name} is open ${schedLabel(sch)} on ${DAY_FULL[wdIdx(req.date)]}s`;
  }

  if (req.emp === 'any') {
    const pool = req.sid ? await empsFor(trx, req.locationId, req.sid) : [];
    if (!pool.length) return `Nobody at ${loc.name} does this service`;
    for (const e of pool)
      if (!(await bookingCheck(trx, { ...req, emp: e.id }))) return null;
    return `Nobody is free at ${req.start} on ${req.date}`;
  }

  const emp = await trx
    .selectFrom('employees')
    .selectAll()
    .where('id', '=', req.emp)
    .executeTakeFirst();
  if (!emp) return 'Pick an employee first';
  const who = emp.name.split(' ')[0]!;
  const atLoc = await trx
    .selectFrom('employeeLocations')
    .select('locationId')
    .where('employeeId', '=', emp.id)
    .where('locationId', '=', req.locationId)
    .executeTakeFirst();
  if (!atLoc) return `${who} does not work at ${loc.name}`;
  if (!emp.bookable)
    return `${who} is not bookable — switch that on under Settings › Team & access`;
  if (emp.status !== 'active') return `${who} has not accepted their invite yet`;

  const startM = mins(req.start) - wrap.prep;
  const endM = mins(req.start) + req.dur + wrap.reset;
  if (endM > DAY_END) return `That runs past closing time (${hhmm(DAY_END)})`;
  if (startM < DAY_START) return `Setting up for that would start before ${hhmm(DAY_START)}`;
  const hoursObj =
    emp.hours && typeof emp.hours === 'object' && !Array.isArray(emp.hours)
      ? (emp.hours as Record<string, unknown>)
      : null;
  const win = whList(hoursObj?.[String(wdIdx(req.date))]);
  if (!win.length) return `${who} does not work on ${DAY_FULL[wdIdx(req.date)]}s`;
  if (sch.source === 'exception' && !withinSchedule(sch, startM, endM))
    return `${loc.name} is only open ${schedLabel(sch)} on ${req.date}`;
  // Within ONE working period — never across the split-shift break.
  if (!whFits(win, startM, endM)) {
    const raw = mins(req.start);
    const rawEnd = raw + req.dur;
    if (whFits(win, raw, rawEnd))
      return (
        `${who} works ${whLabel(win)} — that leaves no room for the ` +
        `${wrap.prep && wrap.reset ? 'set-up and clean-up' : wrap.prep ? 'set-up' : 'clean-up'} around it`
      );
    return `${who} works ${whLabel(win)} on ${DAY_FULL[wdIdx(req.date)]}s`;
  }
  if (req.sid) {
    const hasSkills = await trx
      .selectFrom('employeeSkills')
      .select('serviceId')
      .where('employeeId', '=', emp.id)
      .execute();
    if (hasSkills.length && !hasSkills.some((s) => s.serviceId === req.sid))
      return `${who} does not do this service`;
  }
  if (req.custId) {
    const c = await trx
      .selectFrom('customers')
      .select(['name', 'blacklisted', 'noShows'])
      .where('id', '=', req.custId)
      .executeTakeFirst();
    if (c?.blacklisted) return `${c.name} is blacklisted after ${c.noShows} no-shows`;
  }
  // Two blocks that touch, clash: prep/reset are inside the blocks.
  const others = await trx
    .selectFrom('appointments')
    .select(['id', 'startMin', 'durationMin', 'prepMin', 'resetMin', 'kind', 'status'])
    .where('employeeId', '=', emp.id)
    .where('date', '=', new Date(req.date))
    .where('status', '!=', 'cancelled')
    .execute();
  const clash = others.find(
    (a) =>
      a.id !== req.ignoreId &&
      a.startMin - a.prepMin < endM &&
      startM < a.startMin + a.durationMin + a.resetMin,
  );
  if (clash)
    return `${who} is already booked ${hhmm(clash.startMin)}–${hhmm(clash.startMin + clash.durationMin)}`;
  if (await heldAt(trx, req.locationId, req.date, mins(req.start), emp.id, req.key))
    return 'Somebody is paying for that time right now';
  // The room is taken exactly as long as the employee.
  const rooms = loc.rooms || 2;
  const roomRows = await trx
    .selectFrom('appointments')
    .select(['id', 'startMin', 'durationMin', 'prepMin', 'resetMin'])
    .where('locationId', '=', req.locationId)
    .where('date', '=', new Date(req.date))
    .where('kind', '=', 'appointment')
    .where('status', '!=', 'cancelled')
    .execute();
  const busyRooms = roomRows.filter(
    (a) =>
      a.id !== req.ignoreId &&
      a.startMin - a.prepMin < endM &&
      startM < a.startMin + a.durationMin + a.resetMin,
  ).length;
  if (busyRooms >= rooms) return `All ${rooms} rooms at ${loc.name} are taken then`;
  return null;
}

/** The only place free times come from. */
export async function availableSlots(
  trx: Trx,
  q: {
    locationId: string;
    serviceId: string;
    employeeId: string | 'any';
    date: string;
    variantId?: string | null | undefined;
    key?: string | undefined;
  },
) {
  if (!(await locLive(trx, q.locationId))) return []; // non-live locations do not exist here
  const cfg = await svcAt(trx, q.serviceId, q.locationId).catch(() => null);
  if (!cfg?.active) return [];
  const pool =
    q.employeeId === 'any'
      ? (await empsFor(trx, q.locationId, q.serviceId)).map((e) => e.id)
      : [q.employeeId];
  const lineFor = async (empId: string | null) =>
    svcLine(trx, {
      serviceId: q.serviceId,
      locationId: q.locationId,
      variantId: q.variantId ?? null,
      modifierOptionIds: [],
      employeeId: empId,
    });
  const durCache = new Map<string, number>();
  const durFor = async (id: string) => {
    if (!durCache.has(id))
      durCache.set(id, (await lineFor(q.employeeId === 'any' ? id : id)).treatmentMin);
    return durCache.get(id)!;
  };
  // With "no preference" the OFFERED duration is the catalog's.
  const quotedLine = await lineFor(q.employeeId === 'any' ? null : q.employeeId);
  const quoted = quotedLine.treatmentMin;
  const sch = await scheduleFor(trx, q.locationId, q.date);
  const out: { t: string; emp: string | null; free: boolean }[] = [];
  for (let m = DAY_START; m + quoted + quotedLine.resetMin <= DAY_END; m += 30) {
    if (m - clipPrep(quotedLine.prepMin, m, sch) < DAY_START) continue;
    let who: string | null = null;
    for (const id of pool) {
      const dur = q.employeeId === 'any' ? await durFor(id) : quoted;
      // Whoever takes longer than what is offered does not fit the slot.
      if (q.employeeId === 'any' && dur > quoted) continue;
      const refusal = await bookingCheck(trx, {
        locationId: q.locationId,
        date: q.date,
        start: hhmm(m),
        dur,
        emp: id,
        sid: q.serviceId,
        key: q.key,
      });
      if (!refusal) {
        who = id;
        break;
      }
    }
    out.push({ t: hhmm(m), emp: who, free: !!who });
  }
  return out;
}

export async function createHold(
  trx: Trx,
  q: {
    key: string;
    locationId: string;
    serviceId: string;
    date: string;
    time: string;
    employeeId: string | 'any';
  },
) {
  const loc = await trx
    .selectFrom('locations')
    .select(['tenantId'])
    .where('id', '=', q.locationId)
    .executeTakeFirst();
  if (!loc) throw new BookingError('NOT_FOUND', 'Unknown location');
  const existing = await trx
    .selectFrom('holds')
    .selectAll()
    .where('key', '=', q.key)
    .executeTakeFirst();
  if (existing) return { holdId: existing.id, until: existing.until.toISOString() };
  const line = await svcLine(trx, {
    serviceId: q.serviceId,
    locationId: q.locationId,
    variantId: null,
    modifierOptionIds: [],
  });
  const refusal = await bookingCheck(trx, {
    locationId: q.locationId,
    date: q.date,
    start: q.time,
    dur: line.treatmentMin,
    emp: q.employeeId,
    sid: q.serviceId,
    key: q.key,
  });
  if (refusal) throw new BookingRefused(refusal);
  const until = new Date(Date.now() + HOLD_SECONDS * 1000);
  const row = await trx
    .insertInto('holds')
    .values({
      tenantId: loc.tenantId,
      key: q.key,
      locationId: q.locationId,
      date: new Date(q.date),
      startMin: mins(q.time),
      employeeId: q.employeeId === 'any' ? null : q.employeeId,
      serviceId: q.serviceId,
      until,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { holdId: row.id, until: until.toISOString() };
}

async function toContract(trx: Trx, id: string): Promise<Appointment> {
  const a = await trx
    .selectFrom('appointments as a')
    .leftJoin('services as s', 's.id', 'a.serviceId')
    .selectAll('a')
    .select('s.name as serviceName')
    .where('a.id', '=', id)
    .executeTakeFirstOrThrow();
  return {
    id: a.id,
    locationId: a.locationId,
    date: localIso(a.date),
    start: hhmm(a.startMin),
    end: hhmm(a.startMin + a.durationMin),
    kind: a.kind,
    status: a.status,
    title: a.title,
    serviceId: a.serviceId,
    serviceName: a.serviceName,
    variantId: a.variantId,
    variantLabel: a.variantLabel,
    modifierNames: a.modifierNames,
    employeeId: a.employeeId,
    anyEmp: a.anyEmp,
    customerId: a.customerId,
    price: a.price,
    durationMin: a.durationMin,
    prepMin: a.prepMin,
    resetMin: a.resetMin,
    basis: ((a.quoted as { basis?: string } | null)?.basis ?? null) as Appointment['basis'],
    source: a.source,
  };
}

/**
 * Confirming is one act: the appointment lands whole, or not at all.
 * The same key twice returns the same appointment, never a double.
 * The price is asked at the door again — the client's screen decides
 * nothing.
 */
export async function confirmBooking(
  trx: Trx,
  claims: AccessClaims | null,
  req: BookRequest,
): Promise<Appointment> {
  const prior = await trx
    .selectFrom('appointments')
    .select('id')
    .where('idempotencyKey', '=', req.key)
    .executeTakeFirst();
  if (prior) return toContract(trx, prior.id);

  const loc = await trx
    .selectFrom('locations')
    .select(['tenantId', 'name'])
    .where('id', '=', req.locationId)
    .executeTakeFirst();
  if (!loc) throw new BookingError('NOT_FOUND', 'Unknown location');
  const tenantId = loc.tenantId;

  // Resolve "no preference" to whoever is free at that time.
  let empId: string;
  if (req.employeeId === 'any') {
    const slots = await availableSlots(trx, {
      locationId: req.locationId,
      serviceId: req.serviceId,
      employeeId: 'any',
      date: req.date,
      variantId: req.variantId ?? null,
      key: req.key,
    });
    const slot = slots.find((s) => s.t === req.time);
    if (!slot?.emp) throw new BookingRefused(`Nobody is free at ${req.time} on ${req.date}`);
    empId = slot.emp;
  } else empId = req.employeeId;

  // Customer: by id, else matched by phone/email, else created.
  let custId = req.customerId ?? null;
  let custName = req.name ?? null;
  if (!custId && (req.phone || req.email)) {
    const found = await trx
      .selectFrom('customers')
      .select(['id', 'name'])
      .where((eb) =>
        eb.or([
          ...(req.phone ? [eb('phone', '=', req.phone)] : []),
          ...(req.email ? [eb('email', '=', req.email)] : []),
        ]),
      )
      .executeTakeFirst();
    if (found) {
      custId = found.id;
      custName = found.name;
    } else if (req.name) {
      const created = await trx
        .insertInto('customers')
        .values({
          tenantId,
          name: req.name,
          email: req.email ?? null,
          phone: req.phone ?? null,
          custGroup: 'New',
        })
        .returning(['id', 'name'])
        .executeTakeFirstOrThrow();
      custId = created.id;
      custName = created.name;
    }
  } else if (custId) {
    const c = await trx
      .selectFrom('customers')
      .select('name')
      .where('id', '=', custId)
      .executeTakeFirst();
    custName = c?.name ?? custName;
  }

  const line = await svcLine(trx, {
    serviceId: req.serviceId,
    locationId: req.locationId,
    variantId: req.variantId ?? null,
    modifierOptionIds: req.modifierOptionIds,
    employeeId: empId,
  });
  if (line.missingRequired.length)
    throw new BookingRefused(`Choose ${line.missingRequired.join(', ')} first`);

  const refusal = await bookingCheck(trx, {
    locationId: req.locationId,
    date: req.date,
    start: req.time,
    dur: line.treatmentMin,
    emp: empId,
    sid: req.serviceId,
    custId,
    key: req.key,
    prepMin: line.prepMin,
    resetMin: line.resetMin,
  });
  if (refusal) throw new BookingRefused(refusal);

  // Price at the door: priceFor's effective + the modifier delta.
  const pr = await priceFor(trx, {
    serviceId: req.serviceId,
    locationId: req.locationId,
    variantId: line.vid,
  });
  const choice = await svcChoice(trx, req.serviceId, req.locationId, line.vid);
  const price = Math.max(0, pr.effective + (line.price - choice.price));

  const sch = await scheduleFor(trx, req.locationId, req.date);
  const svc = await trx
    .selectFrom('services')
    .select('name')
    .where('id', '=', req.serviceId)
    .executeTakeFirst();
  const inserted = await trx
    .insertInto('appointments')
    .values({
      tenantId,
      locationId: req.locationId,
      date: new Date(req.date),
      startMin: mins(req.time),
      durationMin: line.treatmentMin,
      prepMin: clipPrep(line.prepMin, mins(req.time), sch),
      resetMin: line.resetMin,
      kind: 'appointment',
      status: 'booked',
      title: custName ?? 'Walk-in',
      serviceId: req.serviceId,
      variantId: line.vid,
      variantLabel: line.label,
      modifierOptionIds: req.modifierOptionIds,
      modifierNames: line.modNames,
      employeeId: empId,
      anyEmp: req.employeeId === 'any',
      customerId: custId,
      price,
      quoted: JSON.stringify({
        treatmentMin: line.treatmentMin,
        prepMin: line.prepMin,
        resetMin: line.resetMin,
        basis: line.basis,
      }),
      source: req.source,
      deposit: req.deposit,
      paid: req.deposit ? 'deposit' : 'unpaid',
      idempotencyKey: req.key,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  await trx
    .insertInto('appointmentHistory')
    .values({
      tenantId,
      appointmentId: inserted.id,
      what: 'Created',
      byName: custName ?? 'Walk-in',
      source: req.source,
    })
    .execute();
  await trx.deleteFrom('holds').where('key', '=', req.key).execute();

  const emp = await trx
    .selectFrom('employees')
    .select('name')
    .where('id', '=', empId)
    .executeTakeFirst();
  await logAudit(trx, tenantId, {
    actorEmployeeId: claims?.sub ?? null,
    actorName: custName ?? 'Walk-in',
    action: 'Appointment created',
    object: `${svc?.name ?? ''} · ${custName ?? 'Walk-in'}`,
    after: `${req.date} ${req.time} · ${emp?.name ?? ''}`,
    locationName: loc.name,
    source: req.source,
  });
  return toContract(trx, inserted.id);
}

export async function listAppointments(trx: Trx, q: { locationId: string; from: string; to: string }) {
  const rows = await trx
    .selectFrom('appointments')
    .select('id')
    .where('locationId', '=', q.locationId)
    .where('date', '>=', new Date(q.from))
    .where('date', '<=', new Date(q.to))
    .orderBy('date')
    .orderBy('startMin')
    .execute();
  const out = [];
  for (const r of rows) out.push(await toContract(trx, r.id));
  return out;
}

export async function patchAppointment(
  trx: Trx,
  claims: AccessClaims,
  id: string,
  patch: {
    date?: string | undefined;
    time?: string | undefined;
    employeeId?: string | undefined;
    status?: 'booked' | 'confirmed' | 'cancelled' | 'no_show' | undefined;
    reason?: string | undefined;
  },
) {
  const a = await trx
    .selectFrom('appointments')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!a) throw new BookingError('NOT_FOUND', 'Unknown appointment');

  if (patch.date || patch.time || patch.employeeId) {
    const date = patch.date ?? localIso(a.date);
    const time = patch.time ?? hhmm(a.startMin);
    const emp = patch.employeeId ?? a.employeeId;
    if (!emp) throw new BookingError('NOT_FOUND', 'Appointment has no employee');
    const refusal = await bookingCheck(trx, {
      locationId: a.locationId,
      date,
      start: time,
      dur: a.durationMin,
      emp,
      sid: a.serviceId,
      ignoreId: a.id,
      prepMin: a.prepMin,
      resetMin: a.resetMin,
    });
    if (refusal) throw new BookingRefused(refusal);
    await trx
      .updateTable('appointments')
      .set({ date: new Date(date), startMin: mins(time), employeeId: emp })
      .where('id', '=', id)
      .execute();
    await trx
      .insertInto('appointmentHistory')
      .values({ tenantId: a.tenantId, appointmentId: id, what: 'Moved', byName: '', source: 'staff' })
      .execute();
  }
  if (patch.status && patch.status !== a.status) {
    await trx
      .updateTable('appointments')
      .set({ status: patch.status })
      .where('id', '=', id)
      .execute();
    await trx
      .insertInto('appointmentHistory')
      .values({
        tenantId: a.tenantId,
        appointmentId: id,
        what: patch.status === 'cancelled' ? 'Cancelled' : `Status: ${patch.status}`,
        byName: '',
        source: 'staff',
      })
      .execute();
    await logAudit(trx, a.tenantId, {
      actorEmployeeId: claims.sub,
      actorName: '',
      action: 'Appointment ' + (patch.status === 'cancelled' ? 'cancelled' : 'status changed'),
      object: a.title,
      before: a.status,
      after: patch.status,
      reason: patch.reason,
    });
  }
  return toContract(trx, id);
}

/** Treatment start/finish from the employee app: the timing engine's
 *  only inputs. A finish recomputes the pair it concerns. */
export async function appointmentEvent(
  trx: Trx,
  id: string,
  what: 'Treatment started' | 'Treatment finished',
  byName: string,
) {
  const a = await trx
    .selectFrom('appointments')
    .select(['id', 'tenantId', 'employeeId', 'serviceId'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!a) throw new BookingError('NOT_FOUND', 'Unknown appointment');
  await trx
    .insertInto('appointmentHistory')
    .values({ tenantId: a.tenantId, appointmentId: id, what, byName, source: 'employee' })
    .execute();
  if (what === 'Treatment finished' && a.employeeId && a.serviceId) {
    const { recomputeTiming } = await import('../timing/timing.service.js');
    await recomputeTiming(trx, a.tenantId, a.employeeId, a.serviceId, null, null);
  }
}
