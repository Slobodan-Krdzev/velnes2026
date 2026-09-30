import { createI18n } from '@velnes/i18n';
import {
  round1,
  salonOverall,
  type PublicReviewSummary,
  type RatingSummary,
  type ReviewSubmit,
  type WorkspaceReviewsQuery,
} from '@velnes/contracts';
import { sql } from 'kysely';
import { db, withClient, withHq, withTenant, type Trx } from '../../db/index.js';
import { env } from '../../env.js';
import { queueMail } from '../mail/mail.service.js';
import { nowAt } from '../scheduling/scheduling.service.js';
import { notifySalon } from '../clients/clients.service.js';

/**
 * Verified reviews (Alex, 2026-09-30) — docs/REVIEWS.md.
 *
 * One review per completed appointment, by the client who booked it.
 * "Completed" is the platform's own definition: a real appointment,
 * booked or confirmed, whose end has passed in the salon's clock. The
 * appointment is the authority for everything the review points at —
 * salon, location, service, professional, date — and the review
 * snapshots those ids at submission, so nothing the salon edits later
 * moves it.
 *
 * Aggregates are computed from the reviews (never stored), one grouped
 * query per request across the salons a page shows, behind a short
 * in-process cache; `resetRatingsCache()` after a write. The salon's
 * score is service+timing+cleanliness; the professional's is theirs.
 */

export class ReviewError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'NOT_COMPLETED' | 'ALREADY_REVIEWED' | 'NOT_REVIEWABLE',
    message: string,
  ) {
    super(message);
  }
}

type ApptRow = { kind: string; status: string; date: unknown; startMin: number; durationMin: number };

/** The platform's one definition of "finished", in the location's clock. */
export function isCompleted(a: ApptRow, tz: string, now = new Date()): boolean {
  if (a.kind !== 'appointment') return false;
  if (a.status !== 'booked' && a.status !== 'confirmed') return false;
  const local = nowAt(tz, now);
  const day = a.date instanceof Date ? a.date.toISOString().slice(0, 10) : String(a.date).slice(0, 10);
  if (day < local.date) return true;
  if (day > local.date) return false;
  return a.startMin + a.durationMin <= local.min;
}

/** A client's own transaction that can also ring the salon's bell:
 *  both contexts set, so the review row is written as the client and
 *  the notice as the salon, in one commit. */
async function withClientAtTenant<T>(clientUserId: string, tenantId: string, fn: (trx: Trx) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.client_id', ${clientUserId}, true)`.execute(trx);
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
    return fn(trx);
  });
}

const cleanBody = (b: string | undefined | null): string | null => {
  const t = (b ?? '').trim();
  return t.length ? t : null;
};

export async function submitReview(clientUserId: string, appointmentId: string, input: ReviewSubmit, now = new Date()) {
  // Whose is it? The client's own context sees only their rows.
  const a = await withClient(clientUserId, (trx) =>
    trx
      .selectFrom('appointments')
      .select(['id', 'tenantId', 'locationId', 'serviceId', 'employeeId', 'customerId', 'kind', 'status', 'date', 'startMin', 'durationMin'])
      .where('id', '=', appointmentId)
      .where('clientUserId', '=', clientUserId)
      .executeTakeFirst(),
  );
  if (!a) throw new ReviewError('NOT_FOUND', 'Unknown appointment');
  const body = cleanBody(input.body);
  const review = await withClientAtTenant(clientUserId, a.tenantId, async (trx) => {
    const loc = await trx.selectFrom('locations').select(['tz', 'name']).where('id', '=', a.locationId).executeTakeFirst();
    if (!isCompleted(a, loc?.tz ?? 'Europe/Skopje', now)) throw new ReviewError('NOT_COMPLETED', 'Only a completed appointment can be reviewed');
    let row;
    try {
      row = await trx
        .insertInto('reviews')
        .values({
          tenantId: a.tenantId,
          locationId: a.locationId,
          appointmentId: a.id,
          clientUserId,
          customerId: a.customerId,
          serviceId: a.serviceId,
          employeeId: a.employeeId,
          serviceRating: input.service,
          timingRating: input.timing,
          cleanlinessRating: input.cleanliness,
          professionalRating: input.professional,
          body,
          appointmentDate: sql`${String(a.date instanceof Date ? a.date.toISOString().slice(0, 10) : a.date).slice(0, 10)}::date`,
        })
        .returning(['id', 'createdAt'])
        .executeTakeFirstOrThrow();
    } catch (e) {
      // The UNIQUE on appointment_id: a second tab, a retry, a double
      // click — one review, whoever got there first.
      if ((e as { code?: string }).code === '23505') throw new ReviewError('ALREADY_REVIEWED', 'This appointment already has a review');
      throw e;
    }
    const svc = a.serviceId
      ? await trx.selectFrom('services').select('name').where('id', '=', a.serviceId).executeTakeFirst()
      : null;
    // The salon hears about it — no score in the bell, that is for the
    // screen it opens (Alex, 2026-09-30).
    await notifySalon(trx, a.tenantId, {
      kind: 'review',
      title: 'New review',
      body: `A customer reviewed their ${svc?.name ?? 'appointment'}${loc ? ` at ${loc.name}` : ''}.`,
      refId: row.id,
    });
    return row;
  });
  resetRatingsCache();
  return {
    id: review.id,
    service: input.service,
    timing: input.timing,
    cleanliness: input.cleanliness,
    professional: input.professional,
    body,
    at: review.createdAt.toISOString(),
  };
}

