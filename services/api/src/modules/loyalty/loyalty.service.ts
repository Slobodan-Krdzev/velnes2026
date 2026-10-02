import { createI18n } from '@velnes/i18n';
import { LOYALTY_RULES, appointmentPoints, rulesForClients, type LoyaltyAccount, type LoyaltyEntry, type LoyaltyType } from '@velnes/contracts';
import { sql } from 'kysely';
import type { Trx } from '../../db/index.js';
import { db, withClient, withHq, withTenant } from '../../db/index.js';
import { notifyClient } from '../clients/clients.service.js';
import { visitLegs } from '../booking/changes.service.js';

/**
 * Velnes Loyalty — Alex, 2026-09-30. docs/LOYALTY.md.
 *
 * The platform points ledger, one writer. `award` inserts a signed row
 * with a typed reason and a source and recomputes the account's cached
 * balance in the same transaction; the partial UNIQUE on (account,
 * type, source) makes every automatic award idempotent, so a door, a
 * retried door and the sweep can all try and exactly one row lands.
 *
 * Three sources today: the account (its verification), the visit (its
 * first leg, settled two hours after the visit ended so the till's
 * products are on the invoice), the review. The sweep below is the
 * durable path: whatever a door failed to award because the process
 * died, the sweep awards later from the same source rows; and a visit
 * later cancelled or marked no-show after its award gets one negative
 * reversal. Nothing before the launch cutoff (`platform_features
 * 'loyalty'`) earns anything.
 */

type Lang = 'en' | 'mk' | 'sq';
const asLang = (l: string | null | undefined): Lang => (l === 'mk' || l === 'sq' ? l : 'en');

export interface AwardInput {
  clientUserId: string;
  type: LoyaltyType;
  points: number;
  sourceType?: string | null;
  sourceId?: string | null;
  tenantId?: string | null;
  meta?: Record<string, unknown>;
  note?: string | null;
  createdBy?: string;
}

/** The one writer. Returns the row it wrote, or null when the same
 *  (account, type, source) was already there. HQ context. */
export async function award(trx: Trx, input: AwardInput): Promise<{ id: string; points: number } | null> {
  if (!Number.isInteger(input.points) || input.points === 0) return null;
  const row = await trx
    .insertInto('clientLoyaltyLedger')
    .values({
      clientUserId: input.clientUserId,
      type: input.type,
      points: input.points,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      tenantId: input.tenantId ?? null,
      meta: JSON.stringify({ ruleVersion: LOYALTY_RULES.version, ...(input.meta ?? {}) }),
      note: input.note ?? null,
      createdBy: input.createdBy ?? 'system',
    })
    .onConflict((oc) => oc.columns(['clientUserId', 'type', 'sourceId']).where('sourceId', 'is not', null).doNothing())
    .returning(['id', 'points'])
    .executeTakeFirst();
  if (!row) return null;
  // The cache follows the ledger, in the same transaction — never the
  // other way round.
  await trx
    .updateTable('clientUsers')
    .set({ loyaltyPoints: sql<number>`(SELECT COALESCE(SUM(points), 0) FROM client_loyalty_ledger WHERE client_user_id = ${input.clientUserId})` })
    .where('id', '=', input.clientUserId)
    .execute();
  return row;
}

/** The launch cutoff. */
async function launchedAt(trx: Trx): Promise<Date> {
  const f = await trx.selectFrom('platformFeatures').select('since').where('key', '=', 'loyalty').executeTakeFirst();
  return f?.since ?? new Date();
}

/* ── Registration ───────────────────────────────────────────────────── */

/** The welcome bonus, on the first verification. Idempotent by the
 *  account id as source. Returns the points, or 0 when already given. */
export async function awardRegistration(clientUserId: string): Promise<number> {
  return withHq(async (trx) => {
    const row = await award(trx, {
      clientUserId,
      type: 'registration_bonus',
      points: LOYALTY_RULES.registration,
      sourceType: 'account',
      sourceId: clientUserId,
    });
    return row?.points ?? 0;
  });
}

/* ── Reviews ────────────────────────────────────────────────────────── */

export async function awardReview(clientUserId: string, reviewId: string, tenantId: string): Promise<number> {
  return withHq(async (trx) => {
    const row = await award(trx, {
      clientUserId,
      type: 'review_submitted',
      points: LOYALTY_RULES.review,
      sourceType: 'review',
      sourceId: reviewId,
      tenantId,
    });
    return row?.points ?? 0;
  });
}

