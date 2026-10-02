import { randomUUID } from 'node:crypto';
import { API_PREFIX, LOYALTY_RULES, LoyaltyAccountSchema, appointmentPoints, servicePoints } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, withHq } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';
import { award, runLoyaltySweep } from './loyalty.service.js';

/**
 * Velnes Loyalty (Alex, 2026-09-30) — docs/LOYALTY.md. The ledger is
 * the truth, every award idempotent by its source, every balance the
 * sum of its rows. Against the seeded world (Velnes Fizio Centar) with
 * one consumer made here and removed after; the launch cutoff is
 * moved back so visits booked in the past few days count.
 */
const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
const C = `${API_PREFIX}/client`;
const EMAIL = `loyalty.${Date.now()}@example.test`;
const OTHER = `loyalty.other.${Date.now()}@example.test`;
let token = '';
let otherToken = '';
let clientId = '';
let otherId = '';
let mariaToken = '';
let customerId = '';
const made: string[] = [];

/** The n-th most recent open day (Mon–Sat; Sundays are closed) — a
 *  distinct day for every n, so the test's visits never meet. */
const daysAgo = (n: number) => {
  const d = new Date();
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() - 1);
    if (d.getDay() !== 0) left -= 1;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const daysAhead = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const client = (method: 'GET' | 'POST', url: string, payload?: unknown, tok = token) =>
  app.inject({ method, url: `${C}${url}`, headers: { authorization: `Bearer ${tok}` }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });

async function register(email: string) {
  await app.inject({ method: 'POST', url: `${C}/register`, payload: { email, password: 'velnes-test-12345', first: 'Loyal', last: 'Tester', phone: '+389 70 777 020', dob: null, lang: 'en' } });
  const code = (await admin.query(`SELECT body FROM mail_outbox WHERE to_email=$1 AND kind='client_email_verify' ORDER BY sent_at DESC LIMIT 1`, [email.toLowerCase()])).rows[0].body.match(/code is (\d{6})/)![1] as string;
  return { code, verify: () => app.inject({ method: 'POST', url: `${C}/verify-email`, payload: { email, code } }) };
}

/** Treatment minutes of the seeded services Maria does. */
const MIN: Record<string, number> = { [demo.s1]: 45, [demo.s2]: 60, [demo.s3]: 30, [demo.s4]: 60 };

/** A start on `date` where Maria is free for the whole visit — read
 *  from the calendar itself, since the seed's history fills her days
 *  at both locations and the slot doors do not answer for the past. */
async function freeStart(date: string, serviceIds: string[]): Promise<string | null> {
  // Maria's own pace can run past the catalog minutes: pad each leg.
  const need = serviceIds.reduce((n, id) => n + (MIN[id] ?? 45) + 20, 0);
  const busy = (
    await admin.query(
      `SELECT start_min - prep_min AS s, start_min + duration_min + reset_min AS e FROM appointments
       WHERE employee_id = $1 AND date = $2::date AND status <> 'cancelled' AND kind = 'appointment'`,
      [demo.empMaria, date],
    )
  ).rows as { s: number; e: number }[];
  const close = new Date(`${date}T00:00:00`).getDay() === 6 ? 15 * 60 : 19 * 60;
  for (let m = 9 * 60; m + need <= close; m += 30)
    if (!busy.some((b) => b.s < m + need && m < b.e)) return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return null;
}

/** A visit of the client's own with Maria at Aerodrom, on the first
 *  day from `from` (past: open days ago; future: days ahead) where the
 *  whole visit fits — the seed's history fills her days unevenly. */