/** The client's own reviews for a set of their appointments. */
export async function reviewsOfAppointments(clientUserId: string, appointmentIds: string[]) {
  const out = new Map<string, { id: string; service: number; timing: number; cleanliness: number; professional: number; body: string | null; at: string }>();
  if (!appointmentIds.length) return out;
  const rows = await withClient(clientUserId, (trx) =>
    trx
      .selectFrom('reviews')
      .select(['id', 'appointmentId', 'serviceRating', 'timingRating', 'cleanlinessRating', 'professionalRating', 'body', 'createdAt'])
      .where('clientUserId', '=', clientUserId)
      .where('appointmentId', 'in', appointmentIds)
      .execute(),
  );
  for (const r of rows)
    out.set(r.appointmentId, {
      id: r.id,
      service: r.serviceRating,
      timing: r.timingRating,
      cleanliness: r.cleanlinessRating,
      professional: r.professionalRating,
      body: r.body,
      at: r.createdAt.toISOString(),
    });
  return out;
}

// ── aggregates ──────────────────────────────────────────────────────

const RATINGS_TTL_MS = 60_000;
let ratingsCache: { at: number; value: Map<string, RatingSummary> } | null = null;
export function resetRatingsCache() {
  ratingsCache = null;
}

/** Every salon's score, from valid reviews, in one query — the map a
 *  results page reads once per request, whatever it shows. */
export async function ratingsForBusinesses(): Promise<Map<string, RatingSummary>> {
  if (ratingsCache && Date.now() - ratingsCache.at < RATINGS_TTL_MS) return ratingsCache.value;
  const rows = await db.transaction().execute(async (trx) => {
    await sql`select set_config('app.public', '1', true)`.execute(trx);
    return trx
      .selectFrom('reviews')
      .select(['tenantId'])
      .select(sql<string>`count(*)`.as('n'))
      .select(sql<string>`avg((service_rating + timing_rating + cleanliness_rating) / 3.0)`.as('avg'))
      .where('ratingStatus', '=', 'valid')
      .groupBy('tenantId')
      .execute();
  });
  const value = new Map(rows.map((r) => [r.tenantId, { avg: round1(Number(r.avg)), count: Number(r.n) }]));
  ratingsCache = { at: Date.now(), value };
  return value;
}

function summarise(rows: { s: number; t: number; c: number }[]): PublicReviewSummary | null {
  if (!rows.length) return null;
  const n = rows.length;
  const mean = (f: (r: { s: number; t: number; c: number }) => number) => round1(rows.reduce((a, r) => a + f(r), 0) / n);
  const distribution = [0, 0, 0, 0, 0];
  for (const r of rows) {
    const star = Math.min(5, Math.max(1, Math.round(salonOverall({ service: r.s, timing: r.t, cleanliness: r.c }))));
    distribution[star - 1] = (distribution[star - 1] ?? 0) + 1;
  }
  return {
    avg: mean((r) => salonOverall({ service: r.s, timing: r.t, cleanliness: r.c })),
    count: n,
    service: mean((r) => r.s),
    timing: mean((r) => r.t),
    cleanliness: mean((r) => r.c),
    distribution,
  };
}