/* ── Visits ─────────────────────────────────────────────────────────── */

/** What a visit earns, from what was actually delivered and sold: the
 *  legs still booked or confirmed, and the product units on the
 *  non-refunded invoices that carry one of the visit's legs. */
export async function visitReward(tenantId: string, anchorId: string) {
  return withTenant(tenantId, async (trx) => {
    const legs = await visitLegs(trx, anchorId);
    const delivered = legs.filter((l) => l.status === 'booked' || l.status === 'confirmed');
    if (!delivered.length) return null;
    const ids = delivered.map((l) => l.id);
    const invoiceIds = (
      await trx
        .selectFrom('invoiceLines as il')
        .innerJoin('invoices as i', 'i.id', 'il.invoiceId')
        .select('i.id')
        .where('il.appointmentId', 'in', ids)
        .where('i.status', '!=', 'Refunded')
        .execute()
    ).map((r) => r.id);
    let productUnits = 0;
    if (invoiceIds.length) {
      const q = await trx
        .selectFrom('invoiceLines')
        .select(sql<number>`COALESCE(SUM(qty), 0)`.as('units'))
        .where('invoiceId', 'in', [...new Set(invoiceIds)])
        .where('itemClass', '=', 'product')
        .executeTakeFirst();
      productUnits = Number(q?.units ?? 0);
    }
    const serviceIds = delivered.map((l) => l.serviceId).filter((x): x is string => Boolean(x));
    const names = serviceIds.length
      ? (await trx.selectFrom('services').select(['id', 'name']).where('id', 'in', serviceIds).execute())
      : [];
    const biz = await trx.selectFrom('businesses').select('name').where('id', '=', tenantId).executeTakeFirst();
    // Lengths other than the standard one (Alex, 2026-10-02): one per
    // such treatment, read from the variant the leg carries — a retired
    // length still counts for the visit that took it.
    const variantIds = delivered.map((l) => l.variantId).filter((x): x is string => Boolean(x));
    const upgraded = variantIds.length
      ? await trx.selectFrom('serviceVariants').select('id').where('id', 'in', variantIds).where('std', '=', false).execute()
      : [];
    const upgrades = variantIds.filter((id) => upgraded.some((u) => u.id === id)).length;
    const pts = appointmentPoints(delivered.length, productUnits, upgrades);
    return {
      first: legs[0]!,
      clientUserId: legs[0]!.clientUserId,
      serviceCount: delivered.length,
      productUnits,
      upgrades,
      ...pts,
      salonName: biz?.name ?? '',
      serviceNames: delivered.map((l) => names.find((n) => n.id === l.serviceId)?.name ?? l.title),
    };
  });
}

/**
 * Visits due for settlement: ended `settleHours` ago in their
 * location's zone, after the launch cutoff, belonging to an account,
 * still delivered, and not yet awarded. One row per visit (the earliest
 * leg of the chain is the anchor and the source).
 */
async function dueVisits(now: Date) {
  return withHq(async (trx) => {
    const r = await sql<{ id: string; tenantId: string }>`
      SELECT DISTINCT ON (visit) a.id, a.tenant_id AS "tenantId"
      FROM (
        SELECT a.*, COALESCE(regexp_replace(a.idempotency_key, ':[0-9]+$', ''), a.id::text) AS visit
        FROM appointments a
      ) a
      JOIN locations l ON l.id = a.location_id
      WHERE a.client_user_id IS NOT NULL
        AND a.kind = 'appointment'
        AND a.status IN ('booked', 'confirmed')
        AND ((a.date::timestamp + make_interval(mins => a.start_min + a.duration_min)) AT TIME ZONE l.tz)
              <= ${now}::timestamptz - make_interval(hours => ${LOYALTY_RULES.appointment.settleHours})
        AND ((a.date::timestamp + make_interval(mins => a.start_min + a.duration_min)) AT TIME ZONE l.tz)
              >= (SELECT since FROM platform_features WHERE key = 'loyalty')
        AND NOT EXISTS (
          SELECT 1 FROM client_loyalty_ledger g
          WHERE g.type = 'appointment_completed' AND g.client_user_id = a.client_user_id
            AND g.source_id IN (
              SELECT a3.id::text FROM appointments a3
              WHERE COALESCE(regexp_replace(a3.idempotency_key, ':[0-9]+$', ''), a3.id::text) = a.visit))
      ORDER BY visit, a.date, a.start_min
      LIMIT 200
    `.execute(trx);
    return r.rows;
  });
}

