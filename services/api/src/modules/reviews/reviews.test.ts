import { randomUUID } from 'node:crypto';
import { API_PREFIX, ClientAppointmentsSchema, DiscoverySalonDetailSchema, PublicReviewsPageSchema, WorkspaceReviewsPageSchema, WorkspaceReviewsSummarySchema } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, withTenant } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';
import { resetAdmittedCache } from '../../public/discovery.routes.js';
import { resetRatingsCache, sendDueReviewReminders } from './reviews.service.js';

/**
 * Verified reviews (Alex, 2026-09-30): one per completed appointment,
 * by whoever booked it; the numbers add up the way the docs say; the
 * reminder goes once, a day later, and never to the past; the salon
 * sees its own and only its own, and can change nothing.
 */
const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
const C = `${API_PREFIX}/client`;
const P = `${API_PREFIX}/public`;
const EMAIL = `review.tester.${Date.now()}@example.com`;
const OTHER = `review.other.${Date.now()}@example.com`;
const PASSWORD = 'velnes-test-12345';

async function codeFor(email: string): Promise<string> {
  const r = await admin.query(
    `SELECT body FROM mail_outbox WHERE to_email=$1 AND kind='client_email_verify' ORDER BY sent_at DESC LIMIT 1`,
    [email.toLowerCase()],
  );
  return (r.rows[0]?.body as string)?.match(/code is (\d{6})/)?.[1] ?? '';
}
async function signUp(email: string, first: string, last: string, lang = 'en') {
  await app.inject({ method: 'POST', url: `${C}/register`, payload: { email, password: PASSWORD, first, last, lang } });
  await app.inject({ method: 'POST', url: `${C}/verify-email`, payload: { email, code: await codeFor(email) } });
  const login = await app.inject({ method: 'POST', url: `${C}/login`, payload: { email, password: PASSWORD } });
  const id = (await admin.query(`SELECT id FROM client_users WHERE email=$1`, [email.toLowerCase()])).rows[0].id as string;
  return { token: login.json().token as string, id };
}
/** A visit written the way the seed writes one, ended `daysAgo` days
 *  ago at 10:45 in the salon's clock (10:00 + 45 min). */
async function visit(clientId: string, customerId: string, o: { daysAgo: number; status?: string; startMin?: number; employee?: string | null; service?: string }) {
  const id = randomUUID();
  await admin.query(
    `INSERT INTO appointments (id, tenant_id, location_id, date, start_min, duration_min, kind, status, title, service_id, employee_id, customer_id, price, source, client_user_id)
     VALUES ($1, $2, $3, ((now() AT TIME ZONE 'Europe/Skopje')::date - $8::int), $9, 45, 'appointment', $4, 'Review Tester', $5, $6, $7, 1800, 'client', $10)`,
    [id, demo.business, demo.locCentar, o.status ?? 'booked', o.service ?? demo.s1, o.employee === undefined ? demo.empMaria : o.employee, customerId, o.daysAgo, o.startMin ?? 600, clientId],
  );
  return id;
}
async function endsAt(id: string): Promise<Date> {
  const r = await admin.query(
    `SELECT ((a.date::timestamp + make_interval(mins => a.start_min + a.duration_min)) AT TIME ZONE l.tz) AS ends
     FROM appointments a JOIN locations l ON l.id = a.location_id WHERE a.id=$1`,
    [id],
  );
  return new Date(r.rows[0].ends as string);
}
const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000);
const good = { service: 5, timing: 4, cleanliness: 5, professional: 5 };

