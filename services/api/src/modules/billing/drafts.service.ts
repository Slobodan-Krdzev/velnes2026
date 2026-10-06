import type {
  AccessClaims,
  BillingBuyerSnapshot,
  BillingInvoice,
  BillingInvoiceLine,
  BillingIssuerSnapshot,
  BillingOrigin,
} from '@velnes/contracts';
import { allocateDiscount, computeLine, evaluateBuyer, summarize, type LineResult } from '@velnes/contracts';
import { sql } from 'kysely';
import type { Trx } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';
import { localIso, nowAt } from '../scheduling/scheduling.service.js';
import { BillingError } from './billing.service.js';
import { reaches, type Reach } from './scope.js';

/**
 * Accounting invoice drafts (phase 2, 2026-10-06) — docs/INVOICING.md.
 *
 * A draft is built from a till sale, once, under an advisory lock on
 * the sale: the second click finds the first draft. Everything the
 * document will print is snapshotted at creation — issuer from the
 * legal entity, the billing profile and the brand; place from the
 * location; buyer from the billing identity; lines from the sale's own
 * `invoice_lines.amount` — and the money is computed by billing-math
 * alone: the sale's price reductions (cart discount, promo, loyalty
 * value) spread over the lines in proportion, each line split into
 * net/VAT/gross once, totals as sums. The invariant checked before the
 * row is written:
 *
 *   Σ line gross  =  Σ line amounts − cart − promo − loyalty
 *                 =  sale total − tip − service charge + gift tender
 *
 * A gift card redeemed is a means of payment, not a discount [confirm];
 * a tip is a gratuity outside the supply [confirm]; a service charge
 * has no agreed treatment, so a sale carrying one is refused here.
 */

const MINOR = 100; // the till keeps whole denars; the document keeps deni

const num = (v: unknown) => Number(v);
const minor = (denars: number) => denars * MINOR;

type Deductions = { cart: number; promo: number; loyalty: number; gift: number; tip: number; serviceCharge: number };

async function issuerSnapshot(trx: Trx, legalEntityId: string): Promise<{ snap: BillingIssuerSnapshot; vatRegistered: boolean; currency: string; pricesIncludeVat: boolean }> {
  const e = await trx
    .selectFrom('legalEntities')
    .select(['id', 'name', 'taxId', 'vatReg', 'embs', 'currency'])
    .where('id', '=', legalEntityId)
    .executeTakeFirstOrThrow();
  const p = await trx.selectFrom('billingProfiles').selectAll().where('legalEntityId', '=', e.id).executeTakeFirst();
  const biz = await trx.selectFrom('businesses').select('name').executeTakeFirst();
  return {
    vatRegistered: p?.vatRegistered ?? false,
    currency: p?.defaultCurrency ?? e.currency ?? 'MKD',
    pricesIncludeVat: p?.pricesIncludeVat ?? true,
    snap: {
      legalEntityId: e.id,
      legalName: e.name,
      tradingName: p?.tradingName ?? biz?.name ?? '',
      edb: e.taxId ?? '',
      vatRegNo: e.vatReg ?? '',
      embs: e.embs ?? '',
      address: p?.address ?? '',
      city: p?.city ?? '',
      zip: p?.zip ?? '',
      country: p?.country ?? 'North Macedonia',
      bankName: p?.bankName ?? '',
      bankAccount: p?.bankAccount ?? '',
      signatoryName: p?.signatoryName ?? '',
      contactEmail: p?.contactEmail ?? '',
      phone: p?.phone ?? '',
      website: p?.website ?? '',
      footerText: p?.footerText ?? '',
      paymentInstructions: p?.paymentInstructions ?? '',
    },
  };
}

async function locationSnapshot(trx: Trx, locationId: string) {
  const l = await trx
    .selectFrom('locations')
    .select(['id', 'name', 'address', 'city', 'zip', 'country', 'tz'])
    .where('id', '=', locationId)
    .executeTakeFirstOrThrow();
  return { locationId: l.id, name: l.name, address: l.address ?? '', city: l.city ?? '', zip: l.zip ?? '', country: l.country ?? 'North Macedonia', tz: l.tz };
}