/** Settle one visit: compute, award once, tell the customer once. */
export async function settleVisit(tenantId: string, anchorId: string): Promise<number> {
  const reward = await visitReward(tenantId, anchorId);
  if (!reward || !reward.clientUserId || reward.total <= 0) return 0;
  const first = reward.first;
  const row = await withHq((trx) =>
    award(trx, {
      clientUserId: reward.clientUserId!,
      type: 'appointment_completed',
      points: reward.total,
      sourceType: 'appointment',
      sourceId: first.id,
      tenantId,
      meta: {
        serviceCount: reward.serviceCount,
        servicePoints: reward.servicePoints,
        productUnits: reward.productUnits,
        productPoints: reward.productPoints,
        upgrades: reward.upgrades,
        upgradePoints: reward.upgradePoints,
        total: reward.total,
        salonName: reward.salonName,
        serviceNames: reward.serviceNames,
        date: first.date,
      },
    }),
  );
  if (!row) return 0;
  const lang = asLang((await withHq((t) => t.selectFrom('clientUsers').select('lang').where('id', '=', reward.clientUserId!).executeTakeFirst()))?.lang);
  const t = createI18n(lang).t;
  await notifyClient(reward.clientUserId, {
    kind: 'loyalty',
    title: t('loy.earnedTitle', { n: reward.total }),
    body: t('loy.earnedBody', { n: reward.total, salon: reward.salonName }),
    refType: 'loyalty',
    refId: first.id,
  });
  return reward.total;
}

/**
 * A visit awarded and then undone (every delivered leg cancelled or
 * marked no-show): one negative row, once. The original stays.
 */
async function reverseUndoneVisits(): Promise<number> {
  const awarded = await withHq(async (trx) => {
    const r = await sql<{ id: string; clientUserId: string; points: number; sourceId: string; tenantId: string | null }>`
      SELECT g.id, g.client_user_id AS "clientUserId", g.points, g.source_id AS "sourceId", g.tenant_id AS "tenantId"
      FROM client_loyalty_ledger g
      JOIN appointments a ON a.id::text = g.source_id
      WHERE g.type = 'appointment_completed'
        AND a.status IN ('cancelled', 'no_show')
        AND NOT EXISTS (
          SELECT 1 FROM client_loyalty_ledger r
          WHERE r.type = 'appointment_reversal' AND r.source_id = g.source_id AND r.client_user_id = g.client_user_id)
      LIMIT 100
    `.execute(trx);
    return r.rows;
  });
  let n = 0;
  for (const g of awarded) {
    if (!g.tenantId) continue;
    const undone = await withTenant(g.tenantId, async (trx) => {
      const legs = await visitLegs(trx, g.sourceId).catch(() => []);
      return legs.length > 0 && legs.every((l) => l.status === 'cancelled' || l.status === 'no_show');
    });
    if (!undone) continue;
    const row = await withHq((trx) =>
      award(trx, {
        clientUserId: g.clientUserId,
        type: 'appointment_reversal',
        points: -g.points,
        sourceType: 'appointment',
        sourceId: g.sourceId,
        tenantId: g.tenantId,
        meta: { reversedEntryId: g.id },
      }),
    );
    if (row) n += 1;
  }
  return n;
}

/** Doors that awarded nothing because the process died: the account
 *  verified, the review written — after the cutoff, with no row. */
async function repairMissed(): Promise<number> {
  let n = 0;
  const since = await withHq(launchedAt);
  const accounts = await withHq((trx) =>
    trx
      .selectFrom('clientUsers as cu')
      .select('cu.id')
      .where('cu.emailVerifiedAt', '>=', since)
      .where(({ not, exists, selectFrom }) =>
        not(exists(selectFrom('clientLoyaltyLedger as g').select('g.id').whereRef('g.clientUserId', '=', 'cu.id').where('g.type', '=', 'registration_bonus'))),
      )
      .limit(200)
      .execute(),
  );
  for (const a of accounts) if (await awardRegistration(a.id)) n += 1;
  const reviews = await withHq((trx) =>
    trx
      .selectFrom('reviews as r')
      .select(['r.id', 'r.clientUserId', 'r.tenantId'])
      .where('r.createdAt', '>=', since)
      .where(({ not, exists, selectFrom }) =>
        not(exists(selectFrom('clientLoyaltyLedger as g').select('g.id').whereRef('g.sourceId', '=', sql`r.id::text`).where('g.type', '=', 'review_submitted'))),
      )
      .limit(200)
      .execute(),
  );
  for (const r of reviews) if (await awardReview(r.clientUserId, r.id, r.tenantId)) n += 1;
  return n;
}

