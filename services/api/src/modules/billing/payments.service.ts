import type { AccessClaims, BillingPayment, BillingPaymentSummary, BillingPaymentWrite } from '@velnes/contracts';
import { paymentSummary } from '@velnes/contracts';
import type { Trx } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';
import { instantAt, localIso, nowAt } from '../scheduling/scheduling.service.js';
import { BillingError } from './billing.service.js';
import { actorName } from './drafts.service.js';
import { addEvent } from './events.js';
import { reaches, type Reach } from './scope.js';

/**
 * The payment ledger (phase 5, 2026-10-07) — docs/INVOICING.md "Phase 5".
 *
 * `billing_payments` is the truth; `billing_invoices.paid_minor` is its
 * cache, maintained here under the invoice's row lock and never
 * anywhere else; the state is derived from the two figures. Two
 * writers:
 *
 *   importSalePayments — the trusted path. When a sale-backed document
 *     is issued, the originating till sale's own tender becomes the
 *     ledger rows: the gift card redeemed as one row, the rest as the
 *     sale's method. Evidence of money that already changed hands at
 *     the till, dated when the sale was made — not a payment Velnes
 *     processed. Idempotent by origin key.
 *   recordManualPayment — staff say money was received outside Velnes:
 *     a bank transfer, cash later, a card at a terminal Velnes does not
 *     see. Source is always `manual`; Velnes moves nothing.
 *
 * No overpayment (an amount beyond what is outstanding is refused,
 * with the figures), no negative amounts (a reversal is a credit note,
 * phase 6), no edit and no delete of a row (append-only by trigger),
 * the document's currency only. `provider` rows wait for a real
 * provider's verified events; nothing fakes them.
 */

const MINOR = 100;

export async function ledgerOf(trx: Trx, invoiceId: string): Promise<{ payments: BillingPayment[]; paidMinor: number }> {
  const rows = await trx
    .selectFrom('billingPayments as p')
    .leftJoin('invoices as s', 's.id', 'p.originSaleId')
    .selectAll('p')
    .select('s.number as saleNumber')
    .where('p.invoiceId', '=', invoiceId)
    .orderBy('p.paidAt')
    .orderBy('p.createdAt')
    .execute();
  const payments = rows.map(
    (r): BillingPayment => ({
      id: r.id,
      amountMinor: Number(r.amountMinor),
      currency: r.currency,
      method: r.method as BillingPayment['method'],
      source: r.source as BillingPayment['source'],
      paidAt: r.paidAt.toISOString(),
      paidOn: localIso(r.paidOn),
      reference: r.reference,
      provider: r.provider,
      providerPaymentId: r.providerPaymentId,
      originSaleId: r.originSaleId,
      originSaleNumber: r.saleNumber ?? null,
      note: r.note,
      recordedBy: { id: r.recordedBy, name: r.recordedByName },
      createdAt: r.createdAt.toISOString(),
    }),
  );
  return { payments, paidMinor: payments.reduce((s, p) => s + p.amountMinor, 0) };
}

export async function summaryOf(trx: Trx, invoiceId: string, grossMinor: number): Promise<BillingPaymentSummary> {
  const l = await ledgerOf(trx, invoiceId);
  return paymentSummary(grossMinor, l.paidMinor, l.payments.length);
}

/** Recompute the cache from the ledger. Called under the invoice's row lock. */
async function refreshCache(trx: Trx, invoiceId: string): Promise<number> {
  const l = await ledgerOf(trx, invoiceId);
  await trx.updateTable('billingInvoices').set({ paidMinor: l.paidMinor }).where('id', '=', invoiceId).execute();
  return l.paidMinor;
}

/**
 * The originating sale's tender, as ledger rows — called by the issue
 * door inside its transaction, after the row became `issued`. A gift
 * card redeemed is one row; the rest of the document's gross is the
 * sale's method. Σ rows = gross, by the phase-2 invariant (gross =
 * total − tip − service charge + gift). A retry finds the rows by key.
 */
export async function importSalePayments(trx: Trx, tenantId: string, invoiceId: string, actor: { id: string | null; name: string }): Promise<BillingPayment[]> {
  const inv = await trx
    .selectFrom('billingInvoices')
    .select(['id', 'status', 'currency', 'grossMinor', 'originSaleId', 'locationId'])
    .where('id', '=', invoiceId)
    .executeTakeFirstOrThrow();
  if (inv.status !== 'issued' || !inv.originSaleId) return [];
  const sale = await trx
    .selectFrom('invoices')
    .select(['id', 'number', 'status', 'method', 'total', 'tip', 'serviceCharge', 'giftAmount', 'createdAt'])
    .where('id', '=', inv.originSaleId)
    .executeTakeFirst();
  if (!sale || sale.status !== 'Paid') return [];
  const gross = Number(inv.grossMinor);
  const gift = sale.giftAmount * MINOR;
  const rest = (sale.total - sale.tip - sale.serviceCharge) * MINOR;
  // Evidence only when the sale still reconciles with the document.
  if (gift + rest !== gross) return [];
  const loc = await trx.selectFrom('locations').select('tz').where('id', '=', inv.locationId).executeTakeFirstOrThrow();
  const paidOn = nowAt(loc.tz, sale.createdAt).date;
  const rows: { amount: number; method: string; key: string }[] = [];
  if (gift > 0) rows.push({ amount: gift, method: 'Gift card', key: `sale:${sale.id}:gift` });
  if (rest > 0) rows.push({ amount: rest, method: sale.method, key: `sale:${sale.id}:tender` });
  for (const r of rows)
    await trx
      .insertInto('billingPayments')
      .values({
        tenantId,
        invoiceId,
        amountMinor: r.amount,
        currency: inv.currency,
        method: r.method,
        source: 'sale',
        paidAt: sale.createdAt,
        paidOn: new Date(paidOn),
        reference: sale.number,
        originSaleId: sale.id,
        originKey: r.key,
        recordedBy: actor.id,
        recordedByName: actor.name,
      })
      .onConflict((oc) => oc.columns(['tenantId', 'originKey']).where('originKey', 'is not', null).doNothing())
      .execute();
  const paid = await refreshCache(trx, invoiceId);
  const l = await ledgerOf(trx, invoiceId);
  const mine = l.payments.filter((p) => p.originSaleId === sale.id && p.source === 'sale');
  if (mine.length)
    await addEvent(trx, tenantId, invoiceId, 'payment', actor, {
      source: 'sale',
      saleNumber: sale.number,
      rows: mine.map((p) => ({ id: p.id, amountMinor: p.amountMinor, method: p.method })),
      paidMinor: paid,
      outstandingMinor: gross - paid,
      state: paymentSummary(gross, paid, l.payments.length).state,
    });
  return mine;
}