/** The legal entity that invoices for a location: the one linked to it,
 *  else the tenant's default. */
async function entityFor(trx: Trx, locationId: string): Promise<string> {
  const linked = await trx
    .selectFrom('legalEntityLocations')
    .select('legalEntityId')
    .where('locationId', '=', locationId)
    .executeTakeFirst();
  if (linked) return linked.legalEntityId;
  const dflt = await trx
    .selectFrom('legalEntities')
    .select('id')
    .where('ownerType', '=', 'salon')
    .where('isDefault', '=', true)
    .executeTakeFirst();
  if (!dflt) throw new BillingError('INVALID', 'No legal entity invoices for this location — Velnes HQ sets one up at registration');
  return dflt.id;
}

async function buyerFromIdentity(trx: Trx, billingCustomerId: string): Promise<BillingBuyerSnapshot> {
  const b = await trx.selectFrom('billingCustomers').selectAll().where('id', '=', billingCustomerId).executeTakeFirst();
  if (!b) throw new BillingError('NOT_FOUND', 'Unknown billing identity');
  return {
    billingCustomerId: b.id,
    customerId: b.customerId,
    kind: b.kind as 'person' | 'company',
    name: b.name,
    address: b.address,
    city: b.city,
    zip: b.zip,
    country: b.country,
    edb: b.edb,
    vatRegNo: b.vatRegNo,
    email: b.email,
    phone: b.phone,
  };
}

/** The buyer a sale implies: its customer's one identity, else the
 *  customer's name alone, else nobody (a walk-in). */
async function buyerFromSale(trx: Trx, customerId: string | null): Promise<{ buyer: BillingBuyerSnapshot | null; billingCustomerId: string | null }> {
  if (!customerId) return { buyer: null, billingCustomerId: null };
  const ids = await trx
    .selectFrom('billingCustomers')
    .select('id')
    .where('customerId', '=', customerId)
    .orderBy('updatedAt', 'desc')
    .limit(2)
    .execute();
  if (ids.length === 1) return { buyer: await buyerFromIdentity(trx, ids[0]!.id), billingCustomerId: ids[0]!.id };
  const c = await trx.selectFrom('customers').select(['id', 'name', 'email', 'phone']).where('id', '=', customerId).executeTakeFirst();
  if (!c) return { buyer: null, billingCustomerId: null };
  return {
    billingCustomerId: null,
    buyer: { billingCustomerId: null, customerId: c.id, kind: 'person', name: c.name, address: '', city: '', zip: '', country: 'North Macedonia', edb: '', vatRegNo: '', email: c.email ?? '', phone: c.phone ?? '' },
  };
}

interface Built {
  lines: (LineResult & { src: { id: string; description: string; qty: number; amount: number; itemClass: string; serviceId: string | null; productId: string | null; appointmentId: string | null; vat: number } })[];
  totals: ReturnType<typeof summarize>;
  discountMinor: number;
  origin: BillingOrigin;
}