/** The salon's summary, in whichever context can read its reviews. */
export async function reviewSummary(trx: Trx, tenantId: string): Promise<PublicReviewSummary | null> {
  const rows = await trx
    .selectFrom('reviews')
    .select(['serviceRating as s', 'timingRating as t', 'cleanlinessRating as c'])
    .where('tenantId', '=', tenantId)
    .where('ratingStatus', '=', 'valid')
    .execute();
  return summarise(rows);
}

/** Each professional's own score at this salon. */
export async function employeeRatings(trx: Trx, tenantId: string): Promise<Map<string, RatingSummary>> {
  const rows = await trx
    .selectFrom('reviews')
    .select(['employeeId'])
    .select(sql<string>`count(*)`.as('n'))
    .select(sql<string>`avg(professional_rating)`.as('avg'))
    .where('tenantId', '=', tenantId)
    .where('ratingStatus', '=', 'valid')
    .where('employeeId', 'is not', null)
    .groupBy('employeeId')
    .execute();
  return new Map(rows.filter((r) => r.employeeId).map((r) => [r.employeeId!, { avg: round1(Number(r.avg)), count: Number(r.n) }]));
}

/** The reviewer as the public sees them: first name, last initial. */
function displayName(first: string, last: string): string {
  const f = first.trim();
  const l = last.trim();
  return l ? `${f} ${l[0]!.toUpperCase()}.` : f;
}

/** A page of a salon's reviews for its public page: newest first,
 *  words only where published, the reviewer reduced to a first name. */
export async function publicReviews(tenantId: string, offset: number, limit: number) {
  const { rows, total } = await withTenant(tenantId, async (trx) => {
    const total = await trx
      .selectFrom('reviews')
      .select(sql<string>`count(*)`.as('n'))
      .where('tenantId', '=', tenantId)
      .where('ratingStatus', '=', 'valid')
      .executeTakeFirstOrThrow();
    const rows = await trx
      .selectFrom('reviews as r')
      .leftJoin('services as s', 's.id', 'r.serviceId')
      .leftJoin('employees as e', 'e.id', 'r.employeeId')
      .leftJoin('locations as l', 'l.id', 'r.locationId')
      .select([
        'r.id', 'r.clientUserId', 'r.serviceRating', 'r.timingRating', 'r.cleanlinessRating', 'r.professionalRating',
        'r.body', 'r.bodyStatus', 'r.appointmentDate', 'r.createdAt', 's.name as serviceName', 'e.name as employeeName', 'l.name as locationName',
      ])
      .where('r.tenantId', '=', tenantId)
      .where('r.ratingStatus', '=', 'valid')
      .orderBy('r.createdAt', 'desc')
      .offset(offset)
      .limit(limit)
      .execute();
    return { rows, total: Number(total.n) };
  });
  const clientIds = [...new Set(rows.map((r) => r.clientUserId))];
  const names = clientIds.length
    ? await withHq((trx) => trx.selectFrom('clientUsers').select(['id', 'first', 'last']).where('id', 'in', clientIds).execute())
    : [];
  const nameOf = new Map(names.map((c) => [c.id, displayName(c.first, c.last)]));
  return {
    total,
    offset,
    limit,
    reviews: rows.map((r) => ({
      id: r.id,
      overall: round1(salonOverall({ service: r.serviceRating, timing: r.timingRating, cleanliness: r.cleanlinessRating })),
      service: r.serviceRating,
      timing: r.timingRating,
      cleanliness: r.cleanlinessRating,
      professional: r.professionalRating,
      body: r.bodyStatus === 'published' ? r.body : null,
      reviewer: nameOf.get(r.clientUserId) ?? '',
      serviceName: r.serviceName ?? null,
      professionalName: r.employeeName ?? null,
      locationName: r.locationName ?? null,
      visitMonth: String(r.appointmentDate instanceof Date ? r.appointmentDate.toISOString() : r.appointmentDate).slice(0, 7),
      verified: true as const,
      at: r.createdAt.toISOString(),
    })),
  };
}

// ── the salon's own view ────────────────────────────────────────────

