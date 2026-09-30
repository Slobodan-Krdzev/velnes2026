import { createI18n } from '@velnes/i18n';
import type { AccessClaims, CancelledBy, ChangeRequest, PaymentSummary, RefundSummary } from '@velnes/contracts';
import { sql } from 'kysely';
import type { Trx } from '../../db/index.js';
import { withHq } from '../../db/index.js';
import { env } from '../../env.js';
import { logAudit } from '../audit/audit.service.js';
import { notifySalon } from '../clients/clients.service.js';
import { queueMail } from '../mail/mail.service.js';
import { releaseSlotToPremium } from '../marketing/marketing.service.js';
import { createRefundIntent } from '../payments/refunds.service.js';
import { hhmm, instantAt, localIso, mins } from '../scheduling/scheduling.service.js';
import { BookingError, BookingRefused, bookingCheck, legStarts, refuse, type Refusal } from './booking.service.js';
import type { ClientNotice } from './requests.service.js';

/**
 * Booking changes — Alex, 2026-09-30. docs/BOOKING-CHANGES.md.
 *
 * Two customer-facing lifecycles, one module:
 *
 *  - A RESCHEDULE is a request. The visit keeps its status and its time
 *    until the salon approves; a decline leaves the original booked and
 *    waits for the customer's word — keep it, or cancel it.
 *  - A CANCELLATION is a policy-governed event. The window is the one
 *    accepted at booking (`appointments.cancel_hours`), measured as
 *    instants in the location's own zone; the door refuses past the
 *    deadline whatever the screen showed. Cancelling writes the facts
 *    on the row (when, by whom, why), frees the slot, creates the refund
 *    intent for a prepaid visit, offers the released slot to Premium,
 *    and tells both sides.
 *
 * The VISIT is the unit: a multi-treatment visit is a chain of sibling
 * rows (see confirmChain), and a request or a cancellation moves or
 * cancels every leg. Every transition here is a guarded UPDATE inside
 * the caller's transaction, with the bells and mails queued in the same
 * transaction — so a retried call that finds the transition already
 * made refuses, and sends nothing twice.
 */

/* ── The visit ──────────────────────────────────────────────────────── */

export interface Leg {
  id: string;
  tenantId: string;
  locationId: string;
  date: string;
  startMin: number;
  durationMin: number;
  prepMin: number;
  resetMin: number;
  serviceId: string | null;
  variantId: string | null;
  modifierOptionIds: string[];
  employeeId: string | null;
  anyEmp: boolean;
  customerId: string | null;
  clientUserId: string | null;
  status: string;
  title: string;
  price: number;
  cancelHours: number | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  idempotencyKey: string | null;
}

/** Every leg of the visit this appointment belongs to, first leg first,
 *  locked for the transaction when asked (every writer asks). */
export async function visitLegs(trx: Trx, appointmentId: string, lock = false): Promise<Leg[]> {
  const one = await trx.selectFrom('appointments').selectAll().where('id', '=', appointmentId).executeTakeFirst();
  if (!one) throw new BookingError('NOT_FOUND', 'Unknown appointment');
  const m = one.idempotencyKey?.match(/^(.*):(\d+)$/);
  let q = trx.selectFrom('appointments').selectAll().where('kind', '=', 'appointment');
  q = m ? q.where('idempotencyKey', 'like', `${m[1]}:%`) : q.where('id', '=', appointmentId);
  if (lock) q = q.forUpdate();
  const rows = await q.orderBy('date').orderBy('startMin').execute();
  return rows.map((a) => ({
    id: a.id,
    tenantId: a.tenantId,
    locationId: a.locationId,
    date: localIso(a.date),
    startMin: a.startMin,
    durationMin: a.durationMin,
    prepMin: a.prepMin,
    resetMin: a.resetMin,
    serviceId: a.serviceId,
    variantId: a.variantId,
    modifierOptionIds: a.modifierOptionIds ?? [],
    employeeId: a.employeeId,
    anyEmp: a.anyEmp,
    customerId: a.customerId,
    clientUserId: a.clientUserId,
    status: a.status,
    title: a.title,
    price: a.price,
    cancelHours: a.cancelHours,
    cancelledAt: a.cancelledAt,
    cancelledBy: a.cancelledBy,
    cancelReason: a.cancelReason,
    idempotencyKey: a.idempotencyKey,
  }));
}