describe('verified reviews', () => {
  let me = { token: '', id: '' };
  let other = { token: '', id: '' };
  let customerId = '';
  let ownerToken = '';
  let staffToken = '';
  const made: string[] = [];

  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    // The seed reviews the demo consumer's past confirmed visits, and one
    // of those is pinned to this week's Wednesday — so from Thursday the
    // seed carries a review the salon-wide counts below would see. This
    // file pins its own precondition: the demo consumer has none.
    await admin.query(`DELETE FROM reviews WHERE client_user_id = (SELECT id FROM client_users WHERE email = 'katerina@velnes.mk')`);
    resetRatingsCache();
    me = await signUp(EMAIL, 'Ana', 'Dimitrova', 'mk');
    other = await signUp(OTHER, 'Petar', 'P');
    const cust = await admin.query(
      `INSERT INTO customers (tenant_id, name, email, phone, cust_group) VALUES ($1, 'Review Tester', $2, '+389 70 000 999', 'New') RETURNING id`,
      [demo.business, EMAIL],
    );
    customerId = cust.rows[0].id as string;
    await admin.query(`INSERT INTO client_customer_links (client_user_id, tenant_id, customer_id) VALUES ($1, $2, $3)`, [me.id, demo.business, customerId]);
    // Reminders went live "ten days ago" for this suite, so visits of
    // the last week are inside the window; put back afterwards.
    await admin.query(`UPDATE platform_features SET since = now() - interval '10 days' WHERE key='review_reminders'`);
    ownerToken = (await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email: 'maria@velnes.mk', password: 'velnes-demo' } })).json().accessToken as string;
    staffToken = (await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email: 'ana@velnes.mk', password: 'velnes-demo' } })).json().accessToken as string;
    resetAdmittedCache();
  });
  afterAll(async () => {
    await admin.query(`UPDATE platform_features SET since = now() WHERE key='review_reminders'`);
    await admin.query(`DELETE FROM review_reminders WHERE client_user_id IN ($1, $2)`, [me.id, other.id]);
    await admin.query(`DELETE FROM reviews WHERE client_user_id IN ($1, $2)`, [me.id, other.id]);
    await admin.query(`DELETE FROM client_notifications WHERE client_user_id IN ($1, $2)`, [me.id, other.id]);
    await admin.query(`DELETE FROM appointment_history WHERE appointment_id = ANY($1)`, [made]);
    await admin.query(`DELETE FROM appointments WHERE client_user_id IN ($1, $2)`, [me.id, other.id]);
    await admin.query(`DELETE FROM client_customer_links WHERE client_user_id IN ($1, $2)`, [me.id, other.id]);
    await admin.query(`DELETE FROM customers WHERE id=$1`, [customerId]);
    await admin.query(`DELETE FROM mail_outbox WHERE to_email IN ($1, $2)`, [EMAIL.toLowerCase(), OTHER.toLowerCase()]);
    await admin.query(`DELETE FROM platform_notices WHERE kind='review'`);
    await admin.query(`DELETE FROM client_users WHERE email IN ($1, $2)`, [EMAIL, OTHER]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  const submit = (id: string, payload: Record<string, unknown>, token = me.token) =>
    app.inject({ method: 'POST', url: `${C}/me/appointments/${id}/review`, headers: { authorization: `Bearer ${token}` }, payload });

  describe('eligibility', () => {
    it('a completed visit can be reviewed, once', async () => {
      const id = await visit(me.id, customerId, { daysAgo: 3 });
      made.push(id);
      const list = ClientAppointmentsSchema.parse((await app.inject({ method: 'GET', url: `${C}/me/appointments`, headers: { authorization: `Bearer ${me.token}` } })).json());
      const a = list.appointments.find((x) => x.id === id)!;
      expect(a.completed).toBe(true);
      expect(a.canReview).toBe(true);
      expect(a.review).toBeNull();
      expect(a.employeeId).toBe(demo.empMaria);

      const res = await submit(id, { ...good, body: '  Одлична услуга, многу чисто.  ' });
      expect(res.statusCode).toBe(200);
      expect(res.json().body).toBe('Одлична услуга, многу чисто.');
      const again = await submit(id, good);
      expect(again.statusCode).toBe(409);
      expect(again.json().error).toBe('ALREADY_REVIEWED');

      const after = ClientAppointmentsSchema.parse((await app.inject({ method: 'GET', url: `${C}/me/appointments`, headers: { authorization: `Bearer ${me.token}` } })).json());
      const b = after.appointments.find((x) => x.id === id)!;
      expect(b.canReview).toBe(false);
      expect(b.review?.service).toBe(5);
      // The salon heard about it, without the score.
      const notice = await admin.query(`SELECT title, body FROM platform_notices WHERE kind='review' AND tenant_id=$1 ORDER BY created_at DESC LIMIT 1`, [demo.business]);
      expect(notice.rows[0].title).toBe('New review');
      expect(String(notice.rows[0].body)).not.toMatch(/[1-5]/);
    });

    it('two submissions racing on one visit leave one review', async () => {
      const id = await visit(me.id, customerId, { daysAgo: 4, startMin: 700 });
      made.push(id);
      const [a, b] = await Promise.all([submit(id, good), submit(id, good)]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
      const n = await admin.query(`SELECT count(*)::int AS n FROM reviews WHERE appointment_id=$1`, [id]);
      expect(n.rows[0].n).toBe(1);
    });

    it('a scheduled, cancelled or no-show visit cannot be reviewed', async () => {
      const future = await visit(me.id, customerId, { daysAgo: -7 });
      const cancelled = await visit(me.id, customerId, { daysAgo: 5, status: 'cancelled' });
      const noShow = await visit(me.id, customerId, { daysAgo: 5, status: 'no_show', startMin: 800 });
      made.push(future, cancelled, noShow);
      for (const id of [future, cancelled, noShow]) {
        const res = await submit(id, good);
        expect(res.statusCode, id).toBe(409);
        expect(res.json().error).toBe('NOT_COMPLETED');
      }
      const list = ClientAppointmentsSchema.parse((await app.inject({ method: 'GET', url: `${C}/me/appointments`, headers: { authorization: `Bearer ${me.token}` } })).json());
      for (const id of [future, cancelled, noShow]) expect(list.appointments.find((x) => x.id === id)!.canReview).toBe(false);
    });

    it("another customer's visit is not there to review, and a guest cannot at all", async () => {
      const id = await visit(me.id, customerId, { daysAgo: 6 });
      made.push(id);
      expect((await submit(id, good, other.token)).statusCode).toBe(404);
      const guest = await app.inject({ method: 'POST', url: `${C}/me/appointments/${id}/review`, payload: good });
      expect(guest.statusCode).toBe(401);
      expect((await admin.query(`SELECT count(*)::int AS n FROM reviews WHERE appointment_id=$1`, [id])).rows[0].n).toBe(0);
    });

    it('refuses half stars, zero, six, and an essay', async () => {
      const id = await visit(me.id, customerId, { daysAgo: 6, startMin: 720 });
      made.push(id);
      for (const bad of [{ ...good, service: 0 }, { ...good, timing: 6 }, { ...good, cleanliness: 4.5 }, { service: 5, timing: 5, cleanliness: 5 }, { ...good, body: 'x'.repeat(801) }])
        expect((await submit(id, bad)).statusCode, JSON.stringify(bad).slice(0, 40)).toBe(400);
      // Whitespace-only words are no words at all.
      const ok = await submit(id, { ...good, body: '   ' });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().body).toBeNull();
    });
  });

  describe('the numbers', () => {
    it('the salon score is service+timing+cleanliness; the professional keeps their own; one decimal', async () => {
      // Two visits for a dedicated professional at a fresh count.
      await admin.query(`DELETE FROM reviews WHERE client_user_id=$1`, [me.id]);
      const a = await visit(me.id, customerId, { daysAgo: 8, employee: demo.empAna });
      const b = await visit(me.id, customerId, { daysAgo: 9, employee: demo.empAna });
      made.push(a, b);
      expect((await submit(a, { service: 5, timing: 4, cleanliness: 5, professional: 5 })).statusCode).toBe(200);
      expect((await submit(b, { service: 4, timing: 4, cleanliness: 5, professional: 3 })).statusCode).toBe(200);
      resetRatingsCache();
      const sum = WorkspaceReviewsSummarySchema.parse((await app.inject({ method: 'GET', url: `${API_PREFIX}/reviews/summary`, headers: { authorization: `Bearer ${ownerToken}` } })).json());
      // (4.667 + 4.333) / 2 = 4.5 — the professional's 5 and 3 stay out.
      expect(sum.avg).toBe(4.5);
      expect(sum.count).toBe(2);
      expect(sum.service).toBe(4.5);
      expect(sum.timing).toBe(4);
      expect(sum.cleanliness).toBe(5);
      expect(sum.distribution).toEqual([0, 0, 0, 1, 1]);
      const ana = sum.employees.find((e) => e.id === demo.empAna)!;
      expect(ana.avg).toBe(4);
      expect(ana.count).toBe(2);
      expect(sum.employees.find((e) => e.id === demo.empMaria)).toBeUndefined();

      // The marketplace says the same, in one decimal, on the salon page and on cards.
      const detail = DiscoverySalonDetailSchema.parse((await app.inject({ method: 'GET', url: `${P}/discovery/salons/velnes-fizio` })).json());
      expect(detail.reviews?.avg).toBe(4.5);
      expect(detail.reviews?.count).toBe(2);
      expect(detail.team.find((t) => t.id === demo.empAna)?.rating).toEqual({ avg: 4, count: 2 });
      const cards = (await app.inject({ method: 'GET', url: `${P}/discovery/salons` })).json() as { salons: { slug: string; rating: { avg: number; count: number } | null }[] };
      expect(cards.salons.find((s) => s.slug === 'velnes-fizio')?.rating).toEqual({ avg: 4.5, count: 2 });
      // A salon nobody reviewed says nothing — no 0.0.
      expect(cards.salons.filter((s) => s.slug !== 'velnes-fizio').every((s) => s.rating === null)).toBe(true);
    });

    it('the public list shows a first name and an initial, hides a hidden text, and drops a voided rating', async () => {
      const page = PublicReviewsPageSchema.parse((await app.inject({ method: 'GET', url: `${P}/discovery/salons/velnes-fizio/reviews?limit=5` })).json());
      expect(page.total).toBe(2);
      const r = page.reviews[0]!;
      expect(r.reviewer).toBe('Ana D.');
      expect(r.verified).toBe(true);
      expect(JSON.stringify(page)).not.toContain('@');
      expect(r.visitMonth).toMatch(/^\d{4}-\d{2}$/);
      // Moderation: the words go, the stars stay.
      await admin.query(`UPDATE reviews SET body='rude words', body_status='hidden' WHERE id=$1`, [r.id]);
      const hidden = PublicReviewsPageSchema.parse((await app.inject({ method: 'GET', url: `${P}/discovery/salons/velnes-fizio/reviews` })).json());
      expect(hidden.reviews.find((x) => x.id === r.id)?.body).toBeNull();
      expect(hidden.total).toBe(2);
      // …and a voided rating leaves the numbers.
      await admin.query(`UPDATE reviews SET rating_status='void' WHERE id=$1`, [r.id]);
      resetRatingsCache();
      const sum = WorkspaceReviewsSummarySchema.parse((await app.inject({ method: 'GET', url: `${API_PREFIX}/reviews/summary`, headers: { authorization: `Bearer ${ownerToken}` } })).json());
      expect(sum.count).toBe(1);
      await admin.query(`UPDATE reviews SET rating_status='valid', body_status='published' WHERE id=$1`, [r.id]);
      resetRatingsCache();
    });
  });

  describe('the salon side', () => {
    it('the owner sees the list with the names it already knows; staff without the permission do not; nothing can be changed', async () => {
      const page = WorkspaceReviewsPageSchema.parse((await app.inject({ method: 'GET', url: `${API_PREFIX}/reviews`, headers: { authorization: `Bearer ${ownerToken}` } })).json());
      expect(page.total).toBeGreaterThanOrEqual(2);
      expect(page.reviews[0]!.customerName).toBe('Review Tester');
      expect(page.reviews.every((r) => r.locationName === 'Centar')).toBe(true);
      const filtered = WorkspaceReviewsPageSchema.parse((await app.inject({ method: 'GET', url: `${API_PREFIX}/reviews?employeeId=${demo.empAna}&stars=5`, headers: { authorization: `Bearer ${ownerToken}` } })).json());
      expect(filtered.reviews.every((r) => r.employeeId === demo.empAna && Math.round(r.overall) === 5)).toBe(true);
      expect((await app.inject({ method: 'GET', url: `${API_PREFIX}/reviews`, headers: { authorization: `Bearer ${staffToken}` } })).statusCode).toBe(403);
      for (const method of ['PATCH', 'DELETE', 'PUT'] as const)
        expect((await app.inject({ method, url: `${API_PREFIX}/reviews/${page.reviews[0]!.id}`, headers: { authorization: `Bearer ${ownerToken}` }, payload: {} })).statusCode).toBe(404);
    });

    it("another salon's context sees none of them", async () => {
      const mine = await withTenant(demo.business, (trx) => trx.selectFrom('reviews').select('id').execute());
      expect(mine.length).toBeGreaterThan(0);
      const theirs = await withTenant(demo.bizVita, (trx) => trx.selectFrom('reviews').select('id').execute());
      expect(theirs).toEqual([]);
    });
  });

  describe('the reminder', () => {
    // Other suites' visits may be due too; every assertion here is about
    // a specific appointment, never the run's total.
    const reminded = async (id: string) =>
      (await admin.query(`SELECT count(*)::int AS n FROM review_reminders WHERE appointment_id=$1`, [id])).rows[0].n as number;

    it('goes once, a day after the visit ended, in the app and by mail, in the client\'s language', async () => {
      const id = await visit(me.id, customerId, { daysAgo: 1, startMin: 540 });
      made.push(id);
      const ends = await endsAt(id);
      await sendDueReviewReminders(plus(ends, 23 * 60 + 59));
      expect(await reminded(id)).toBe(0);
      await sendDueReviewReminders(plus(ends, 24 * 60 + 1));
      expect(await reminded(id)).toBe(1);
      // Twice more, at once and later: still one.
      await Promise.all([sendDueReviewReminders(plus(ends, 25 * 60)), sendDueReviewReminders(plus(ends, 25 * 60))]);
      await sendDueReviewReminders(plus(ends, 48 * 60));
      expect(await reminded(id)).toBe(1);
      const notif = await admin.query(`SELECT kind, title, ref_type, ref_id FROM client_notifications WHERE client_user_id=$1 AND kind='review' AND ref_id=$2`, [me.id, id]);
      expect(notif.rows).toHaveLength(1);
      expect(notif.rows[0].title).toBe('Како помина посетата?');
      expect(notif.rows[0].ref_type).toBe('appointment');
      const mail = await admin.query(`SELECT subject, meta FROM mail_outbox WHERE to_email=$1 AND kind='review_reminder' AND ref_id=$2`, [EMAIL.toLowerCase(), id]);
      expect(mail.rows).toHaveLength(1);
      expect(mail.rows[0].subject).toContain('Velnes Fizio Centar');
      expect(String(mail.rows[0].meta.cta.url)).toContain(`/account/appointments/${id}?review=1`);
    });

    it('does not remind a reviewed, cancelled or no-show visit, nor one from before the feature went live', async () => {
      const reviewed = await visit(me.id, customerId, { daysAgo: 2, startMin: 540 });
      const cancelled = await visit(me.id, customerId, { daysAgo: 2, startMin: 600, status: 'cancelled' });
      const noShow = await visit(me.id, customerId, { daysAgo: 2, startMin: 660, status: 'no_show' });
      const old = await visit(me.id, customerId, { daysAgo: 30, startMin: 540 });
      made.push(reviewed, cancelled, noShow, old);
      expect((await submit(reviewed, good)).statusCode).toBe(200);
      const ends = await endsAt(noShow);
      await sendDueReviewReminders(plus(ends, 48 * 60));
      for (const id of [reviewed, cancelled, noShow, old]) expect(await reminded(id), id).toBe(0);
    });

    it('a visit of several treatments is reminded once, and a review submitted meanwhile stops it', async () => {
      const leg1 = await visit(me.id, customerId, { daysAgo: 7, startMin: 540, service: demo.s1 });
      const leg2 = await visit(me.id, customerId, { daysAgo: 7, startMin: 585, service: demo.s2 });
      made.push(leg1, leg2);
      const ends = await endsAt(leg2);
      await sendDueReviewReminders(plus(ends, 25 * 60));
      expect(await reminded(leg2)).toBe(1);
      expect(await reminded(leg1)).toBe(0);
      // The earlier leg is not reminded on the next run either — same day, same salon.
      await sendDueReviewReminders(plus(ends, 30 * 60));
      expect(await reminded(leg1)).toBe(0);
      // A leg reviewed after it was picked but before the gate: the gate holds.
      await admin.query(`DELETE FROM review_reminders WHERE appointment_id=$1`, [leg2]);
      expect((await submit(leg2, good)).statusCode).toBe(200);
      await sendDueReviewReminders(plus(ends, 30 * 60));
      expect(await reminded(leg2)).toBe(0);
      expect(await reminded(leg1)).toBe(1);
    });
  });
});