/** The document's money from the sale's rows — and the proof it reconciles. */
function build(
  sale: { number: string; date: Date; method: string; employeeName: string; total: number; tip: number; serviceCharge: number; cartDiscount: number; giftAmount: number; promoAmount: number },
  rows: { id: string; description: string; qty: number; amount: number; vat: number; itemClass: string; serviceId: string | null; productId: string | null; appointmentId: string | null }[],
  vatRegistered: boolean,
  pricesIncludeVat: boolean,
): Built {
  if (sale.serviceCharge > 0)
    throw new BillingError('INVALID', 'This sale carries a service charge; its tax treatment is not decided, so no accounting invoice can be drafted from it yet');
  const linesSum = rows.reduce((s, r) => s + r.amount, 0);
  // The loyalty value the sale deducted is not stored on the receipt;
  // it is what remains once every stored figure is accounted for.
  const loyalty = linesSum + sale.tip + sale.serviceCharge - sale.cartDiscount - sale.giftAmount - sale.promoAmount - sale.total;
  if (loyalty < 0) throw new BillingError('INVALID', 'This sale does not reconcile: its deductions exceed what its lines and total allow');
  const d: Deductions = { cart: sale.cartDiscount, promo: sale.promoAmount, loyalty, gift: sale.giftAmount, tip: sale.tip, serviceCharge: sale.serviceCharge };
  const discountMinor = minor(d.cart + d.promo + d.loyalty);
  if (discountMinor > minor(linesSum))
    throw new BillingError('INVALID', 'This sale does not reconcile: its price reductions exceed its lines');
  const parts = allocateDiscount(discountMinor, rows.map((r) => minor(r.amount)));
  const lines = rows.map((r, i) => ({
    ...computeLine({
      qtyMilli: 1000,
      unitPrice: minor(r.amount),
      allocatedDiscount: parts[i]!,
      rateBp: r.vat * 100,
      pricesIncludeVat,
      vatRegistered,
    }),
    src: r,
  }));
  const totals = summarize(lines);
  // The invariant, both ways round.
  const expected = minor(sale.total - sale.tip - sale.serviceCharge + sale.giftAmount);
  if (totals.gross !== minor(linesSum) - discountMinor || totals.gross !== expected)
    throw new BillingError('INVALID', `This sale does not reconcile: document gross ${totals.gross} ≠ sale ${expected}`);
  const flags: BillingOrigin['flags'] = [];
  if (d.loyalty > 0) flags.push('loyalty_as_discount');
  if (d.promo > 0) flags.push('promo_as_discount');
  if (d.gift > 0) flags.push('gift_card_as_tender');
  if (d.tip > 0) flags.push('tip_excluded');
  return {
    lines,
    totals,
    discountMinor,
    origin: {
      saleNumber: sale.number,
      saleDate: localIso(sale.date),
      method: sale.method,
      employeeName: sale.employeeName,
      saleTotalMinor: minor(sale.total),
      linesMinor: minor(linesSum),
      cartDiscountMinor: minor(d.cart),
      promoMinor: minor(d.promo),
      loyaltyMinor: minor(d.loyalty),
      giftTenderMinor: minor(d.gift),
      tipMinor: minor(d.tip),
      flags,
    },
  };
}

async function actorName(trx: Trx, id: string | null) {
  if (!id) return '';
  return (await trx.selectFrom('employees').select('name').where('id', '=', id).executeTakeFirst())?.name ?? '';
}