async function tzOf(trx: Trx, locationId: string): Promise<string> {
  const loc = await trx.selectFrom('locations').select(['tz', 'cancelHours']).where('id', '=', locationId).executeTakeFirst();
  return loc?.tz ?? 'Europe/Skopje';
}

/* ── The cancellation window ────────────────────────────────────────── */

export interface CancelWindow {
  /** The instant after which cancelling is no longer free. */
  deadline: Date;
  /** The visit's start, as an instant. */
  start: Date;
  hours: number;
  allowed: boolean;
}

/**
 * `deadline = start − hours`, both instants in the location's zone.
 * Allowed strictly before the deadline; at it, or after, blocked. Zero
 * hours means "until it starts". The hours are the visit's own snapshot
 * — the terms accepted at booking — never the location's current value.
 */
export function cancelWindow(legs: Leg[], tz: string, now: Date): CancelWindow {
  const first = legs[0]!;
  const hours = first.cancelHours ?? 24;
  const start = instantAt(tz, first.date, first.startMin);
  const deadline = new Date(start.getTime() - hours * 3_600_000);
  return { deadline, start, hours, allowed: now.getTime() < deadline.getTime() };
}

/* ── Rights, as the server decides them ─────────────────────────────── */

export interface VisitRights {
  canReschedule: boolean;
  canCancel: boolean;
  cancelDeadline: string | null;
  cancelBlockedReason: 'too_late' | 'cancelled' | 'started' | 'requested' | null;
}

export function visitRights(legs: Leg[], active: { status: string } | null, tz: string, now: Date): VisitRights {
  const first = legs[0]!;
  if (legs.every((l) => l.status === 'cancelled'))
    return { canReschedule: false, canCancel: false, cancelDeadline: null, cancelBlockedReason: 'cancelled' };
  const w = cancelWindow(legs, tz, now);
  if (now.getTime() >= w.start.getTime())
    return { canReschedule: false, canCancel: false, cancelDeadline: w.deadline.toISOString(), cancelBlockedReason: 'started' };
  const live = first.status === 'booked' || first.status === 'confirmed';
  return {
    // A booking request not yet accepted cannot be moved (it may be
    // declined outright); a pending or declined-unanswered request
    // blocks a second one.
    canReschedule: live && !active,
    canCancel: w.allowed,
    cancelDeadline: w.deadline.toISOString(),
    cancelBlockedReason: w.allowed ? null : 'too_late',
  };
}

/* ── The people ─────────────────────────────────────────────────────── */

type Lang = 'en' | 'mk' | 'sq';
const asLang = (l: string | null | undefined): Lang => (l === 'mk' || l === 'sq' ? l : 'en');

/** The customer of a visit, as the salon knows them, plus the account's
 *  language when they have one — read across contexts so a salon-side
 *  action can still speak the customer's language. */
export interface CustomerCtx {
  name: string;
  email: string | null;
  clientUserId: string | null;
  lang: Lang;
}
export async function customerOf(trx: Trx, first: Leg): Promise<CustomerCtx> {
  const cust = first.customerId
    ? await trx.selectFrom('customers').select(['name', 'email']).where('id', '=', first.customerId).executeTakeFirst()
    : undefined;
  let lang: Lang = 'en';
  let email = cust?.email ?? null;
  if (first.clientUserId) {
    // The account row lives outside the tenant's world: one read under
    // the platform context, in its own transaction.
    const u = await withHq((t) =>
      t.selectFrom('clientUsers').select(['lang', 'email']).where('id', '=', first.clientUserId!).executeTakeFirst(),
    );
    lang = asLang(u?.lang);
    email = email ?? u?.email ?? null;
  }
  return { name: cust?.name ?? first.title, email, clientUserId: first.clientUserId, lang };
}

async function salonOf(trx: Trx, tenantId: string) {
  const b = await trx.selectFrom('businesses').select(['name', 'slug', 'ownerEmployeeId']).where('id', '=', tenantId).executeTakeFirstOrThrow();
  const owner = b.ownerEmployeeId
    ? await trx.selectFrom('employees').select('email').where('id', '=', b.ownerEmployeeId).executeTakeFirst()
    : undefined;
  return { name: b.name, slug: b.slug, ownerEmail: owner?.email ?? null };
}

