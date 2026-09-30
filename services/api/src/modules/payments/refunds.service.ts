import { createI18n } from '@velnes/i18n';
import { sql } from 'kysely';
import type { Trx } from '../../db/index.js';
import { withHq, withTenant } from '../../db/index.js';
import { env } from '../../env.js';
import { logAudit } from '../audit/audit.service.js';
import { notifyClient, notifySalon } from '../clients/clients.service.js';
import { queueMail } from '../mail/mail.service.js';
import { paymentProvider } from './payments.provider.js';

/**
 * Refunds — Alex, 2026-09-30. docs/BOOKING-CHANGES.md §2.6.
 *
 * A cancelled prepaid visit does not get its money back inside the
 * cancellation transaction; it gets a REFUND INTENT there (one row per
 * paid invoice — the UNIQUE is the whole anti-duplicate story), and the
 * provider is asked afterwards, by id. The booking is cancelled either
 * way: a provider that says no, or never answers, leaves `failed` or
 * `pending` behind, to be retried by the loop below, never a booking
 * that springs back to life.
 *
 * What is refundable is decided in one place, `determineRefund`, so
 * deposits, fees and partial refunds can arrive later without touching
 * the cancellation code. V1: a visit paid online through the Velnes
 * app is refunded in full when it is cancelled; venue and unpaid visits
 * need nothing. That is the whole policy today, and it is stated here.
 */

export const MAX_REFUND_ATTEMPTS = 5;
/** Minutes before a failed refund is tried again, by attempt. */
const BACKOFF_MIN = [1, 5, 15, 60];
const ONLINE_METHODS = ['Online card', 'Apple Pay'];

export interface RefundDecision {
  invoiceId: string;
  amount: number;
  method: string;
  chargeRef: string | null;
}

/** The invoices a cancelled visit must give back — V1: every live
 *  online-paid invoice referencing one of its legs, in full. */
export async function determineRefund(trx: Trx, legIds: string[]): Promise<RefundDecision[]> {
  if (!legIds.length) return [];
  const invoices = await trx
    .selectFrom('invoiceLines as l')
    .innerJoin('invoices as i', 'i.id', 'l.invoiceId')
    .select(['i.id', 'i.method', 'i.total', 'i.status'])
    .where('l.appointmentId', 'in', legIds)
    .distinct()
    .execute();
  const out: RefundDecision[] = [];
  for (const inv of invoices) {
    if (inv.status === 'Refunded' || !ONLINE_METHODS.includes(inv.method)) continue;
    // The charge the till stamped when the sale settled.
    const mtx = await trx
      .selectFrom('merchantTransactions as m')
      .innerJoin('checkouts as c', 'c.id', 'm.checkoutId')
      .select('m.providerRef')
      .where('c.invoiceId', '=', inv.id)
      .executeTakeFirst();
    out.push({ invoiceId: inv.id, amount: inv.total, method: inv.method, chargeRef: mtx?.providerRef ?? null });
  }
  return out;
}

/** The intent rows, inside the cancellation's transaction. Idempotent:
 *  an invoice already carrying one is left alone. Returns the ids to
 *  process once the transaction has committed. */
export async function createRefundIntent(trx: Trx, legs: { id: string; tenantId: string; title: string }[], actorName: string): Promise<string[]> {
  const first = legs[0];
  if (!first) return [];
  const decisions = await determineRefund(trx, legs.map((l) => l.id));
  const ids: string[] = [];
  for (const d of decisions) {
    const row = await trx
      .insertInto('refunds')
      .values({
        tenantId: first.tenantId,
        appointmentId: first.id,
        invoiceId: d.invoiceId,
        amount: d.amount,
        method: d.method,
        provider: paymentProvider().name,
        chargeRef: d.chargeRef,
      })
      .onConflict((oc) => oc.column('invoiceId').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!row) continue;
    ids.push(row.id);
    await trx
      .insertInto('appointmentHistory')
      .values({ tenantId: first.tenantId, appointmentId: first.id, what: 'Refund requested', byName: actorName, source: 'system', meta: JSON.stringify({ amount: d.amount, method: d.method, refundId: row.id }) })
      .execute();
  }
  return ids;
}