async function bookVisit(from: number, serviceIds: string[], future = false) {
  let date = '';
  let time: string | null = null;
  for (let n = from; n < from + 12 && !time; n++) {
    date = future ? daysAhead(n) : daysAgo(n);
    time = await freeStart(date, serviceIds);
  }
  if (!time) throw new Error(`No free start for ${serviceIds.length} legs from day ${from}`);
  const res = await client('POST', '/book', {
    slug: 'velnes-fizio',
    key: randomUUID(),
    locationId: demo.locAerodrom,
    serviceId: serviceIds[0],
    date,
    time,
    employeeId: demo.empMaria,
    // Rehab training asks for its "Format" option, as the till does.
    items: serviceIds.map((serviceId) => (serviceId === demo.s4 ? { serviceId, modifierOptionIds: ['63000000-0000-4000-8000-000000000010'] } : { serviceId })),
  });
  expect(res.statusCode, res.body).toBe(200);
  const ids = (res.json().items as { id?: string }[] | undefined)?.map((i) => i.id).filter((x): x is string => Boolean(x)) ?? [];
  const first = res.json().ref as string;
  const legs = ids.length ? ids : [first];
  made.push(...legs);
  return { first, legs, date };
}
const ledger = async (id: string) =>
  (await admin.query(`SELECT type, points, source_id, meta FROM client_loyalty_ledger WHERE client_user_id = $1 ORDER BY created_at`, [id])).rows as { type: string; points: number; source_id: string | null; meta: Record<string, unknown> }[];
const balance = async (id: string) => Number((await admin.query(`SELECT loyalty_points FROM client_users WHERE id = $1`, [id])).rows[0].loyalty_points);
const sum = async (id: string) => Number((await admin.query(`SELECT COALESCE(SUM(points),0) AS s FROM client_loyalty_ledger WHERE client_user_id = $1`, [id])).rows[0].s);