async function serviceNamesOf(trx: Trx, legs: Leg[]): Promise<string> {
  const ids = legs.map((l) => l.serviceId).filter((x): x is string => Boolean(x));
  if (!ids.length) return legs[0]?.title ?? '';
  const rows = await trx.selectFrom('services').select(['id', 'name']).where('id', 'in', ids).execute();
  return legs.map((l) => rows.find((r) => r.id === l.serviceId)?.name ?? l.title).join(' + ');
}

/** "Fri 2 Oct · 15:00", in the customer's language. */
function whenLbl(date: string, min: number, lang: Lang): string {
  const locale = lang === 'mk' ? 'mk-MK' : lang === 'sq' ? 'sq-AL' : 'en-GB';
  const d = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  return `${d} · ${hhmm(min)}`;
}

const consumerLink = (appointmentId: string) => `${env.consumerAppUrl}/account/appointments/${appointmentId}`;
const workspaceLink = (appointmentId: string) => `${env.workspaceAppUrl}/calendar?appointment=${appointmentId}`;

/* ── History ────────────────────────────────────────────────────────── */

async function history(trx: Trx, leg: Leg, what: string, byName: string, source: string, meta: Record<string, unknown> = {}) {
  await trx
    .insertInto('appointmentHistory')
    .values({ tenantId: leg.tenantId, appointmentId: leg.id, what, byName, source, meta: JSON.stringify(meta) })
    .execute();
}

/** The visit's timeline: its first leg's lines (where the visit-level
 *  events are written) plus the leg's own, oldest first. */
export async function visitHistory(trx: Trx, appointmentId: string) {
  const legs = await visitLegs(trx, appointmentId);
  const ids = [...new Set([legs[0]!.id, appointmentId])];
  const rows = await trx
    .selectFrom('appointmentHistory')
    .select(['at', 'what', 'byName', 'source', 'meta'])
    .where('appointmentId', 'in', ids)
    .orderBy('at')
    .execute();
  return rows.map((r) => ({
    at: r.at.toISOString(),
    what: r.what,
    byName: r.byName,
    source: r.source,
    meta: (r.meta ?? {}) as Record<string, unknown>,
  }));
}

/* ── Change requests ────────────────────────────────────────────────── */

type RequestRow = {
  id: string;
  appointmentId: string;
  status: string;
  originalDate: Date;
  originalStartMin: number;
  originalDurationMin: number;
  requestedDate: Date;
  requestedStartMin: number;
  requestedAt: Date;
  resolvedAt: Date | null;
  resolvedByEmployeeId: string | null;
  declineReason: string | null;
  customerDecision: string | null;
  decidedAt: Date | null;
};

async function toContractRequest(trx: Trx, r: RequestRow): Promise<ChangeRequest> {
  const by = r.resolvedByEmployeeId
    ? await trx.selectFrom('employees').select('name').where('id', '=', r.resolvedByEmployeeId).executeTakeFirst()
    : undefined;
  return {
    id: r.id,
    appointmentId: r.appointmentId,
    status: r.status as ChangeRequest['status'],
    originalDate: localIso(r.originalDate),
    originalTime: hhmm(r.originalStartMin),
    originalEnd: hhmm(r.originalStartMin + r.originalDurationMin),
    requestedDate: localIso(r.requestedDate),
    requestedTime: hhmm(r.requestedStartMin),
    requestedEnd: hhmm(r.requestedStartMin + r.originalDurationMin),
    requestedAt: r.requestedAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    resolvedByName: by?.name ?? null,
    declineReason: r.declineReason,
    customerDecision: (r.customerDecision as 'keep' | 'cancel' | null) ?? null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
  };
}

/** The active request (pending, or declined and unanswered), else the
 *  latest one, else null — what the customer's screen shows. */
export async function requestOf(trx: Trx, anchorId: string): Promise<ChangeRequest | null> {
  const r = await trx
    .selectFrom('bookingChangeRequests')
    .selectAll()
    .where('appointmentId', '=', anchorId)
    .orderBy(sql`case when status in ('pending','declined') then 0 else 1 end`)
    .orderBy('requestedAt', 'desc')
    .executeTakeFirst();
  return r ? toContractRequest(trx, r) : null;
}

async function activeRequest(trx: Trx, anchorId: string, lock = false) {
  let q = trx
    .selectFrom('bookingChangeRequests')
    .selectAll()
    .where('appointmentId', '=', anchorId)
    .where('status', 'in', ['pending', 'declined']);
  if (lock) q = q.forUpdate();
  return q.executeTakeFirst();
}

/** The whole visit's span (treatment + prep + reset per leg) from its
 *  frozen timings, so a new start is checked exactly as it was booked. */