type Lang = 'en' | 'mk' | 'sq';

/**
 * Ask the provider for one refund. The state moves pending/failed →
 * processing → refunded | failed, each step a guarded UPDATE, so two
 * workers cannot both ask, and a retry of a refunded one does nothing.
 * Never throws: a broken provider is a `failed` row with its reason.
 */
export async function processRefund(refundId: string): Promise<'refunded' | 'failed' | 'skipped'> {
  const claimed = await withHq((trx) =>
    trx
      .updateTable('refunds')
      .set({ status: 'processing', attempts: sql`attempts + 1` })
      .where('id', '=', refundId)
      .where('status', 'in', ['pending', 'failed'])
      .where('attempts', '<', MAX_REFUND_ATTEMPTS)
      .returningAll()
      .executeTakeFirst(),
  );
  if (!claimed) return 'skipped';
  let outcome;
  try {
    outcome = await paymentProvider().refund({ chargeRef: claimed.chargeRef, amount: claimed.amount, invoiceId: claimed.invoiceId });
  } catch (e) {
    outcome = { ok: false, ref: null, reason: e instanceof Error ? e.message.slice(0, 500) : 'Provider error', retry: true };
  }
  await withTenant(claimed.tenantId, async (trx) => {
    const a = await trx
      .selectFrom('appointments as a')
      .leftJoin('services as s', 's.id', 'a.serviceId')
      .select(['a.id', 'a.title', 'a.customerId', 'a.clientUserId', 'a.date', 'a.startMin', 's.name as serviceName'])
      .where('a.id', '=', claimed.appointmentId)
      .executeTakeFirst();
    const cust = a?.customerId
      ? await trx.selectFrom('customers').select(['name', 'email']).where('id', '=', a.customerId).executeTakeFirst()
      : undefined;
    const biz = await trx.selectFrom('businesses').select('name').where('id', '=', claimed.tenantId).executeTakeFirstOrThrow();
    if (outcome.ok) {
      await trx
        .updateTable('refunds')
        .set({ status: 'refunded', providerRef: outcome.ref, completedAt: new Date(), failureReason: null })
        .where('id', '=', refundId)
        .execute();
      // The invoice truth the till and the drawer read: refunded.
      const inv = await trx
        .updateTable('invoices')
        .set({ status: 'Refunded' })
        .where('id', '=', claimed.invoiceId)
        .where('status', '!=', 'Refunded')
        .returning(['number', 'total'])
        .executeTakeFirst();
      await trx.updateTable('appointments').set({ paid: 'unpaid' }).where('id', '=', claimed.appointmentId).execute();
      await logAudit(trx, claimed.tenantId, {
        actorEmployeeId: null,
        actorName: 'Velnes app',
        action: 'Refund',
        object: `Invoice · ${inv?.number ?? claimed.invoiceId}`,
        before: `${claimed.amount} ден paid`,
        after: `${claimed.amount} ден refunded`,
        source: 'Velnes app',
        reason: 'Appointment cancelled',
      });
      if (a)
        await trx
          .insertInto('appointmentHistory')
          .values({ tenantId: claimed.tenantId, appointmentId: a.id, what: 'Refund completed', byName: paymentProvider().name, source: 'system', meta: JSON.stringify({ amount: claimed.amount, ref: outcome.ref }) })
          .execute();
    } else {
      await trx
        .updateTable('refunds')
        .set({ status: 'failed', failureReason: outcome.reason })
        .where('id', '=', refundId)
        .execute();
      if (a)
        await trx
          .insertInto('appointmentHistory')
          .values({ tenantId: claimed.tenantId, appointmentId: a.id, what: 'Refund failed', byName: paymentProvider().name, source: 'system', meta: JSON.stringify({ amount: claimed.amount, reason: outcome.reason, attempt: claimed.attempts }) })
          .execute();
      // The salon sees the state; nobody is asked to press a button.
      await notifySalon(trx, claimed.tenantId, {
        kind: 'booking_refund',
        title: 'Refund needs attention',
        body: `The refund of ${claimed.amount} ден for ${a?.serviceName ?? a?.title ?? 'a cancelled appointment'} could not be completed (${outcome.reason ?? 'unknown reason'}).${claimed.attempts < MAX_REFUND_ATTEMPTS ? ' It will be tried again.' : ' No more retries will be made.'}`,
        ...(a ? { refId: a.id } : {}),
      });
    }
    // The customer hears about money only when it moved, or finally did not.
    const final = outcome.ok || claimed.attempts >= MAX_REFUND_ATTEMPTS;
    if (final && a) {
      const lang: Lang = a.clientUserId
        ? ((await withHq((t) => t.selectFrom('clientUsers').select('lang').where('id', '=', a.clientUserId!).executeTakeFirst()))?.lang as Lang) ?? 'en'
        : 'en';
      const t = createI18n(lang === 'mk' || lang === 'sq' ? lang : 'en').t;
      const amount = `${claimed.amount} MKD`;
      const service = a.serviceName ?? a.title;
      if (cust?.email)
        await queueMail(trx, {
          tenantId: claimed.tenantId,
          to: cust.email,
          subject: outcome.ok ? t('bc.refundedMailSubject', { salon: biz.name }) : t('bc.refundFailedMailSubject', { salon: biz.name }),
          body: outcome.ok
            ? t('bc.refundedMailBody', { name: cust.name, amount, service, salon: biz.name })
            : t('bc.refundFailedMailBody', { name: cust.name, amount, service, salon: biz.name }),
          kind: outcome.ok ? 'refund_completed' : 'refund_failed',
          refId: a.id,
          cta: { label: t('bc.mailCta'), url: `${env.consumerAppUrl}/account/appointments/${a.id}` },
        });
      if (a.clientUserId)
        await notifyClient(a.clientUserId, {
          kind: 'appointment',
          title: outcome.ok ? t('bc.refundedTitle') : t('bc.refundFailedTitle'),
          body: outcome.ok ? t('bc.refundedBody', { amount, service, salon: biz.name }) : t('bc.refundFailedBody', { amount, salon: biz.name }),
          refType: 'appointment',
          refId: a.id,
        });
    }
  });
  return outcome.ok ? 'refunded' : 'failed';
}