describe('Velnes Loyalty — the platform ledger', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    // The launch cutoff, moved back so this week's visits count.
    await admin.query(`UPDATE platform_features SET since = now() - interval '10 days' WHERE key = 'loyalty'`);
    mariaToken = (await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email: 'maria@velnes.mk', password: 'velnes-demo' } })).json().accessToken as string;
  });
  afterAll(async () => {
    await admin.query(`UPDATE platform_features SET since = now() WHERE key = 'loyalty'`);
    // Every leg of every visit booked here, whatever the response listed.
    const legs = await admin.query(`SELECT id FROM appointments WHERE client_user_id = ANY($1)`, [[clientId, otherId].filter(Boolean)]);
    for (const r of legs.rows) if (!made.includes(r.id)) made.push(r.id as string);
    const keys = made.map((id) => `pay:${id}`);
    await admin.query(`DELETE FROM checkout_items WHERE checkout_id IN (SELECT c.id FROM checkouts c JOIN invoices i ON i.id = c.invoice_id WHERE i.id IN (SELECT invoice_id FROM invoice_lines WHERE appointment_id = ANY($1)))`, [made]);
    await admin.query(`DELETE FROM merchant_transactions WHERE checkout_id IN (SELECT c.id FROM checkouts c JOIN invoices i ON i.id = c.invoice_id WHERE i.id IN (SELECT invoice_id FROM invoice_lines WHERE appointment_id = ANY($1)))`, [made]);
    await admin.query(`DELETE FROM checkouts WHERE invoice_id IN (SELECT invoice_id FROM invoice_lines WHERE appointment_id = ANY($1))`, [made]);
    await admin.query(`DELETE FROM stock_movements WHERE ref IN (SELECT number FROM invoices WHERE id IN (SELECT invoice_id FROM invoice_lines WHERE appointment_id = ANY($1)))`, [made]);
    await admin.query(`DELETE FROM invoice_lines WHERE invoice_id IN (SELECT invoice_id FROM invoice_lines WHERE appointment_id = ANY($1))`, [made]);
    await admin.query(`DELETE FROM invoices WHERE idempotency_key = ANY($1) OR customer_id = $2`, [keys, customerId || randomUUID()]);
    await admin.query(`DELETE FROM reviews WHERE appointment_id = ANY($1)`, [made]);
    await admin.query(`DELETE FROM review_reminders WHERE appointment_id = ANY($1)`, [made]);
    await admin.query(`DELETE FROM booking_change_requests WHERE appointment_id = ANY($1)`, [made]);
    await admin.query(`DELETE FROM member_recs WHERE slot_key IS NOT NULL AND tenant_id = $1`, [demo.business]);
    await admin.query(`DELETE FROM appointment_history WHERE appointment_id = ANY($1)`, [made]);
    await admin.query(`DELETE FROM appointments WHERE id = ANY($1)`, [made]);
    await admin.query(`DELETE FROM platform_notices WHERE ref_id = ANY($1)`, [made]);
    await admin.query(`DELETE FROM mail_outbox WHERE ref_id = ANY($1) OR to_email IN ($2, $3)`, [made, EMAIL.toLowerCase(), OTHER.toLowerCase()]);
    for (const id of [clientId, otherId].filter(Boolean)) {
      await admin.query(`DELETE FROM client_notifications WHERE client_user_id = $1`, [id]);
      const links = await admin.query(`SELECT customer_id FROM client_customer_links WHERE client_user_id = $1`, [id]);
      await admin.query(`DELETE FROM client_customer_links WHERE client_user_id = $1`, [id]);
      for (const l of links.rows) {
        await admin.query(`DELETE FROM loyalty_ledger WHERE customer_id = $1`, [l.customer_id]);
        await admin.query(`DELETE FROM customers WHERE id = $1`, [l.customer_id]);
      }
      await admin.query(`DELETE FROM client_users WHERE id = $1`, [id]); // the ledger cascades
    }
    await admin.query(`DELETE FROM audit_log WHERE actor_name = 'Loyal Tester' OR (action = 'Sale' AND object LIKE 'Invoice%' AND ts > now() - interval '10 minutes' AND actor_name = 'Maria Petrovska')`);
    await admin.end();
    await app.close();
    await closeDb();
  });

  describe('registration', () => {
    it('an unverified signup earns nothing; the first verification earns the welcome bonus, once, and the welcome bell says so', async () => {
      const r = await register(EMAIL);
      const pending = await admin.query(`SELECT id FROM client_users WHERE lower(email) = lower($1)`, [EMAIL]);
      clientId = pending.rows[0].id as string;
      expect(await ledger(clientId)).toEqual([]);
      const v = await r.verify();
      expect(v.statusCode).toBe(200);
      token = v.json().token as string;
      expect(v.json().profile.loyaltyPoints).toBe(LOYALTY_RULES.registration);
      expect(await ledger(clientId)).toMatchObject([{ type: 'registration_bonus', points: LOYALTY_RULES.registration, source_id: clientId }]);
      const bell = await admin.query(`SELECT title, body, ref_type FROM client_notifications WHERE client_user_id = $1 ORDER BY created_at`, [clientId]);
      expect(bell.rows).toHaveLength(1);
      expect(bell.rows[0].body).toContain(`${LOYALTY_RULES.registration} Velnes points`);
      expect(bell.rows[0].ref_type).toBe('loyalty');
      // Verifying again (a retried finalisation): still one bonus, no second bell.
      const again = await app.inject({ method: 'POST', url: `${C}/verify-email`, payload: { email: EMAIL, code: r.code } });
      expect([200, 400]).toContain(again.statusCode);
      expect((await ledger(clientId)).filter((x) => x.type === 'registration_bonus')).toHaveLength(1);
      expect((await admin.query(`SELECT count(*)::int AS n FROM client_notifications WHERE client_user_id = $1`, [clientId])).rows[0].n).toBe(1);
      expect(await balance(clientId)).toBe(LOYALTY_RULES.registration);
    });

    it('a second account is its own wallet: nothing of the first shows through its door', async () => {
      const r = await register(OTHER);
      const v = await r.verify();
      otherToken = v.json().token as string;
      otherId = v.json().profile.id as string;
      const mine = LoyaltyAccountSchema.parse((await client('GET', '/me/loyalty', undefined, otherToken)).json());
      expect(mine.balance).toBe(LOYALTY_RULES.registration);
      expect(mine.entries).toHaveLength(1);
      expect(mine.entries[0]!.sourceId).toBe(otherId);
    });
  });

  describe('appointments', () => {
    it('the sweep settles completed visits once: 1, 2, 3 and 4 delivered services earn the rule\'s progression', async () => {
      const v1 = await bookVisit(3, [demo.s3]);
      const v2 = await bookVisit(4, [demo.s3, demo.s1]);
      const v3 = await bookVisit(5, [demo.s3, demo.s1, demo.s2]);
      const v4 = await bookVisit(6, [demo.s3, demo.s1, demo.s2, demo.s4]);
      customerId = (await admin.query(`SELECT customer_id FROM client_customer_links WHERE client_user_id = $1 AND tenant_id = $2`, [clientId, demo.business])).rows[0].customer_id as string;
      const before = await balance(clientId);
      const out = await runLoyaltySweep();
      expect(out.settled).toBeGreaterThanOrEqual(4);
      const rows = (await ledger(clientId)).filter((r) => r.type === 'appointment_completed');
      const byVisit = (first: string) => rows.find((r) => r.source_id === first);
      expect(byVisit(v1.first)?.points).toBe(servicePoints(1));
      expect(byVisit(v2.first)?.points).toBe(servicePoints(2));
      expect(byVisit(v3.first)?.points).toBe(servicePoints(3));
      expect(byVisit(v4.first)?.points).toBe(servicePoints(4));
      expect(byVisit(v3.first)?.meta).toMatchObject({ serviceCount: 3, productUnits: 0, productPoints: 0, ruleVersion: LOYALTY_RULES.version });
      // One row per visit, never one per leg.
      expect(rows.filter((r) => v4.legs.includes(r.source_id!))).toHaveLength(1);
      expect(await balance(clientId)).toBe(before + [1, 2, 3, 4].reduce((n, k) => n + servicePoints(k), 0));
      // Again: nothing new, no second bell.
      const again = await runLoyaltySweep();
      expect(again.settled).toBe(0);
      expect((await ledger(clientId)).filter((r) => r.type === 'appointment_completed')).toHaveLength(4);
      const bells = await admin.query(`SELECT count(*)::int AS n FROM client_notifications WHERE client_user_id = $1 AND kind = 'loyalty'`, [clientId]);
      expect(bells.rows[0].n).toBe(4);
      const one = await admin.query(`SELECT title FROM client_notifications WHERE client_user_id = $1 AND kind = 'loyalty' AND ref_id = $2`, [clientId, v3.first]);
      expect(one.rows[0].title).toBe(`You earned ${servicePoints(3)} Velnes points`);
    });

    it('products sold with the visit count by quantity: 2 services and 3 units of one product', async () => {
      const v = await bookVisit(6, [demo.s3, demo.s1]);
      customerId = (await admin.query(`SELECT customer_id FROM client_customer_links WHERE client_user_id = $1 AND tenant_id = $2`, [clientId, demo.business])).rows[0].customer_id as string;
      const sale = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/sales`,
        headers: { authorization: `Bearer ${mariaToken}` },
        payload: { key: randomUUID(), locationId: demo.locAerodrom, method: 'Card', customerId, employeeId: demo.empMaria, lines: [{ kind: 'appointment', appointmentId: v.first }, { kind: 'product', productId: demo.p3, qty: 3 }] },
      });
      expect(sale.statusCode, sale.body).toBe(200);
      await runLoyaltySweep();
      const row = (await ledger(clientId)).find((r) => r.source_id === v.first);
      const pts = appointmentPoints(2, 3);
      expect(row?.points).toBe(pts.total);
      expect(pts.productPoints).toBe(3 * LOYALTY_RULES.appointment.productUnit);
      expect(row?.meta).toMatchObject({ serviceCount: 2, productUnits: 3, productPoints: pts.productPoints, servicePoints: servicePoints(2) });
    });

    it('a length other than the standard one earns on top, once per such treatment', async () => {
      // Manual therapy, spine: "One region" is not the standard length.
      const other = (await admin.query(`SELECT id FROM service_variants WHERE service_id = $1 AND std = false ORDER BY sort LIMIT 1`, [demo.s2])).rows[0].id as string;
      let date = '';
      let time: string | null = null;
      for (let n = 7; n < 10 && !time; n++) {
        date = daysAgo(n);
        time = await freeStart(date, [demo.s2]);
      }
      expect(time).toBeTruthy();
      const res = await client('POST', '/book', { slug: 'velnes-fizio', key: randomUUID(), locationId: demo.locAerodrom, serviceId: demo.s2, variantId: other, date, time, employeeId: demo.empMaria, items: [{ serviceId: demo.s2, variantId: other }] });
      expect(res.statusCode, res.body).toBe(200);
      const first = res.json().ref as string;
      made.push(first);
      await runLoyaltySweep();
      const row = (await ledger(clientId)).find((r) => r.source_id === first);
      const pts = appointmentPoints(1, 0, 1);
      expect(pts.upgradePoints).toBe(LOYALTY_RULES.appointment.variantUpgrade);
      expect(row?.points).toBe(pts.total);
      expect(row?.meta).toMatchObject({ serviceCount: 1, upgrades: 1, upgradePoints: pts.upgradePoints, ruleVersion: LOYALTY_RULES.version });
    });

    it('cancelled and no-show visits earn nothing; a future visit with a pending request earns nothing until it completes, then once', async () => {
      const c = await bookVisit(2, [demo.s3]);
      const n = await bookVisit(2, [demo.s3]);
      await admin.query(`UPDATE appointments SET status = 'cancelled', cancelled_by = 'customer', cancelled_at = now() WHERE id = $1`, [c.first]);
      await admin.query(`UPDATE appointments SET status = 'no_show' WHERE id = $1`, [n.first]);
      const f = await bookVisit(14, [demo.s3], true);
      const rs = await client('POST', `/me/appointments/${f.first}/reschedule`, { date: daysAhead(15), time: '10:00' });
      expect(rs.statusCode).toBe(200);
      await runLoyaltySweep();
      const rows = await ledger(clientId);
      for (const id of [c.first, n.first, f.first]) expect(rows.find((r) => r.source_id === id)).toBeUndefined();
      // The salon approves; time passes; the moved visit completes.
      const ok = await app.inject({ method: 'POST', url: `${API_PREFIX}/change-requests/${rs.json().id}/approve`, headers: { authorization: `Bearer ${mariaToken}` } });
      expect(ok.statusCode).toBe(200);
      await runLoyaltySweep();
      expect((await ledger(clientId)).find((r) => r.source_id === f.first)).toBeUndefined();
      await admin.query(`UPDATE appointments SET date = $2::date, start_min = 540 WHERE id = $1`, [f.first, daysAgo(1)]);
      await runLoyaltySweep();
      await runLoyaltySweep();
      expect((await ledger(clientId)).filter((r) => r.source_id === f.first)).toHaveLength(1);
    });

    it('a visit undone after its award gets one negative reversal; the original row stays', async () => {
      const v = await bookVisit(7, [demo.s3]);
      await runLoyaltySweep();
      const awarded = (await ledger(clientId)).find((r) => r.source_id === v.first && r.type === 'appointment_completed');
      expect(awarded?.points).toBe(servicePoints(1));
      const before = await balance(clientId);
      await admin.query(`UPDATE appointments SET status = 'no_show' WHERE id = $1`, [v.first]);
      await runLoyaltySweep();
      await runLoyaltySweep();
      const rows = (await ledger(clientId)).filter((r) => r.source_id === v.first);
      expect(rows.map((r) => [r.type, r.points])).toEqual([
        ['appointment_completed', servicePoints(1)],
        ['appointment_reversal', -servicePoints(1)],
      ]);
      expect(await balance(clientId)).toBe(before - servicePoints(1));
    });
  });

  describe('reviews', () => {
    it('the first valid review earns once; a retry earns nothing more; the response says the number', async () => {
      const v = await bookVisit(8, [demo.s3]);
      const res = await client('POST', `/me/appointments/${v.first}/review`, { service: 5, timing: 5, cleanliness: 5, professional: 5 });
      expect(res.statusCode).toBe(200);
      expect(res.json().loyaltyPoints).toBe(LOYALTY_RULES.review);
      const rows = (await ledger(clientId)).filter((r) => r.type === 'review_submitted');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.source_id).toBe(res.json().id);
      const again = await client('POST', `/me/appointments/${v.first}/review`, { service: 4, timing: 4, cleanliness: 4, professional: 4 });
      expect(again.statusCode).toBe(409);
      expect((await ledger(clientId)).filter((r) => r.type === 'review_submitted')).toHaveLength(1);
      // Not completed: no review, no points.
      const f = await bookVisit(20, [demo.s3], true);
      const early = await client('POST', `/me/appointments/${f.first}/review`, { service: 5, timing: 5, cleanliness: 5, professional: 5 });
      expect(early.statusCode).toBe(409);
      // Not theirs: no review, no points.
      const stranger = await client('POST', `/me/appointments/${v.first}/review`, { service: 5, timing: 5, cleanliness: 5, professional: 5 }, otherToken);
      expect(stranger.statusCode).toBe(404);
      expect((await ledger(otherId)).filter((r) => r.type === 'review_submitted')).toHaveLength(0);
    });
  });

  describe('the ledger', () => {
    it('two awards for one source race to one row; a negative row is ordinary; salons add up to one balance', async () => {
      const src = randomUUID();
      const results = await Promise.all([
        withHq((trx) => award(trx, { clientUserId: clientId, type: 'promotion_bonus', points: 200, sourceType: 'promo', sourceId: src })),
        withHq((trx) => award(trx, { clientUserId: clientId, type: 'promotion_bonus', points: 200, sourceType: 'promo', sourceId: src })),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      // From another salon, and a correction.
      await withHq((trx) => award(trx, { clientUserId: clientId, type: 'manual_adjustment', points: 30, sourceType: 'hq', sourceId: randomUUID(), tenantId: randomUUID(), note: 'test' }));
      await withHq((trx) => award(trx, { clientUserId: clientId, type: 'manual_adjustment', points: -80, sourceType: 'hq', sourceId: randomUUID(), note: 'test' }));
      expect(await balance(clientId)).toBe(await sum(clientId));
      const me = LoyaltyAccountSchema.parse((await client('GET', '/me/loyalty')).json());
      expect(me.balance).toBe(await sum(clientId));
      expect(me.entries[0]!.points).toBe(-80);
      expect(me.rules.additionalService).toBe(LOYALTY_RULES.appointment.additionalService);
      const profile = await client('GET', '/me');
      expect(profile.json().loyaltyPoints).toBe(me.balance);
      // The other account: untouched by any of it.
      expect((await client('GET', '/me/loyalty', undefined, otherToken)).json().balance).toBe(LOYALTY_RULES.registration);
    });

    it('HQ can look an account up by email, read only', async () => {
      const hq = await app.inject({ method: 'POST', url: `${API_PREFIX}/hq/auth/login`, payload: { email: 'ivana@revelapps.com', password: 'velnes-demo' } });
      expect(hq.statusCode).toBe(200);
      const res = await app.inject({ method: 'GET', url: `${API_PREFIX}/hq/loyalty?email=${encodeURIComponent(EMAIL)}`, headers: { authorization: `Bearer ${hq.json().accessToken}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().account.email.toLowerCase()).toBe(EMAIL.toLowerCase());
      expect(res.json().balance).toBe(await sum(clientId));
      const none = await app.inject({ method: 'GET', url: `${API_PREFIX}/hq/loyalty?email=nobody@example.test`, headers: { authorization: `Bearer ${hq.json().accessToken}` } });
      expect(none.statusCode).toBe(404);
    });
  });
});