function geometry(legs: Leg[]) {
  return legs.map((l) => ({ treatmentMin: l.durationMin, prepMin: l.prepMin, resetMin: l.resetMin }));
}

/** Every leg at its new start, through the one gate, ignoring the visit
 *  itself. The first refusal is returned as-is — it says why. */
async function checkVisitAt(trx: Trx, legs: Leg[], date: string, startMin: number): Promise<Refusal | null> {
  const starts = legStarts(startMin, geometry(legs));
  const ids = legs.map((l) => l.id);
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]!;
    const refusal = await bookingCheck(trx, {
      locationId: leg.locationId,
      date,
      start: hhmm(starts[i]!),
      dur: leg.durationMin,
      emp: leg.employeeId ?? 'any',
      sid: leg.serviceId,
      ignoreIds: ids,
      prepMin: leg.prepMin,
      resetMin: leg.resetMin,
    });
    if (refusal) return refusal;
  }
  return null;
}

/**
 * The customer asks for a new time. Refused when the visit is
 * cancelled, has started, is still a booking request, already has an
 * active change request, names its own time, a time that has passed,
 * or a time the calendar cannot keep (the gate's own reason). The
 * original stays exactly as it was.
 */
export async function requestReschedule(
  trx: Trx,
  q: { appointmentId: string; client: { id: string; name: string }; date: string; time: string; now?: Date },
): Promise<ChangeRequest> {
  const now = q.now ?? new Date();
  const legs = await visitLegs(trx, q.appointmentId, true);
  const first = legs[0]!;
  if (legs.some((l) => l.status === 'cancelled'))
    throw new BookingRefused(refuse('ALREADY_CANCELLED', {}, 'This appointment was cancelled'));
  if (first.status !== 'booked' && first.status !== 'confirmed')
    throw new BookingRefused(refuse('NOT_CHANGEABLE', {}, 'This appointment cannot be moved yet'));
  const tz = await tzOf(trx, first.locationId);
  if (now.getTime() >= instantAt(tz, first.date, first.startMin).getTime())
    throw new BookingRefused(refuse('VISIT_STARTED', {}, 'This appointment has already started'));
  if (await activeRequest(trx, first.id))
    throw new BookingRefused(refuse('REQUEST_ACTIVE', {}, 'A reschedule request is already waiting for the salon'));
  const startMin = mins(q.time);
  if (q.date === first.date && startMin === first.startMin)
    throw new BookingRefused(refuse('SAME_TIME', {}, 'That is the time you already have'));
  if (instantAt(tz, q.date, startMin).getTime() <= now.getTime())
    throw new BookingRefused(refuse('TIME_PASSED', {}, 'That time has already passed'));
  const refusal = await checkVisitAt(trx, legs, q.date, startMin);
  if (refusal) throw new BookingRefused(refusal);

  const row = await trx
    .insertInto('bookingChangeRequests')
    .values({
      tenantId: first.tenantId,
      appointmentId: first.id,
      originalDate: new Date(first.date),
      originalStartMin: first.startMin,
      originalDurationMin: legs[legs.length - 1]!.startMin + legs[legs.length - 1]!.durationMin - first.startMin,
      originalEmployeeId: first.employeeId,
      requestedDate: new Date(q.date),
      requestedStartMin: startMin,
      requestedEmployeeId: first.employeeId,
      requestedByClientUserId: q.client.id,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const from = `${first.date} ${hhmm(first.startMin)}`;
  const to = `${q.date} ${q.time}`;
  await history(trx, first, 'Reschedule requested', q.client.name, 'client', { from, to, requestId: row.id });
  await logAudit(trx, first.tenantId, {
    actorEmployeeId: null,
    actorName: q.client.name,
    action: 'Reschedule requested',
    object: first.title,
    before: from,
    after: to,
    source: 'client',
  });

  const salon = await salonOf(trx, first.tenantId);
  const what = await serviceNamesOf(trx, legs);
  const loc = await trx.selectFrom('locations').select('name').where('id', '=', first.locationId).executeTakeFirst();
  await notifySalon(trx, first.tenantId, {
    kind: 'booking_change',
    title: 'Reschedule request',
    body: `${q.client.name} asked to move ${what} from ${from} to ${to}. Approve or decline it in the calendar.`,
    refId: first.id,
  });
  if (salon.ownerEmail)
    await queueMail(trx, {
      tenantId: first.tenantId,
      to: salon.ownerEmail,
      subject: `Reschedule request — ${q.client.name}`,
      body: `${q.client.name} asked for a new time for ${what} at ${loc?.name ?? salon.name}.\n\nCurrent: ${from}\nRequested: ${to}\n\nThe current appointment stays booked until you approve. Open the calendar to review the request.`,
      kind: 'reschedule_requested',
      refId: first.id,
      cta: { label: 'Review request', url: workspaceLink(first.id) },
    });
  return toContractRequest(trx, row);
}

/** The customer takes a pending request back; nothing ever moved. */
export async function withdrawReschedule(trx: Trx, q: { appointmentId: string; client: { id: string; name: string } }): Promise<ChangeRequest> {
  const legs = await visitLegs(trx, q.appointmentId, true);
  const first = legs[0]!;
  const row = await trx
    .updateTable('bookingChangeRequests')
    .set({ status: 'withdrawn', resolvedAt: new Date() })
    .where('appointmentId', '=', first.id)
    .where('status', '=', 'pending')
    .returningAll()
    .executeTakeFirst();
  if (!row) throw new BookingRefused(refuse('NO_REQUEST', {}, 'There is no request waiting for the salon'));
  await history(trx, first, 'Reschedule request withdrawn', q.client.name, 'client', { requestId: row.id });
  await notifySalon(trx, first.tenantId, {
    kind: 'booking_change',
    title: 'Reschedule request withdrawn',
    body: `${q.client.name} withdrew their request to move ${first.title}'s appointment on ${first.date} at ${hhmm(first.startMin)}. Nothing changes.`,
    refId: first.id,
  });
  return toContractRequest(trx, row);
}

export interface Decided {
  request: ChangeRequest;
  notice: ClientNotice | null;
  clientUserId: string | null;
}

/**
 * The salon approves: the request must still be pending, the visit
 * still live, and the requested slot still free — re-checked through
 * the gate now, with the visit's own legs out of the way. Then every
 * leg moves, the identity stays, and the customer hears.
 */
export async function approveReschedule(trx: Trx, claims: AccessClaims, requestId: string): Promise<Decided> {
  const req = await trx.selectFrom('bookingChangeRequests').selectAll().where('id', '=', requestId).forUpdate().executeTakeFirst();
  if (!req) throw new BookingError('NOT_FOUND', 'Unknown request');
  if (req.status !== 'pending') throw new BookingRefused(refuse('NO_REQUEST', {}, 'This request has already been answered'));
  const legs = await visitLegs(trx, req.appointmentId, true);
  const first = legs[0]!;
  if (legs.some((l) => l.status === 'cancelled'))
    throw new BookingRefused(refuse('ALREADY_CANCELLED', {}, 'This appointment was cancelled'));
  const date = localIso(req.requestedDate);
  const refusal = await checkVisitAt(trx, legs, date, req.requestedStartMin);
  if (refusal)
    throw new BookingRefused(
      refuse('SLOT_TAKEN', { time: hhmm(req.requestedStartMin), date, why: refusal.message }, `This time is no longer available — ${refusal.message}`),
    );
  const starts = legStarts(req.requestedStartMin, geometry(legs));
  for (let i = 0; i < legs.length; i++)
    await trx
      .updateTable('appointments')
      .set({ date: new Date(date), startMin: starts[i]! })
      .where('id', '=', legs[i]!.id)
      .execute();
  const actor = await trx.selectFrom('employees').select('name').where('id', '=', claims.sub).executeTakeFirst();
  const row = await trx
    .updateTable('bookingChangeRequests')
    .set({ status: 'approved', resolvedAt: new Date(), resolvedByEmployeeId: claims.sub })
    .where('id', '=', requestId)
    .returningAll()
    .executeTakeFirstOrThrow();
  const from = `${first.date} ${hhmm(first.startMin)}`;
  const to = `${date} ${hhmm(req.requestedStartMin)}`;
  await history(trx, first, 'Reschedule approved', actor?.name ?? '', 'staff', { from, to, requestId });
  await logAudit(trx, first.tenantId, {
    actorEmployeeId: claims.sub,
    actorName: actor?.name ?? '',
    action: 'Reschedule approved',
    object: first.title,
    before: from,
    after: to,
  });

  const customer = await customerOf(trx, first);
  const salon = await salonOf(trx, first.tenantId);
  const what = await serviceNamesOf(trx, legs);
  const t = createI18n(customer.lang).t;
  const when = whenLbl(date, req.requestedStartMin, customer.lang);
  if (customer.email)
    await queueMail(trx, {
      tenantId: first.tenantId,
      to: customer.email,
      subject: t('bc.approvedMailSubject', { salon: salon.name }),
      body: t('bc.approvedMailBody', { name: customer.name, salon: salon.name, service: what, when }),
      kind: 'reschedule_approved',
      refId: first.id,
      cta: { label: t('bc.mailCta'), url: consumerLink(first.id) },
    });
  return {
    request: await toContractRequest(trx, row),
    clientUserId: customer.clientUserId,
    notice: customer.clientUserId
      ? { kind: 'appointment', title: t('bc.approvedTitle'), body: t('bc.approvedBody', { salon: salon.name, when }), refType: 'appointment', refId: first.id }
      : null,
  };
}

/** The salon declines: the original stays booked, the request waits
 *  for the customer's answer, and they are asked for it. */
export async function declineReschedule(trx: Trx, claims: AccessClaims, requestId: string, reason?: string): Promise<Decided> {
  const req = await trx.selectFrom('bookingChangeRequests').selectAll().where('id', '=', requestId).forUpdate().executeTakeFirst();
  if (!req) throw new BookingError('NOT_FOUND', 'Unknown request');
  if (req.status !== 'pending') throw new BookingRefused(refuse('NO_REQUEST', {}, 'This request has already been answered'));
  const legs = await visitLegs(trx, req.appointmentId, true);
  const first = legs[0]!;
  const actor = await trx.selectFrom('employees').select('name').where('id', '=', claims.sub).executeTakeFirst();
  const row = await trx
    .updateTable('bookingChangeRequests')
    .set({ status: 'declined', resolvedAt: new Date(), resolvedByEmployeeId: claims.sub, declineReason: reason?.trim() || null })
    .where('id', '=', requestId)
    .returningAll()
    .executeTakeFirstOrThrow();
  const asked = `${localIso(req.requestedDate)} ${hhmm(req.requestedStartMin)}`;
  await history(trx, first, 'Reschedule declined', actor?.name ?? '', 'staff', { requested: asked, reason: reason ?? null, requestId });
  await logAudit(trx, first.tenantId, {
    actorEmployeeId: claims.sub,
    actorName: actor?.name ?? '',
    action: 'Reschedule declined',
    object: first.title,
    before: asked,
    after: `${first.date} ${hhmm(first.startMin)} (kept)`,
    reason,
  });

  const customer = await customerOf(trx, first);
  const salon = await salonOf(trx, first.tenantId);
  const what = await serviceNamesOf(trx, legs);
  const t = createI18n(customer.lang).t;
  const when = whenLbl(first.date, first.startMin, customer.lang);
  const note = reason?.trim() ? `\n\n${t('bc.theirNote', { reason: reason.trim() })}` : '';
  if (customer.email)
    await queueMail(trx, {
      tenantId: first.tenantId,
      to: customer.email,
      subject: t('bc.declinedMailSubject', { salon: salon.name }),
      body: t('bc.declinedMailBody', { name: customer.name, salon: salon.name, service: what, when }) + note,
      kind: 'reschedule_declined',
      refId: first.id,
      cta: { label: t('bc.declinedMailCta'), url: consumerLink(first.id) },
    });
  return {
    request: await toContractRequest(trx, row),
    clientUserId: customer.clientUserId,
    notice: customer.clientUserId
      ? { kind: 'appointment', title: t('bc.declinedTitle'), body: t('bc.declinedBody', { when }), refType: 'appointment', refId: first.id }
      : null,
  };
}

/** After a decline, the customer keeps the original. Recorded, and the
 *  salon is told they are still coming. */
export async function keepOriginal(trx: Trx, q: { appointmentId: string; client: { id: string; name: string } }): Promise<ChangeRequest> {
  const legs = await visitLegs(trx, q.appointmentId, true);
  const first = legs[0]!;
  const row = await trx
    .updateTable('bookingChangeRequests')
    .set({ status: 'resolved', customerDecision: 'keep', decidedAt: new Date() })
    .where('appointmentId', '=', first.id)
    .where('status', '=', 'declined')
    .returningAll()
    .executeTakeFirst();
  if (!row) throw new BookingRefused(refuse('NO_REQUEST', {}, 'There is no declined request to answer'));
  const when = `${first.date} ${hhmm(first.startMin)}`;
  await history(trx, first, 'Original appointment kept', q.client.name, 'client', { when, requestId: row.id });
  await logAudit(trx, first.tenantId, {
    actorEmployeeId: null,
    actorName: q.client.name,
    action: 'Original appointment kept',
    object: first.title,
    after: when,
    source: 'client',
  });
  const salon = await salonOf(trx, first.tenantId);
  const what = await serviceNamesOf(trx, legs);
  await notifySalon(trx, first.tenantId, {
    kind: 'booking_change',
    title: 'Customer is keeping the original appointment',
    body: `${q.client.name} will attend ${what} as originally scheduled: ${when}.`,
    refId: first.id,
  });
  if (salon.ownerEmail)
    await queueMail(trx, {
      tenantId: first.tenantId,
      to: salon.ownerEmail,
      subject: `${q.client.name} is keeping the original appointment`,
      body: `${q.client.name} will attend ${what} as originally scheduled: ${when}.\n\nNothing changes on the calendar.`,
      kind: 'reschedule_kept',
      refId: first.id,
      cta: { label: 'Open the calendar', url: workspaceLink(first.id) },
    });
  return toContractRequest(trx, row);
}

/* ── Cancellation ───────────────────────────────────────────────────── */

export interface CancelResult {
  legs: Leg[];
  notice: ClientNotice | null;
  clientUserId: string | null;
  /** Refund intents created — processed after commit, never inside. */
  refundIds: string[];
}

/**
 * The one cancellation door. A customer's cancellation is checked
 * against the window (the visit's own snapshot, in the location's
 * zone) — the salon's is not, since the policy is the salon's promise
 * to the customer. Every leg is cancelled, an answered-or-unanswered
 * request is resolved as "cancel", the facts land on the rows, a
 * prepaid visit gets its refund intent, each freed slot is offered to
 * Premium, and both sides hear — all in the caller's transaction,
 * except the client's own bell (returned) and the provider call (by id).
 */
export async function cancelVisit(
  trx: Trx,
  q: {
    appointmentId: string;
    by: CancelledBy;
    actor: { employeeId?: string | null; name: string; clientUserId?: string | null };
    reason?: string | null | undefined;
    now?: Date;
  },
): Promise<CancelResult> {
  const now = q.now ?? new Date();
  const legs = await visitLegs(trx, q.appointmentId, true);
  const first = legs[0]!;
  const live = legs.filter((l) => l.status !== 'cancelled');
  if (!live.length) throw new BookingRefused(refuse('ALREADY_CANCELLED', {}, 'Already cancelled'));
  const tz = await tzOf(trx, first.locationId);
  if (q.by === 'customer') {
    const w = cancelWindow(legs, tz, now);
    if (!w.allowed)
      throw new BookingRefused(
        refuse(
          'CANCEL_TOO_LATE',
          { hours: w.hours, deadline: w.deadline.toISOString() },
          w.hours
            ? `Cancellation is no longer available — this salon asks for ${w.hours} hours' notice`
            : 'Cancellation is no longer available — this appointment has started',
        ),
      );
  }

  const cancelledAt = new Date();
  for (const leg of live)
    await trx
      .updateTable('appointments')
      .set({ status: 'cancelled', cancelledAt, cancelledBy: q.by, cancelReason: q.reason?.trim() || null })
      .where('id', '=', leg.id)
      .where('status', '!=', 'cancelled')
      .execute();
  // A request in flight is answered by the cancellation itself.
  const req = await trx
    .updateTable('bookingChangeRequests')
    .set({ status: 'resolved', customerDecision: q.by === 'customer' ? 'cancel' : null, decidedAt: cancelledAt, resolvedAt: cancelledAt })
    .where('appointmentId', '=', first.id)
    .where('status', 'in', ['pending', 'declined'])
    .returning('id')
    .executeTakeFirst();
  const source = q.by === 'customer' ? 'client' : q.by === 'salon' ? 'staff' : q.by;
  const when = `${first.date} ${hhmm(first.startMin)}`;
  await history(trx, first, 'Cancelled', q.actor.name, source, { by: q.by, reason: q.reason ?? null, when, requestId: req?.id ?? null });
  for (const leg of live.slice(1)) await history(trx, leg, 'Cancelled', q.actor.name, source, { by: q.by, with: first.id });
  await logAudit(trx, first.tenantId, {
    actorEmployeeId: q.actor.employeeId ?? null,
    actorName: q.actor.name,
    action: 'Appointment cancelled',
    object: first.title,
    before: first.status,
    after: 'cancelled',
    reason: q.reason ?? undefined,
    source,
  });

  // Money: the intent only; the provider is called after commit.
  const refundIds = await createRefundIntent(trx, legs, q.actor.name);
  // The freed time, offered where the platform already offers openings.
  for (const leg of live) await releaseSlotToPremium(trx, leg, now);

  const customer = await customerOf(trx, first);
  const salon = await salonOf(trx, first.tenantId);
  const what = await serviceNamesOf(trx, legs);
  const t = createI18n(customer.lang).t;
  const whenL = whenLbl(first.date, first.startMin, customer.lang);
  const refundLine = refundIds.length ? `\n\n${t('bc.refundPendingLine')}` : '';
  if (q.by === 'customer') {
    await notifySalon(trx, first.tenantId, {
      kind: 'booking_cancelled',
      title: 'Appointment cancelled',
      body: `${q.actor.name} cancelled ${what} on ${when}. The slot is now available.`,
      refId: first.id,
    });
    if (salon.ownerEmail)
      await queueMail(trx, {
        tenantId: first.tenantId,
        to: salon.ownerEmail,
        subject: `Appointment cancelled — ${q.actor.name}`,
        body: `${q.actor.name} cancelled ${what} on ${when}.\n\nThe slot is now available.${refundIds.length ? '\n\nThe visit was paid online; the refund is being processed.' : ''}`,
        kind: 'booking_cancelled',
        refId: first.id,
        cta: { label: 'View calendar', url: workspaceLink(first.id) },
      });
  }
  if (customer.email)
    await queueMail(trx, {
      tenantId: first.tenantId,
      to: customer.email,
      subject: t('bc.cancelledMailSubject', { salon: salon.name }),
      body:
        (q.by === 'customer'
          ? t('bc.cancelledMailBody', { name: customer.name, service: what, salon: salon.name, when: whenL })
          : t('bc.cancelledBySalonMailBody', { name: customer.name, service: what, salon: salon.name, when: whenL })) + refundLine,
      kind: q.by === 'customer' ? 'booking_cancelled_customer' : 'booking_cancelled_salon',
      refId: first.id,
      cta: { label: t('bc.mailCta'), url: consumerLink(first.id) },
    });
  return {
    legs,
    refundIds,
    clientUserId: customer.clientUserId,
    notice: customer.clientUserId
      ? {
          kind: 'appointment',
          title: t('bc.cancelledTitle'),
          body:
            (q.by === 'customer'
              ? t('bc.cancelledBody', { service: what, salon: salon.name, when: whenL })
              : t('bc.cancelledBySalonBody', { service: what, salon: salon.name, when: whenL })) + (refundIds.length ? ` ${t('bc.refundPendingLine')}` : ''),
          refType: 'appointment',
          refId: first.id,
        }
      : null,
  };
}

/* ── Money, as the customer and the salon see it ────────────────────── */

export async function paymentOf(trx: Trx, legs: Leg[]): Promise<PaymentSummary> {
  const ids = legs.map((l) => l.id);
  const inv = await trx
    .selectFrom('invoiceLines as l')
    .innerJoin('invoices as i', 'i.id', 'l.invoiceId')
    .select(['i.method', 'i.total', 'i.status'])
    .where('l.appointmentId', 'in', ids)
    .orderBy('i.createdAt', 'desc')
    .executeTakeFirst();
  if (inv && inv.status !== 'Refunded') return { status: 'paid', method: inv.method, amount: inv.total };
  const venue = await trx
    .selectFrom('appointmentHistory')
    .select('id')
    .where('appointmentId', 'in', ids)
    .where('what', '=', 'Will pay at the venue')
    .limit(1)
    .executeTakeFirst();
  return { status: venue ? 'venue' : 'unpaid', method: null, amount: null };
}

export async function refundOf(trx: Trx, legs: Leg[]): Promise<RefundSummary | null> {
  const r = await trx
    .selectFrom('refunds')
    .select(['status', 'amount', 'requestedAt', 'completedAt'])
    .where('appointmentId', 'in', legs.map((l) => l.id))
    .orderBy('requestedAt', 'desc')
    .executeTakeFirst();
  return r
    ? { status: r.status as RefundSummary['status'], amount: r.amount, requestedAt: r.requestedAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null }
    : null;
}