/** One draft per sale, built once, replayed afterwards. */
export async function createDraft(
  trx: Trx,
  claims: AccessClaims,
  reach: Reach,
  input: { saleId: string; billingCustomerId?: string | null | undefined; key?: string | undefined },
): Promise<{ invoice: BillingInvoice; created: boolean }> {
  const sale = await trx.selectFrom('invoices').selectAll().where('id', '=', input.saleId).executeTakeFirst();
  if (!sale) throw new BillingError('NOT_FOUND', 'Unknown sale');
  if (!reaches(reach, sale.locationId)) throw new BillingError('NOT_FOUND', 'Unknown sale');
  // Two desks, one sale: serialise on the sale.
  await sql`SELECT pg_advisory_xact_lock(hashtext(${`billing-draft:${sale.id}`}))`.execute(trx);
  const existing = await trx
    .selectFrom('billingInvoices')
    .select('id')
    .where('originSaleId', '=', sale.id)
    .where('kind', '=', 'invoice')
    .where('status', '<>', 'void')
    .executeTakeFirst();
  if (existing) return { invoice: await getDraft(trx, reach, existing.id), created: false };
  if (input.key) {
    const byKey = await trx.selectFrom('billingInvoices').select('id').where('idempotencyKey', '=', input.key).executeTakeFirst();
    if (byKey) return { invoice: await getDraft(trx, reach, byKey.id), created: false };
  }
  if (sale.status !== 'Paid') throw new BillingError('INVALID', 'Only a paid sale can be invoiced; a refunded one belongs to a credit note');

  const rows = await trx
    .selectFrom('invoiceLines')
    .select(['id', 'description', 'qty', 'amount', 'vat', 'itemClass', 'serviceId', 'productId', 'appointmentId'])
    .where('invoiceId', '=', sale.id)
    .orderBy('sort')
    .execute();
  if (!rows.length) throw new BillingError('INVALID', 'This sale has no lines');

  const legalEntityId = await entityFor(trx, sale.locationId);
  const issuer = await issuerSnapshot(trx, legalEntityId);
  const location = await locationSnapshot(trx, sale.locationId);
  const built = build(sale, rows, issuer.vatRegistered, issuer.pricesIncludeVat);
  const buyer = input.billingCustomerId
    ? { buyer: await buyerFromIdentity(trx, input.billingCustomerId), billingCustomerId: input.billingCustomerId }
    : await buyerFromSale(trx, sale.customerId);
  // The supply happened on the location's day, not the server's.
  const supplyDate = nowAt(location.tz, sale.createdAt).date;
  const name = await actorName(trx, claims.sub);

  const inv = await trx
    .insertInto('billingInvoices')
    .values({
      tenantId: claims.ten,
      legalEntityId,
      locationId: sale.locationId,
      billingCustomerId: buyer.billingCustomerId,
      kind: 'invoice',
      status: 'draft',
      originSaleId: sale.id,
      originAppointmentId: rows.find((r) => r.appointmentId)?.appointmentId ?? null,
      idempotencyKey: input.key ?? null,
      currency: issuer.currency,
      vatRegistered: issuer.vatRegistered,
      pricesIncludeVat: issuer.pricesIncludeVat,
      supplyDate: new Date(supplyDate),
      issuer: JSON.stringify(issuer.snap),
      buyer: buyer.buyer ? JSON.stringify(buyer.buyer) : null,
      location: JSON.stringify(location),
      origin: JSON.stringify(built.origin),
      netMinor: built.totals.net,
      vatMinor: built.totals.vat,
      grossMinor: built.totals.gross,
      discountMinor: built.discountMinor,
      vatBreakdown: JSON.stringify(built.totals.byRate.map((r) => ({ rateBp: r.rateBp, netMinor: r.net, vatMinor: r.vat, grossMinor: r.gross }))),
      createdBy: claims.sub,
      createdByName: name,
      updatedBy: claims.sub,
      updatedByName: name,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  for (const [i, l] of built.lines.entries())
    await trx
      .insertInto('billingInvoiceLines')
      .values({
        tenantId: claims.ten,
        invoiceId: inv.id,
        sort: i,
        itemClass: (['service', 'product', 'other'].includes(l.src.itemClass) ? l.src.itemClass : 'other') as 'service' | 'product' | 'other',
        serviceId: l.src.serviceId,
        productId: l.src.productId,
        appointmentId: l.src.appointmentId,
        tillLineId: l.src.id,
        description: l.src.description,
        employeeName: sale.employeeName,
        unit: l.src.itemClass === 'product' ? 'pc' : 'service',
        qtyMilli: l.src.qty * 1000,
        unitPriceMinor: Math.round(l.amount / l.src.qty),
        sourceAmountMinor: minor(l.src.amount),
        allocatedDiscountMinor: l.allocatedDiscount,
        vatRateBp: l.rateBp,
        exempt: l.exempt,
        netMinor: l.net,
        vatMinor: l.vat,
        grossMinor: l.gross,
      })
      .execute();
  await logAudit(trx, claims.ten, {
    actorEmployeeId: claims.sub,
    actorName: name,
    action: 'Accounting invoice drafted',
    object: `Draft · ${sale.number}`,
    after: `${built.totals.gross / MINOR} ${issuer.currency}`,
    locationName: location.name,
  });
  return { invoice: await getDraft(trx, reach, inv.id), created: true };
}

async function toContract(trx: Trx, id: string): Promise<BillingInvoice> {
  const r = await trx.selectFrom('billingInvoices').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const lines = await trx.selectFrom('billingInvoiceLines').selectAll().where('invoiceId', '=', id).orderBy('sort').execute();
  const buyer = (r.buyer ?? null) as BillingBuyerSnapshot | null;
  return {
    id: r.id,
    kind: r.kind as BillingInvoice['kind'],
    status: r.status as BillingInvoice['status'],
    number: r.number,
    currency: r.currency,
    vatRegistered: r.vatRegistered,
    pricesIncludeVat: r.pricesIncludeVat,
    legalEntityId: r.legalEntityId,
    locationId: r.locationId,
    billingCustomerId: r.billingCustomerId,
    originSaleId: r.originSaleId,
    originAppointmentId: r.originAppointmentId,
    supplyDate: localIso(r.supplyDate),
    issueDate: r.issueDate ? localIso(r.issueDate) : null,
    dueDate: r.dueDate ? localIso(r.dueDate) : null,
    issuedAt: r.issuedAt ? r.issuedAt.toISOString() : null,
    issuer: r.issuer as BillingIssuerSnapshot,
    buyer,
    location: r.location as BillingInvoice['location'],
    origin: (r.origin ?? null) as BillingOrigin | null,
    lines: lines.map(
      (l): BillingInvoiceLine => ({
        id: l.id,
        sort: l.sort,
        itemClass: l.itemClass as BillingInvoiceLine['itemClass'],
        serviceId: l.serviceId,
        productId: l.productId,
        appointmentId: l.appointmentId,
        tillLineId: l.tillLineId,
        description: l.description,
        employeeName: l.employeeName,
        unit: l.unit,
        qtyMilli: l.qtyMilli,
        unitPriceMinor: num(l.unitPriceMinor),
        sourceAmountMinor: num(l.sourceAmountMinor),
        allocatedDiscountMinor: num(l.allocatedDiscountMinor),
        vatRateBp: l.vatRateBp,
        exempt: l.exempt,
        netMinor: num(l.netMinor),
        vatMinor: num(l.vatMinor),
        grossMinor: num(l.grossMinor),
      }),
    ),
    totals: { netMinor: num(r.netMinor), vatMinor: num(r.vatMinor), grossMinor: num(r.grossMinor), discountMinor: num(r.discountMinor) },
    vatBreakdown: (r.vatBreakdown ?? []) as BillingInvoice['vatBreakdown'],
    buyerCompleteness: evaluateBuyer(buyer),
    notes: r.notes,
    createdBy: { id: r.createdBy, name: r.createdByName },
    createdAt: r.createdAt.toISOString(),
    updatedBy: { id: r.updatedBy, name: r.updatedByName },
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function getDraft(trx: Trx, reach: Reach, id: string): Promise<BillingInvoice> {
  const r = await trx.selectFrom('billingInvoices').select(['id', 'locationId']).where('id', '=', id).executeTakeFirst();
  if (!r || !reaches(reach, r.locationId)) throw new BillingError('NOT_FOUND', 'Unknown accounting invoice');
  return toContract(trx, id);
}

export async function listDrafts(
  trx: Trx,
  reach: Reach,
  q: { status?: string | undefined; kind?: string | undefined; locationId?: string | undefined; from?: string | undefined; to?: string | undefined; q?: string | undefined; limit: number },
) {
  let qb = trx
    .selectFrom('billingInvoices as b')
    .leftJoin('invoices as s', 's.id', 'b.originSaleId')
    .leftJoin('locations as l', 'l.id', 'b.locationId')
    .select([
      'b.id', 'b.kind', 'b.status', 'b.number', 'b.currency', 'b.vatRegistered', 'b.legalEntityId', 'b.locationId', 'b.billingCustomerId',
      'b.originSaleId', 'b.supplyDate', 'b.issueDate', 'b.dueDate', 'b.netMinor', 'b.vatMinor', 'b.grossMinor', 'b.discountMinor',
      'b.buyer', 'b.createdAt', 'b.updatedAt', 's.number as saleNumber', 'l.name as locationName',
    ])
    .orderBy('b.createdAt', 'desc')
    .limit(q.limit);
  if (!reach.all) qb = qb.where('b.locationId', 'in', reach.locationIds.length ? reach.locationIds : ['00000000-0000-4000-8000-000000000000']);
  if (q.status) qb = qb.where('b.status', '=', q.status);
  if (q.kind) qb = qb.where('b.kind', '=', q.kind);
  if (q.locationId) qb = qb.where('b.locationId', '=', q.locationId);
  if (q.from) qb = qb.where('b.supplyDate', '>=', new Date(q.from));
  if (q.to) qb = qb.where('b.supplyDate', '<=', new Date(q.to));
  if (q.q) qb = qb.where((eb) => eb.or([eb('s.number', 'ilike', `%${q.q}%`), eb('b.number', 'ilike', `%${q.q}%`), eb(sql`b.buyer->>'name'`, 'ilike', `%${q.q}%`)]));
  const rows = await qb.execute();
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as BillingInvoice['kind'],
    status: r.status as BillingInvoice['status'],
    number: r.number,
    currency: r.currency,
    vatRegistered: r.vatRegistered,
    legalEntityId: r.legalEntityId,
    locationId: r.locationId,
    billingCustomerId: r.billingCustomerId,
    originSaleId: r.originSaleId,
    supplyDate: localIso(r.supplyDate),
    issueDate: r.issueDate ? localIso(r.issueDate) : null,
    dueDate: r.dueDate ? localIso(r.dueDate) : null,
    totals: { netMinor: num(r.netMinor), vatMinor: num(r.vatMinor), grossMinor: num(r.grossMinor), discountMinor: num(r.discountMinor) },
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    buyerName: ((r.buyer ?? null) as BillingBuyerSnapshot | null)?.name ?? '',
    locationName: r.locationName ?? '',
    saleNumber: r.saleNumber ?? null,
  }));
}

/** Drafts only; the buyer, the dates and the notes — nothing structural, nothing financial. */
export async function patchDraft(
  trx: Trx,
  claims: AccessClaims,
  reach: Reach,
  id: string,
  p: { billingCustomerId?: string | null | undefined; supplyDate?: string | undefined; dueDate?: string | null | undefined; notes?: string | undefined },
): Promise<BillingInvoice> {
  const r = await trx.selectFrom('billingInvoices').select(['id', 'status', 'locationId', 'originSaleId']).where('id', '=', id).executeTakeFirst();
  if (!r || !reaches(reach, r.locationId)) throw new BillingError('NOT_FOUND', 'Unknown accounting invoice');
  if (r.status !== 'draft') throw new BillingError('INVALID', 'Only a draft can be changed; an issued document is corrected by a credit note');
  const before = await toContract(trx, id);
  const set: Record<string, unknown> = {};
  if (p.billingCustomerId !== undefined) {
    if (p.billingCustomerId) {
      set.buyer = JSON.stringify(await buyerFromIdentity(trx, p.billingCustomerId));
      set.billingCustomerId = p.billingCustomerId;
    } else {
      const sale = r.originSaleId ? await trx.selectFrom('invoices').select('customerId').where('id', '=', r.originSaleId).executeTakeFirst() : null;
      const b = await buyerFromSale(trx, sale?.customerId ?? null);
      set.buyer = b.buyer ? JSON.stringify(b.buyer) : null;
      set.billingCustomerId = b.billingCustomerId;
    }
  }
  if (p.supplyDate !== undefined) set.supplyDate = new Date(p.supplyDate);
  if (p.dueDate !== undefined) set.dueDate = p.dueDate ? new Date(p.dueDate) : null;
  if (p.notes !== undefined) set.notes = p.notes;
  const name = await actorName(trx, claims.sub);
  await trx
    .updateTable('billingInvoices')
    .set({ ...set, updatedBy: claims.sub, updatedByName: name, updatedAt: new Date() })
    .where('id', '=', id)
    .execute();
  const after = await toContract(trx, id);
  await logAudit(trx, claims.ten, {
    actorEmployeeId: claims.sub,
    actorName: name,
    action: 'Accounting draft changed',
    object: `Draft · ${before.origin?.saleNumber ?? id}`,
    before: `${before.buyer?.name ?? '—'} · ${before.supplyDate}`,
    after: `${after.buyer?.name ?? '—'} · ${after.supplyDate}`,
  });
  return after;
}