/** Everything left over: pending intents whose commit outran their
 *  processing, and failed ones due for another try. */
export async function retryRefunds(now = new Date()): Promise<number> {
  const due = await withHq((trx) =>
    trx
      .selectFrom('refunds')
      .select(['id', 'status', 'attempts', 'requestedAt'])
      .where('status', 'in', ['pending', 'failed'])
      .where('attempts', '<', MAX_REFUND_ATTEMPTS)
      .orderBy('requestedAt')
      .limit(50)
      .execute(),
  );
  let n = 0;
  for (const r of due) {
    const wait = r.status === 'failed' ? (BACKOFF_MIN[Math.min(r.attempts, BACKOFF_MIN.length) - 1] ?? 60) : 0;
    if (r.status === 'failed' && now.getTime() - r.requestedAt.getTime() < wait * 60_000) continue;
    if ((await processRefund(r.id)) !== 'skipped') n += 1;
  }
  return n;
}

let running: Promise<number> | null = null;
export function runRefunds(now = new Date()): Promise<number> {
  if (running) return running;
  running = retryRefunds(now).finally(() => {
    running = null;
  });
  return running;
}

/** In-process, like the mail loop: the API has no scheduler, and the
 *  guarded UPDATE makes a second instance harmless. */
export function startRefundLoop(everyMs = 5 * 60_000) {
  const tick = () => void runRefunds().catch(() => undefined);
  setTimeout(tick, 20_000).unref();
  return setInterval(tick, everyMs).unref();
}