/** Staff record money received outside Velnes. Source: manual, always. */
export async function recordManualPayment(
  trx: Trx,
  claims: AccessClaims,
  reach: Reach,
  invoiceId: string,
  w: BillingPaymentWrite,
): Promise<{ payment: BillingPayment; summary: BillingPaymentSummary; replayed: boolean }> {
  // The document, locked: two desks recording at once take turns, and
  // the second sees what the first left outstanding.
  const inv = await trx
    .selectFrom('billingInvoices')
    .select(['id', 'status', 'currency', 'grossMinor', 'locationId', 'number'])
    .where('id', '=', invoiceId)
    .forUpdate()
    .executeTakeFirst();
  if (!inv || !reaches(reach, inv.locationId)) throw new BillingError('NOT_FOUND', 'Unknown accounting invoice');
  const gross = Number(inv.grossMinor);
  const originKey = `manual:${w.key}`;
  const prior = await trx.selectFrom('billingPayments').select(['id', 'invoiceId']).where('originKey', '=', originKey).executeTakeFirst();
  if (prior) {
    if (prior.invoiceId !== invoiceId) throw new BillingError('CONFLICT', 'This key was already used for a payment on another document');
    const l = await ledgerOf(trx, invoiceId);
    return { payment: l.payments.find((p) => p.id === prior.id)!, summary: paymentSummary(gross, l.paidMinor, l.payments.length), replayed: true };
  }
  if (inv.status !== 'issued') throw new BillingError('INVALID', 'A payment is recorded against an issued document only; a draft has no payment history');
  if (w.currency && w.currency !== inv.currency)
    throw new BillingError('INVALID', `This document is in ${inv.currency}; a payment in ${w.currency} is not converted, it is refused`);
  const before = await ledgerOf(trx, invoiceId);
  const outstanding = gross - before.paidMinor;
  if (w.amountMinor > outstanding)
    throw new BillingError(
      'OVERPAYMENT',
      `Only ${outstanding / MINOR} ${inv.currency} is outstanding on ${inv.number}; ${w.amountMinor / MINOR} cannot be recorded`,
      [],
      { outstandingMinor: outstanding, paidMinor: before.paidMinor, grossMinor: gross },
    );
  // The day the money was received, at the location — today keeps the
  // moment; an earlier day is recorded as that day's start there.
  const loc = await trx.selectFrom('locations').select('tz').where('id', '=', inv.locationId).executeTakeFirstOrThrow();
  const today = nowAt(loc.tz);
  if (w.paidOn > today.date) throw new BillingError('INVALID', 'A payment cannot be dated in the future');
  const paidAt = w.paidOn === today.date ? new Date() : instantAt(loc.tz, w.paidOn, 0);
  const name = await actorName(trx, claims.sub);
  const ins = await trx
    .insertInto('billingPayments')
    .values({
      tenantId: claims.ten,
      invoiceId,
      amountMinor: w.amountMinor,
      currency: inv.currency,
      method: w.method,
      source: 'manual',
      paidAt,
      paidOn: new Date(w.paidOn),
      reference: w.reference,
      note: w.note,
      originKey,
      recordedBy: claims.sub,
      recordedByName: name,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const paid = await refreshCache(trx, invoiceId);
  const after = await ledgerOf(trx, invoiceId);
  const summary = paymentSummary(gross, paid, after.payments.length);
  await addEvent(trx, claims.ten, invoiceId, 'payment', { id: claims.sub, name }, {
    source: 'manual',
    paymentId: ins.id,
    amountMinor: w.amountMinor,
    method: w.method,
    paidOn: w.paidOn,
    reference: w.reference,
    paidMinor: paid,
    outstandingMinor: summary.outstandingMinor,
    state: summary.state,
  });
  await logAudit(trx, claims.ten, {
    actorEmployeeId: claims.sub,
    actorName: name,
    action: 'Payment recorded',
    object: `Invoice · ${inv.number}`,
    before: `${before.paidMinor / MINOR} / ${gross / MINOR} ${inv.currency}`,
    after: `${paid / MINOR} / ${gross / MINOR} ${inv.currency} · ${summary.state}`,
    reason: `${w.method}${w.reference ? ` · ${w.reference}` : ''} · received ${w.paidOn}, recorded outside Velnes`,
  });
  return { payment: after.payments.find((p) => p.id === ins.id)!, summary, replayed: false };
}