export async function tenantReviewSummary(trx: Trx, tenantId: string) {
  const base = await reviewSummary(trx, tenantId);
  const emp = await employeeRatings(trx, tenantId);
  const employees = emp.size
    ? await trx.selectFrom('employees').select(['id', 'name']).where('id', 'in', [...emp.keys()]).orderBy('name').execute()
    : [];
  const locRows = await trx
    .selectFrom('reviews')
    .select(['locationId'])
    .select(sql<string>`count(*)`.as('n'))
    .select(sql<string>`avg((service_rating + timing_rating + cleanliness_rating) / 3.0)`.as('avg'))
    .where('tenantId', '=', tenantId)
    .where('ratingStatus', '=', 'valid')
    .groupBy('locationId')
    .execute();
  const locNames = locRows.length
    ? await trx.selectFrom('locations').select(['id', 'name']).where('id', 'in', locRows.map((l) => l.locationId)).execute()
    : [];
  return {
    avg: base?.avg ?? 0,
    count: base?.count ?? 0,
    service: base?.service ?? 0,
    timing: base?.timing ?? 0,
    cleanliness: base?.cleanliness ?? 0,
    distribution: base?.distribution ?? [0, 0, 0, 0, 0],
    employees: employees.map((e) => ({ id: e.id, name: e.name, ...emp.get(e.id)! })),
    locations: locRows.map((l) => ({
      id: l.locationId,
      name: locNames.find((x) => x.id === l.locationId)?.name ?? '',
      avg: round1(Number(l.avg)),
      count: Number(l.n),
    })),
  };
}

export async function tenantReviews(trx: Trx, tenantId: string, q: WorkspaceReviewsQuery) {
  let base = trx
    .selectFrom('reviews as r')
    .where('r.tenantId', '=', tenantId);
  if (q.locationId) base = base.where('r.locationId', '=', q.locationId);
  if (q.employeeId) base = base.where('r.employeeId', '=', q.employeeId);
  if (q.stars) base = base.where(sql`round((service_rating + timing_rating + cleanliness_rating) / 3.0)`, '=', q.stars);
  const total = await base.select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow();
  const rows = await base
    .leftJoin('customers as c', 'c.id', 'r.customerId')
    .leftJoin('services as s', 's.id', 'r.serviceId')
    .leftJoin('employees as e', 'e.id', 'r.employeeId')
    .innerJoin('locations as l', 'l.id', 'r.locationId')
    .select([
      'r.id', 'r.appointmentId', 'r.serviceRating', 'r.timingRating', 'r.cleanlinessRating', 'r.professionalRating',
      'r.body', 'r.bodyStatus', 'r.ratingStatus', 'r.employeeId', 'r.locationId', 'r.appointmentDate', 'r.createdAt',
      'c.name as customerName', 's.name as serviceName', 'e.name as employeeName', 'l.name as locationName',
    ])
    .orderBy('r.createdAt', 'desc')
    .offset(q.offset)
    .limit(q.limit)
    .execute();
  return {
    total: Number(total.n),
    offset: q.offset,
    limit: q.limit,
    reviews: rows.map((r) => ({
      id: r.id,
      appointmentId: r.appointmentId,
      overall: round1(salonOverall({ service: r.serviceRating, timing: r.timingRating, cleanliness: r.cleanlinessRating })),
      service: r.serviceRating,
      timing: r.timingRating,
      cleanliness: r.cleanlinessRating,
      professional: r.professionalRating,
      body: r.body,
      bodyStatus: r.bodyStatus as 'published' | 'hidden',
      ratingStatus: r.ratingStatus as 'valid' | 'void',
      customerName: r.customerName ?? '',
      serviceName: r.serviceName ?? null,
      employeeId: r.employeeId,
      employeeName: r.employeeName ?? null,
      locationId: r.locationId,
      locationName: r.locationName,
      appointmentDate: String(r.appointmentDate instanceof Date ? r.appointmentDate.toISOString() : r.appointmentDate).slice(0, 10),
      at: r.createdAt.toISOString(),
    })),
  };
}

// ── the 24-hour reminder ────────────────────────────────────────────

export const REMINDER_AFTER_HOURS = 24;

/**
 * One polite "how was your visit?" per completed, unreviewed visit,
 * about a day after it ended — in the app and by mail, in the
 * client's language. Idempotent by construction: the insert into
 * review_reminders is the gate (its primary key), the review check is
 * inside the same statement, and the notice and the mail commit with
 * it. A chain of treatments on one day is one visit: the last leg is
 * reminded, the others are skipped because their day already was.
 * Nothing before the feature went live is ever reminded.
 */
