import { TIMING, type AccessClaims } from '@velnes/contracts';
import { sql } from 'kysely';
import type { Trx } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';
import { svcChoice } from '../catalog/catalog.service.js';
import { addDays, todayIso } from '../scheduling/scheduling.service.js';

export class TimingError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'NO_RECOMMENDATION',
    message: string,
  ) {
    super(message);
  }
}

export const round5 = (m: number) => Math.max(5, Math.round(m / 5) * 5);

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const v = xs.slice().sort((a, b) => a - b);
  const h = Math.floor(v.length / 2);
  return v.length % 2 ? v[h]! : (v[h - 1]! + v[h]!) / 2;
};

/** IQR trim, the usual way: outside 1.5× the quartile distance. */
function trim(xs: number[]): number[] {
  if (xs.length < 4) return xs;
  const v = xs.slice().sort((a, b) => a - b);
  const q = (f: number) => {
    const i = (v.length - 1) * f;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return v[lo]! + (v[hi]! - v[lo]!) * (i - lo);
  };
  const q1 = q(0.25);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  return v.filter((x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr);
}

async function etLookup(
  trx: Trx,
  empId: string,
  serviceId: string,
  variantId: string | null,
  locationId: string | null,
) {
  const find = (loc: string | null) =>
    trx
      .selectFrom('empTimings')
      .selectAll()
      .where('employeeId', '=', empId)
      .where('serviceId', '=', serviceId)
      .where((eb) => (variantId ? eb('variantId', '=', variantId) : eb('variantId', 'is', null)))
      .where((eb) => (loc ? eb('locationId', '=', loc) : eb('locationId', 'is', null)))
      .executeTakeFirst();
  // The exact location first, then everywhere: a time that applies
  // anywhere beats no time at all.
  return (locationId ? await find(locationId) : undefined) ?? (await find(null));
}

/**
 * effTreatment — the minutes that really apply, and where they come
 * from. Resolution: variant-approved → service-approved (other
 * variants inherit by RATIO, so a 90-minute massage never gets the
 * 45-minute slot) → pace (enough observations) → catalog.
 */
export async function effTreatment(
  trx: Trx,
  serviceId: string,
  locationId: string | null,
  variantId: string | null,
  empId: string | null,
): Promise<{ min: number; basis: 'catalog' | 'employee-approved' | 'employee-pace' }> {
  const base = (await svcChoice(trx, serviceId, locationId, variantId)).durationMin;
  const biz = await trx.selectFrom('businesses').select('timingEnabled').executeTakeFirst();
  if (!biz?.timingEnabled) return { min: base, basis: 'catalog' };
  if (!empId) return { min: base, basis: 'catalog' };
  const v = variantId ? await etLookup(trx, empId, serviceId, variantId, locationId) : null;
  if (v?.approvedMin) return { min: v.approvedMin, basis: 'employee-approved' };
  const g = await etLookup(trx, empId, serviceId, null, locationId);
  if (g?.approvedMin) {
    const std = (await svcChoice(trx, serviceId, locationId, null)).durationMin;
    return {
      min: std && base !== std ? round5(base * (g.approvedMin / std)) : g.approvedMin,
      basis: 'employee-approved',
    };
  }
  if (g?.paceFactor && g.observedN >= TIMING.MIN_SVC)
    return { min: round5(base * Number(g.paceFactor)), basis: 'employee-pace' };
  return { min: base, basis: 'catalog' };
}

/** Real observations only: a start and a finish event, not cancelled
 *  or no-show, ratio inside the sanity band. */
async function observationsFor(
  trx: Trx,
  empId: string,
  serviceId: string,
  variantId: string | null,
) {
  const from = addDays(todayIso(), -TIMING.WINDOW);
  let q = trx
    .selectFrom('appointments as a')
    .select(['a.id', 'a.durationMin', 'a.quoted', 'a.date', 'a.variantId'])
    .where('a.employeeId', '=', empId)
    .where('a.serviceId', '=', serviceId)
    .where('a.kind', '=', 'appointment')
    .where('a.status', 'not in', ['cancelled', 'no_show'])
    .where('a.date', '>=', new Date(from));
  if (variantId) q = q.where('a.variantId', '=', variantId);
  const appts = await q.execute();
  if (!appts.length) return [];
  const events = await trx
    .selectFrom('appointmentHistory')
    .select(['appointmentId', 'what', 'at'])
    .where(
      'appointmentId',
      'in',
      appts.map((a) => a.id),
    )
    .where('what', 'in', ['Treatment started', 'Treatment finished'])
    .orderBy('at')
    .execute();
  const out: { min: number; ratio: number }[] = [];
  for (const a of appts) {
    const mine = events.filter((e) => e.appointmentId === a.id);
    const s0 = mine.filter((e) => e.what === 'Treatment started').pop();
    const s1 = mine.filter((e) => e.what === 'Treatment finished').pop();
    if (!s0 || !s1) continue;
    const d = Math.round((s1.at.getTime() - s0.at.getTime()) / 60000);
    if (!(d > 0)) continue;
    const quoted = (a.quoted as { treatmentMin?: number } | null)?.treatmentMin ?? a.durationMin;
    if (!quoted) continue;
    const ratio = d / quoted;
    if (ratio < TIMING.LOW || ratio > TIMING.HIGH) continue; // an error, not an observation
    out.push({ min: d, ratio });
  }
  return out;
}

/**
 * recomputeTiming — one employee, one service (variant optional).
 * Idempotent. Proposals are measured against what applies NOW
 * (approved values keep learning), never bother the owner for less
 * than 5 minutes or 10%, and a dismissed one returns only after the
 * sample grows 25%.
 */
export async function recomputeTiming(
  trx: Trx,
  tenantId: string,
  empId: string,
  serviceId: string,
  variantId: string | null,
  locationId: string | null,
) {
  const obs = await observationsFor(trx, empId, serviceId, variantId);
  const today = todayIso();
  let rec = await etLookup(trx, empId, serviceId, variantId, locationId);
  if (rec && locationId && rec.locationId !== locationId) rec = undefined; // exact row only for writes
  if (!obs.length) {
    if (rec)
      await trx
        .updateTable('empTimings')
        .set({ observedN: 0, computedAt: new Date(today) })
        .where('id', '=', rec.id)
        .execute();
    return;
  }
  const ratios = trim(obs.map((o) => o.ratio));
  const minutes = trim(obs.map((o) => o.min));
  const computed = {
    observedN: obs.length,
    observedMedianMin: Math.round(median(minutes)!),
    paceFactor: (Math.round(median(ratios)! * 100) / 100).toFixed(2),
    windowFrom: new Date(addDays(today, -TIMING.WINDOW)),
    windowTo: new Date(today),
    computedAt: new Date(today),
  };
  if (!rec) {
    const inserted = await trx
      .insertInto('empTimings')
      .values({
        tenantId,
        employeeId: empId,
        serviceId,
        variantId,
        locationId,
        status: 'none',
        ...computed,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    rec = inserted;
  } else {
    await trx.updateTable('empTimings').set(computed).where('id', '=', rec.id).execute();
    rec = { ...rec, ...computed, paceFactor: computed.paceFactor as never };
  }

  const enough = variantId ? TIMING.MIN_VAR : TIMING.MIN_SVC;
  const patch = async (p: Record<string, unknown>) =>
    trx.updateTable('empTimings').set(p).where('id', '=', rec!.id).execute();
  if (computed.observedN < enough) {
    await patch({ recommendedMin: null, ...(rec.status === 'suggested' ? { status: 'none' } : {}) });
    return;
  }
  const basis = (await svcChoice(trx, serviceId, locationId ?? null, variantId)).durationMin;
  const proposal = round5(basis * Number(computed.paceFactor));
  const current = (await effTreatment(trx, serviceId, locationId ?? null, variantId, empId)).min;
  const delta = Math.abs(proposal - current);
  await patch({ recommendedMin: proposal });
  if (delta < TIMING.MIN_DELTA || delta / current < TIMING.MIN_PCT) {
    if (rec.status === 'suggested') await patch({ status: 'none' });
    return;
  }
  if (rec.status === 'dismissed' && computed.observedN < rec.dismissedAtN * (1 + TIMING.REGROW))
    return;
  await patch({ status: 'suggested' });
}

/** Every pair that has appointments — nightly, and after each finished
 *  treatment for the pair it concerns. Idempotent. */
export async function recomputeAll(trx: Trx, tenantId: string) {
  const pairs = await trx
    .selectFrom('appointments')
    .select(['employeeId', 'serviceId'])
    .distinct()
    .where('employeeId', 'is not', null)
    .where('serviceId', 'is not', null)
    .execute();
  for (const p of pairs)
    await recomputeTiming(trx, tenantId, p.employeeId!, p.serviceId!, null, null);
  const suggested = await trx
    .selectFrom('empTimings')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('status', '=', 'suggested')
    .executeTakeFirst();
  return { pairs: pairs.length, suggested: suggested?.n ?? 0 };
}

export async function listSuggestions(trx: Trx) {
  const rows = await trx
    .selectFrom('empTimings as t')
    .innerJoin('employees as e', 'e.id', 't.employeeId')
    .innerJoin('services as s', 's.id', 't.serviceId')
    .selectAll('t')
    .select(['e.name as employeeName', 's.name as serviceName'])
    .where('t.status', '=', 'suggested')
    .where('t.recommendedMin', 'is not', null)
    .execute();
  const out = [];
  for (const t of rows)
    out.push({
      id: t.id,
      employeeId: t.employeeId,
      employeeName: t.employeeName,
      serviceId: t.serviceId,
      serviceName: t.serviceName,
      variantId: t.variantId,
      observedN: t.observedN,
      observedMedianMin: t.observedMedianMin,
      paceFactor: t.paceFactor === null ? null : Number(t.paceFactor),
      recommendedMin: t.recommendedMin,
      currentMin: (
        await effTreatment(trx, t.serviceId, t.locationId ?? null, t.variantId, t.employeeId)
      ).min,
      status: t.status,
    });
  return out;
}

/** Approve: the owner speaks, the audit remembers. */
export async function acceptTiming(trx: Trx, claims: AccessClaims, id: string) {
  const t = await trx
    .selectFrom('empTimings')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!t) throw new TimingError('NOT_FOUND', 'Unknown timing record');
  if (!t.recommendedMin) throw new TimingError('NO_RECOMMENDATION', 'Nothing to approve');
  const was = (
    await effTreatment(trx, t.serviceId, t.locationId ?? null, t.variantId, t.employeeId)
  ).min;
  const actor = await trx
    .selectFrom('employees')
    .select('name')
    .where('id', '=', claims.sub)
    .executeTakeFirst();
  await trx
    .updateTable('empTimings')
    .set({
      approvedMin: t.recommendedMin,
      approvedBy: actor?.name ?? 'Unknown',
      approvedAt: new Date(todayIso()),
      status: 'approved',
      source: 'observed',
    })
    .where('id', '=', id)
    .execute();
  const emp = await trx
    .selectFrom('employees')
    .select('name')
    .where('id', '=', t.employeeId)
    .executeTakeFirst();
  const svc = await trx
    .selectFrom('services')
    .select('name')
    .where('id', '=', t.serviceId)
    .executeTakeFirst();
  await logAudit(trx, t.tenantId, {
    actorEmployeeId: claims.sub,
    actorName: actor?.name ?? 'Unknown',
    action: 'Timing approved',
    object: `${emp?.name ?? '—'} · ${svc?.name ?? '—'}`,
    before: `${was} min`,
    after: `${t.recommendedMin} min`,
    source: `${t.observedN} appointments`,
  });
}

export async function dismissTiming(trx: Trx, id: string) {
  const t = await trx
    .selectFrom('empTimings')
    .select(['id', 'observedN'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!t) throw new TimingError('NOT_FOUND', 'Unknown timing record');
  await trx
    .updateTable('empTimings')
    .set({ status: 'dismissed', dismissedAtN: t.observedN })
    .where('id', '=', id)
    .execute();
}