/** One pass: settle due visits, reverse undone ones, repair the rest. */
export async function runLoyaltySweep(now = new Date()): Promise<{ settled: number; reversed: number; repaired: number }> {
  let settled = 0;
  for (const v of await dueVisits(now)) if (await settleVisit(v.tenantId, v.id)) settled += 1;
  const reversed = await reverseUndoneVisits();
  const repaired = await repairMissed();
  return { settled, reversed, repaired };
}

let running: Promise<{ settled: number; reversed: number; repaired: number }> | null = null;
export function runLoyalty(now = new Date()) {
  if (running) return running;
  running = runLoyaltySweep(now).finally(() => {
    running = null;
  });
  return running;
}

/** In-process, like the mail and reminder loops; the unique index
 *  makes a second instance harmless. */
export function startLoyaltyLoop(everyMs = 5 * 60_000) {
  const tick = () => void runLoyalty().catch(() => undefined);
  setTimeout(tick, 25_000).unref();
  return setInterval(tick, everyMs).unref();
}

/* ── Reading ────────────────────────────────────────────────────────── */

async function salonNames(tenantIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(tenantIds)];
  if (!ids.length) return new Map();
  const rows = await db.transaction().execute(async (trx) => {
    await sql`select set_config('app.public', '1', true)`.execute(trx);
    return trx.selectFrom('businesses').select(['id', 'name']).where('id', 'in', ids).execute();
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

function toEntry(r: { id: string; type: string; points: number; sourceType: string | null; sourceId: string | null; tenantId: string | null; meta: unknown; createdAt: Date }, salons: Map<string, string>): LoyaltyEntry {
  return {
    id: r.id,
    type: r.type as LoyaltyType,
    points: r.points,
    sourceType: r.sourceType,
    sourceId: r.sourceId,
    salonName: r.tenantId ? (salons.get(r.tenantId) ?? null) : null,
    meta: (r.meta ?? {}) as Record<string, unknown>,
    at: r.createdAt.toISOString(),
  };
}

/** The customer's own account: the balance from the ledger, the ledger
 *  newest first, the rules as words can use them. */
export async function loyaltyAccountOf(clientUserId: string, limit = 100): Promise<LoyaltyAccount> {
  const rows = await withClient(clientUserId, (trx) =>
    trx.selectFrom('clientLoyaltyLedger').selectAll().where('clientUserId', '=', clientUserId).orderBy('createdAt', 'desc').limit(limit).execute(),
  );
  const balance = await withClient(clientUserId, async (trx) => {
    const r = await trx
      .selectFrom('clientLoyaltyLedger')
      .select(sql<number>`COALESCE(SUM(points), 0)`.as('b'))
      .where('clientUserId', '=', clientUserId)
      .executeTakeFirst();
    return Number(r?.b ?? 0);
  });
  const salons = await salonNames(rows.map((r) => r.tenantId).filter((x): x is string => Boolean(x)));
  return { balance, rules: rulesForClients(), entries: rows.map((r) => toEntry(r, salons)) };
}

/** HQ's lookup by email — the account and its ledger, read only. */
export async function loyaltyLookup(email: string) {
  return withHq(async (trx) => {
    const cu = await trx
      .selectFrom('clientUsers')
      .select(['id', 'email', 'first', 'last', 'createdAt', 'emailVerifiedAt'])
      .where(sql<boolean>`lower(email) = lower(${email.trim()})`)
      .executeTakeFirst();
    if (!cu) return null;
    const rows = await trx.selectFrom('clientLoyaltyLedger').selectAll().where('clientUserId', '=', cu.id).orderBy('createdAt', 'desc').limit(200).execute();
    const balance = rows.reduce((n, r) => n + r.points, 0);
    const salons = await salonNames(rows.map((r) => r.tenantId).filter((x): x is string => Boolean(x)));
    return {
      account: { id: cu.id, email: cu.email, name: `${cu.first} ${cu.last}`.trim(), since: cu.createdAt.toISOString().slice(0, 10), verified: cu.emailVerifiedAt !== null },
      balance,
      rules: rulesForClients(),
      entries: rows.map((r) => toEntry(r, salons)),
    };
  });
}