export async function sendDueReviewReminders(now = new Date()): Promise<number> {
  const due = await withHq(async (trx) => {
    const r = await sql<{
      id: string; tenantId: string; clientUserId: string; salon: string; serviceName: string | null; email: string; lang: string; first: string;
    }>`
      SELECT DISTINCT ON (a.client_user_id, a.tenant_id, a.date)
        a.id, a.tenant_id AS "tenantId", a.client_user_id AS "clientUserId",
        b.name AS salon, s.name AS "serviceName", cu.email, cu.lang, cu.first
      FROM appointments a
      JOIN locations l ON l.id = a.location_id
      JOIN businesses b ON b.id = a.tenant_id
      JOIN client_users cu ON cu.id = a.client_user_id
      LEFT JOIN services s ON s.id = a.service_id
      WHERE a.client_user_id IS NOT NULL
        AND a.kind = 'appointment'
        AND a.status IN ('booked', 'confirmed')
        AND ((a.date::timestamp + make_interval(mins => a.start_min + a.duration_min)) AT TIME ZONE l.tz)
              <= ${now}::timestamptz - make_interval(hours => ${REMINDER_AFTER_HOURS})
        AND ((a.date::timestamp + make_interval(mins => a.start_min + a.duration_min)) AT TIME ZONE l.tz)
              >= (SELECT since FROM platform_features WHERE key = 'review_reminders')
        AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.appointment_id = a.id)
        AND NOT EXISTS (
          SELECT 1 FROM review_reminders rr JOIN appointments a2 ON a2.id = rr.appointment_id
          WHERE a2.client_user_id = a.client_user_id AND a2.tenant_id = a.tenant_id AND a2.date = a.date)
      ORDER BY a.client_user_id, a.tenant_id, a.date, (a.start_min + a.duration_min) DESC
      LIMIT 200
    `.execute(trx);
    return r.rows;
  });
  let sent = 0;
  for (const d of due) {
    const done = await withHq(async (trx) => {
      // The gate: one row per appointment, and only if no review landed
      // in the meantime — a worker that lost the race inserts nothing.
      const gate = await sql<{ appointment_id: string }>`
        INSERT INTO review_reminders (appointment_id, tenant_id, client_user_id)
        SELECT ${d.id}, ${d.tenantId}, ${d.clientUserId}
        WHERE NOT EXISTS (SELECT 1 FROM reviews r WHERE r.appointment_id = ${d.id})
        ON CONFLICT (appointment_id) DO NOTHING
        RETURNING appointment_id
      `.execute(trx);
      if (!gate.rows.length) return false;
      const t = createI18n((['en', 'mk', 'sq'] as const).includes(d.lang as 'en') ? (d.lang as 'en' | 'mk' | 'sq') : 'en').t;
      const link = `${env.consumerAppUrl}/account/appointments/${d.id}?review=1`;
      await trx
        .insertInto('clientNotifications')
        .values({
          clientUserId: d.clientUserId,
          kind: 'review',
          title: t('rv.reminderTitle'),
          body: t('rv.reminderBody', { salon: d.salon }),
          refType: 'appointment',
          refId: d.id,
        })
        .execute();
      await queueMail(trx, {
        tenantId: d.tenantId,
        to: d.email,
        kind: 'review_reminder',
        refId: d.id,
        subject: t('rv.mailSubject', { salon: d.salon }),
        body: t('rv.mailBody', { name: d.first, salon: d.salon, service: d.serviceName ?? '' }),
        cta: { label: t('rv.mailCta'), url: link },
      });
      return true;
    });
    if (done) sent += 1;
  }
  return sent;
}

let running: Promise<number> | null = null;
/** Never two scans at once in this process; a second call waits. */
export function runReviewReminders(now = new Date()): Promise<number> {
  const next = (running ?? Promise.resolve(0)).then(() => sendDueReviewReminders(now)).finally(() => {
    if (running === next) running = null;
  });
  running = next;
  return next;
}

/** In-process, like the mail loop: the API has no scheduler, and the
 *  gate above makes a second instance harmless. */
export function startReviewReminderLoop(everyMs = 5 * 60_000) {
  const tick = () => void runReviewReminders().catch(() => undefined);
  setTimeout(tick, 15_000).unref();
  setInterval(tick, everyMs).unref();
}
