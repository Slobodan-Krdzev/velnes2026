import type { AccessClaims, Invoice, SaleRequest, SaleResponse } from '@velnes/contracts';
import { sql } from 'kysely';
import type { Trx } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';
import { priceFor, prodAt, svcChoice, svcLine } from '../catalog/catalog.service.js';
import { locLive } from '../locations/locations.service.js';
import { localIso, todayIso } from '../scheduling/scheduling.service.js';

export class TillError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'REFUSED' | 'BAD_CODE',
    message: string,
  ) {
    super(message);
  }
}

interface ResolvedLine {
  description: string;
  qty: number;
  price: number; // unit price before line discount
  lineDiscount: number;
  itemClass: 'service' | 'product' | 'other';
  serviceId: string | null;
  productId: string | null;
  appointmentId: string | null;
  vat: number;
  poId: string | null;
  pmoId: string | null;
}

export const lineTotal = (l: ResolvedLine) => Math.max(0, l.price * l.qty - l.lineDiscount);

/** Resolve every basket line at the door: real prices, real classes. */
async function resolveLines(
  trx: Trx,
  locationId: string,
  lines: SaleRequest['lines'],
  customerId: string | null = null,
) {
  const out: ResolvedLine[] = [];
  for (const l of lines) {
    if (l.kind === 'appointment') {
      const a = await trx
        .selectFrom('appointments as a')
        .leftJoin('services as s', 's.id', 'a.serviceId')
        .selectAll('a')
        .select('s.name as serviceName')
        .where('a.id', '=', l.appointmentId)
        .executeTakeFirst();
      if (!a) throw new TillError('NOT_FOUND', 'That appointment is gone');
      out.push({
        description: a.serviceName ?? a.title,
        qty: 1,
        price: a.price,
        lineDiscount: l.lineDiscount,
        itemClass: 'service',
        serviceId: a.serviceId,
        productId: null,
        appointmentId: a.id,
        vat: 18,
        poId: a.poId,
        pmoId: a.pmoId,
      });
    } else if (l.kind === 'service') {
      const line = await svcLine(trx, {
        serviceId: l.serviceId,
        locationId,
        variantId: l.variantId ?? null,
        modifierOptionIds: l.modifierOptionIds,
      });
      const s = await trx
        .selectFrom('services')
        .select(['name', 'vat'])
        .where('id', '=', l.serviceId)
        .executeTakeFirstOrThrow();
      // The till asks the same pricing door as the booking flow: a
      // known customer gets their personal offer applied here, plus
      // the modifier delta on top.
      let price = line.price;
      let poId: string | null = null;
      if (customerId) {
        const pr = await priceFor(trx, {
          serviceId: l.serviceId,
          locationId,
          variantId: l.variantId ?? null,
          customerId,
        });
        const choice = await svcChoice(trx, l.serviceId, locationId, l.variantId ?? null);
        price = Math.max(0, pr.effective + (line.price - choice.price));
        if (pr.best.kind === 'personal') poId = pr.best.ref;
      }
      out.push({
        description: s.name + (line.label ? ` · ${line.label}` : ''),
        qty: l.qty,
        price,
        lineDiscount: l.lineDiscount,
        itemClass: 'service',
        serviceId: l.serviceId,
        productId: null,
        appointmentId: null,
        vat: s.vat,
        poId,
        pmoId: null,
      });
    } else {
      const p = await trx
        .selectFrom('products')
        .select(['id', 'name', 'vat', 'own'])
        .where('id', '=', l.productId)
        .executeTakeFirst();
      if (!p) throw new TillError('NOT_FOUND', 'Unknown product');
      if (p.own) throw new TillError('REFUSED', `${p.name} is for own use — it is not sold`);
      const cfg = await prodAt(trx, l.productId, locationId);
      if (!cfg.pos || !cfg.active)
        throw new TillError('REFUSED', `${p.name} is not sold at this location`);
      out.push({
        description: p.name,
        qty: l.qty,
        price: cfg.price,
        lineDiscount: l.lineDiscount,
        itemClass: 'product',
        serviceId: null,
        productId: p.id,
        appointmentId: null,
        vat: p.vat,
        poId: null,
        pmoId: null,
      });
    }
  }
  return out;
}

/** Explicit seller assignment wins; otherwise the house default —
 *  a single-seller salon never feels any of this. */
async function sellerForLine(trx: Trx, tenantId: string, l: ResolvedLine) {
  if (l.itemClass === 'product' && l.productId) {
    const p = await trx
      .selectFrom('products')
      .select('sellerLegalEntityId')
      .where('id', '=', l.productId)
      .executeTakeFirst();
    if (p?.sellerLegalEntityId)
      return trx
        .selectFrom('legalEntities')
        .selectAll()
        .where('id', '=', p.sellerLegalEntityId)
        .executeTakeFirst();
  }
  return trx
    .selectFrom('legalEntities')
    .selectAll()
    .where('ownerType', '=', 'salon')
    .where('tenantId', '=', tenantId)
    .where('isDefault', '=', true)
    .executeTakeFirst();
}

async function taxFor(trx: Trx, itemClass: string, legalEntityId: string | null) {
  const own = legalEntityId
    ? await trx
        .selectFrom('taxRules')
        .select('taxProfileId')
        .where('legalEntityId', '=', legalEntityId)
        .where('itemClass', '=', itemClass)
        .executeTakeFirst()
    : undefined;
  if (own) return own.taxProfileId;
  const base = await trx
    .selectFrom('taxRules')
    .select('taxProfileId')
    .where('legalEntityId', 'is', null)
    .where('itemClass', '=', itemClass)
    .executeTakeFirst();
  return base?.taxProfileId ?? null;
}

/** routeCheckout — split the receipt by legal seller → payment
 *  account groups. */
export async function routeCheckout(trx: Trx, tenantId: string, lines: ResolvedLine[]) {
  const groups = new Map<
    string,
    {
      paymentAccountId: string | null;
      legalEntityId: string | null;
      ready: boolean;
      amount: number;
      items: {
        line: ResolvedLine;
        amount: number;
        taxProfileId: string | null;
        sellerLegalEntityId: string | null;
      }[];
    }
  >();
  for (const l of lines) {
    const le = await sellerForLine(trx, tenantId, l);
    const acc = le
      ? await trx
          .selectFrom('paymentAccounts')
          .selectAll()
          .where('legalEntityId', '=', le.id)
          .executeTakeFirst()
      : undefined;
    const ready = !!(le && le.status === 'verified' && acc?.status === 'active' && acc.merchantId);
    const key = acc ? acc.id : le ? `le:${le.id}` : 'unrouted';
    if (!groups.has(key))
      groups.set(key, {
        paymentAccountId: acc?.id ?? null,
        legalEntityId: le?.id ?? null,
        ready,
        amount: 0,
        items: [],
      });
    const g = groups.get(key)!;
    const amount = lineTotal(l);
    g.amount += amount;
    g.items.push({
      line: l,
      amount,
      taxProfileId: await taxFor(trx, l.itemClass, le?.id ?? null),
      sellerLegalEntityId: le?.id ?? null,
    });
  }
  return [...groups.values()];
}

export function checkoutStatusOf(statuses: string[]): 'PAID' | 'PARTIALLY_PAID' | 'FAILED' {
  if (!statuses.length) return 'FAILED';
  if (statuses.every((s) => s === 'paid')) return 'PAID';
  if (statuses.some((s) => s === 'paid')) return 'PARTIALLY_PAID';
  return 'FAILED';
}

async function pointsBalance(trx: Trx, customerId: string) {
  const r = await trx
    .selectFrom('loyaltyLedger')
    .select(sql<number>`COALESCE(SUM(points),0)::int`.as('n'))
    .where('customerId', '=', customerId)
    .executeTakeFirst();
  return r?.n ?? 0;
}

async function addPoints(
  trx: Trx,
  tenantId: string,
  customerId: string,
  points: number,
  reason: string,
  ref: string,
) {
  if (!points) return;
  await trx
    .insertInto('loyaltyLedger')
    .values({ tenantId, customerId, points: Math.round(points), reason, ref })
    .execute();
  await trx
    .updateTable('customers')
    .set({ points: await pointsBalance(trx, customerId) })
    .where('id', '=', customerId)
    .execute();
}

/** One door validating promo codes and gift cards alike. */
export async function validateCode(trx: Trx, code: string, subtotal: number) {
  const today = todayIso();
  const dc = await trx
    .selectFrom('discountCodes')
    .selectAll()
    .where(sql<boolean>`upper(code) = upper(${code})`)
    .executeTakeFirst();
  if (dc) {
    if (localIso(dc.starts) > today)
      return { kind: 'invalid' as const, message: `${dc.code} is not active yet` };
    if (localIso(dc.ends) < today)
      return { kind: 'invalid' as const, message: `${dc.code} has expired` };
    if (dc.usageLimit != null && dc.used >= dc.usageLimit)
      return { kind: 'invalid' as const, message: `${dc.code} has been fully used` };
    const amount =
      dc.type === 'Percentage' ? Math.round((subtotal * dc.value) / 100) : dc.value;
    return {
      kind: 'promo' as const,
      code: dc.code,
      amount,
      label: dc.type === 'Percentage' ? `${dc.value}% off` : `−${dc.value}`,
    };
  }
  const gc = await trx
    .selectFrom('giftCards as g')
    .leftJoin('customers as c', 'c.id', 'g.customerId')
    .selectAll('g')
    .select('c.name as customerName')
    .where(sql<boolean>`upper(g.code) = upper(${code})`)
    .executeTakeFirst();
  if (gc) {
    if (gc.remaining <= 0)
      return { kind: 'invalid' as const, message: 'That gift card is empty' };
    return {
      kind: 'gift' as const,
      code: gc.code,
      remaining: gc.remaining,
      customer: gc.customerName,
    };
  }
  return { kind: 'invalid' as const, message: 'Unknown code' };
}

async function invoiceContract(trx: Trx, id: string): Promise<Invoice> {
  const inv = await trx
    .selectFrom('invoices')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  const lines = await trx
    .selectFrom('invoiceLines')
    .selectAll()
    .where('invoiceId', '=', id)
    .orderBy('sort')
    .execute();
  return {
    id: inv.id,
    number: inv.number,
    date: localIso(inv.date),
    locationId: inv.locationId,
    customerName: inv.customerName,
    employeeName: inv.employeeName,
    method: inv.method,
    status: inv.status,
    total: inv.total,
    lines: lines.map((l) => ({
      description: l.description,
      qty: l.qty,
      unitPrice: l.unitPrice,
      itemClass: l.itemClass,
    })),
  };
}

/**
 * finishSale — the one sale door. Whole or not at all; the same key
 * never produces two invoices. Payment promises: paid is locked and
 * never collected twice; only failed groups may retry; a group whose
 * seller configuration is incomplete is honestly marked so.
 */
export async function finishSale(
  trx: Trx,
  claims: AccessClaims,
  req: SaleRequest,
): Promise<SaleResponse> {
  const prior = await trx
    .selectFrom('invoices')
    .select('id')
    .where('idempotencyKey', '=', req.key)
    .executeTakeFirst();
  if (prior) return replayed(trx, prior.id);

  // Checkout is a customer surface: a non-live location does not sell.
  if (!(await locLive(trx, req.locationId))) {
    const loc = await trx
      .selectFrom('locations')
      .select('name')
      .where('id', '=', req.locationId)
      .executeTakeFirst();
    throw new TillError(
      'REFUSED',
      `${loc?.name ?? 'That location'} is not active — checkout is closed there`,
    );
  }
  const tenantId = claims.ten;
  const lines = await resolveLines(trx, req.locationId, req.lines, req.customerId ?? null);
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);

  // Deductions in order — points, gift card, promo — never below zero;
  // the tip counts back on top (it belongs to the employee).
  const cfg = await trx
    .selectFrom('loyaltyConfig')
    .selectAll()
    .where('tenantId', '=', tenantId)
    .executeTakeFirst();
  let pointsValue = 0;
  if (req.pointsRedeemed && req.customerId && cfg?.active) {
    const balance = await pointsBalance(trx, req.customerId);
    if (req.pointsRedeemed > balance)
      throw new TillError('REFUSED', 'Not enough points on the card');
    pointsValue = Math.floor(req.pointsRedeemed / cfg.step) * cfg.worth;
  }
  let giftAmount = 0;
  let giftCardId: string | null = null;
  if (req.giftCardCode) {
    const gc = await trx
      .selectFrom('giftCards')
      .selectAll()
      .where(sql<boolean>`upper(code) = upper(${req.giftCardCode})`)
      .executeTakeFirst();
    if (!gc) throw new TillError('BAD_CODE', 'Unknown gift card');
    giftAmount = Math.min(req.giftAmount || gc.remaining, gc.remaining);
    giftCardId = gc.id;
  }
  let promoAmount = 0;
  let promoCode: string | null = null;
  if (req.promoCode) {
    const v = await validateCode(trx, req.promoCode, subtotal);
    if (v.kind !== 'promo') throw new TillError('BAD_CODE', 'message' in v ? v.message : 'Not a promo code');
    promoAmount = v.amount;
    promoCode = v.code;
  }
  const total = Math.max(
    0,
    subtotal + req.tip + req.serviceCharge - req.cartDiscount - pointsValue - giftAmount - promoAmount,
  );

  // Invoice number from the location's own counter.
  const loc = await trx
    .selectFrom('locations')
    .select(['name', 'invPrefix'])
    .where('id', '=', req.locationId)
    .executeTakeFirstOrThrow();
  const counter = await trx
    .insertInto('invoiceCounters')
    .values({ tenantId, locationId: req.locationId, next: 2 })
    .onConflict((oc) =>
      oc.column('locationId').doUpdateSet((eb) => ({ next: eb('invoiceCounters.next', '+', 1) })),
    )
    .returning('next')
    .executeTakeFirstOrThrow();
  const seq = counter.next - 1;
  const number = `${loc.invPrefix ?? 'INV-'}${String(seq).padStart(4, '0')}`;

  const customer = req.customerId
    ? await trx
        .selectFrom('customers')
        .select(['id', 'name', 'premium'])
        .where('id', '=', req.customerId)
        .executeTakeFirst()
    : undefined;
  const employee = req.employeeId
    ? await trx
        .selectFrom('employees')
        .select(['id', 'name'])
        .where('id', '=', req.employeeId)
        .executeTakeFirst()
    : undefined;
  const actor = await trx
    .selectFrom('employees')
    .select('name')
    .where('id', '=', claims.sub)
    .executeTakeFirst();

  const inv = await trx
    .insertInto('invoices')
    .values({
      tenantId,
      locationId: req.locationId,
      number,
      date: new Date(todayIso()),
      customerId: customer?.id ?? null,
      customerName: customer?.name ?? 'Walk-in',
      employeeId: employee?.id ?? claims.sub,
      employeeName: employee?.name ?? actor?.name ?? '',
      method: req.method,
      total,
      tip: req.tip,
      serviceCharge: req.serviceCharge,
      cartDiscount: req.cartDiscount,
      pointsRedeemed: req.pointsRedeemed,
      giftAmount,
      promoCode,
      promoAmount,
      idempotencyKey: req.key,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  for (const [i, l] of lines.entries())
    await trx
      .insertInto('invoiceLines')
      .values({
        tenantId,
        invoiceId: inv.id,
        description: l.description,
        qty: l.qty,
        unitPrice: Math.round(lineTotal(l) / l.qty),
        lineDiscount: l.lineDiscount,
        itemClass: l.itemClass,
        serviceId: l.serviceId,
        productId: l.productId,
        appointmentId: l.appointmentId,
        vat: l.vat,
        sort: i,
      })
      .execute();

  // Multi-merchant: the same receipt split by legal seller.
  const routed = await routeCheckout(trx, tenantId, lines);
  const co = await trx
    .insertInto('checkouts')
    .values({
      tenantId,
      invoiceId: inv.id,
      customerId: customer?.id ?? null,
      total,
      status: 'FAILED',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const txs = [];
  for (const g of routed) {
    const m = await trx
      .insertInto('merchantTransactions')
      .values({
        tenantId,
        checkoutId: co.id,
        paymentAccountId: g.paymentAccountId,
        legalEntityId: g.legalEntityId,
        amount: g.amount,
        method: req.method,
        status: g.ready ? 'paid' : 'config_incomplete',
        idempotencyKey: `${co.id}:${g.paymentAccountId ?? g.legalEntityId ?? 'unrouted'}`,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    txs.push(m);
    for (const it of g.items)
      await trx
        .insertInto('checkoutItems')
        .values({
          tenantId,
          checkoutId: co.id,
          name: it.line.description,
          qty: it.line.qty,
          amount: it.amount,
          itemClass: it.line.itemClass,
          sellerLegalEntityId: it.sellerLegalEntityId,
          taxProfileId: it.taxProfileId,
          merchantTransactionId: m.id,
        })
        .execute();
  }
  const status = checkoutStatusOf(txs.map((t) => t.status));
  await trx.updateTable('checkouts').set({ status }).where('id', '=', co.id).execute();

  // Everything around the amount: points off and on, gift balance,
  // promo counter — otherwise the total is right and the rest is not.
  if (req.pointsRedeemed && customer)
    await addPoints(trx, tenantId, customer.id, -req.pointsRedeemed, 'Redeemed at the till', number);
  if (giftCardId && giftAmount)
    await trx
      .updateTable('giftCards')
      .set((eb) => ({ remaining: eb('remaining', '-', giftAmount) }))
      .where('id', '=', giftCardId)
      .execute();
  if (promoCode)
    await trx
      .updateTable('discountCodes')
      .set((eb) => ({ used: eb('used', '+', 1) }))
      .where(sql<boolean>`upper(code) = upper(${promoCode})`)
      .execute();
  let pointsEarned = 0;
  if (customer && cfg?.active) {
    // Velnes Premium members earn 1.5× — the HQ-set rule, read
    // through the one membership door.
    const { isPremium, PREMIUM_LOYALTY_MULT } = await import('../customers/customers.service.js');
    const mult = isPremium(customer.premium) ? PREMIUM_LOYALTY_MULT : 1;
    pointsEarned = Math.round(((total * cfg.points) / cfg.earnPer) * mult);
    if (pointsEarned > 0)
      await addPoints(
        trx,
        tenantId,
        customer.id,
        pointsEarned,
        (lines[0]?.description ?? 'Sale') + (mult > 1 ? ` · ×${PREMIUM_LOYALTY_MULT} Velnes Premium` : ''),
        number,
      );
  }

  // Paying redeems the personal-offer promises the lines carried.
  for (const l of lines)
    if (l.poId) {
      const po = await trx
        .selectFrom('personalOffers')
        .select(['id', 'customerId', 'intent', 'specialPrice', 'serviceId'])
        .where('id', '=', l.poId)
        .where('status', '=', 'live')
        .executeTakeFirst();
      if (po) {
        await trx
          .updateTable('personalOffers')
          .set({ status: 'redeemed' })
          .where('id', '=', po.id)
          .execute();
        const { activityLog } = await import('../customers/customers.service.js');
        await activityLog(trx, tenantId, po.customerId, req.employeeId ?? null, 'offer_redeemed', 'offer', po.id, {
          intent: po.intent,
          serviceId: po.serviceId,
          amount: po.specialPrice,
          override: false,
        });
      }
    }

  // Stock: sold products out; own-use consumed per the recipes.
  const shortages: string[] = [];
  for (const l of lines) {
    if (l.itemClass === 'product' && l.productId) {
      await trx
        .updateTable('locationCatalogProducts')
        .set({ stock: sql<number>`GREATEST(0, stock - ${l.qty})` })
        .where('locationId', '=', req.locationId)
        .where('productId', '=', l.productId)
        .execute();
      await trx
        .insertInto('stockMovements')
        .values({
          tenantId,
          locationId: req.locationId,
          productId: l.productId,
          qty: -l.qty,
          kind: 'sale',
          ref: number,
          actorEmployeeId: claims.sub,
        })
        .execute();
    }
    if (l.itemClass === 'service' && l.serviceId) {
      const recipe = await trx
        .selectFrom('serviceRecipes as r')
        .innerJoin('products as p', 'p.id', 'r.productId')
        .select(['r.productId', 'r.qtyAmount', 'p.name', 'p.sizeAmount', 'p.sizeUnit'])
        .where('r.serviceId', '=', l.serviceId)
        .execute();
      for (const r of recipe) {
        const row = await trx
          .selectFrom('locationCatalogProducts')
          .select(['stock', 'openedAmount'])
          .where('locationId', '=', req.locationId)
          .where('productId', '=', r.productId)
          .executeTakeFirst();
        const size = r.sizeAmount ?? 1;
        const need = Number(r.qtyAmount) * l.qty;
        let opened = row?.openedAmount ?? 0;
        let stock = row?.stock ?? 0;
        let remaining = need;
        while (remaining > 0) {
          if (opened <= 0) {
            if (stock <= 0) {
              shortages.push(`${r.name} — ${Math.ceil(remaining)} ${r.sizeUnit ?? ''} short`);
              break;
            }
            stock -= 1;
            opened = size;
            await trx
              .insertInto('stockMovements')
              .values({
                tenantId,
                locationId: req.locationId,
                productId: r.productId,
                qty: -1,
                kind: 'own_use',
                ref: number,
                note: `Used for ${l.description}`,
                actorEmployeeId: claims.sub,
              })
              .execute();
          }
          const take = Math.min(opened, remaining);
          opened -= take;
          remaining -= take;
        }
        await trx
          .updateTable('locationCatalogProducts')
          .set({ stock, openedAmount: Math.round(opened) })
          .where('locationId', '=', req.locationId)
          .where('productId', '=', r.productId)
          .execute();
      }
    }
  }

  await logAudit(trx, tenantId, {
    actorEmployeeId: claims.sub,
    actorName: actor?.name ?? '',
    action: 'Sale',
    object: `Invoice · ${number}`,
    after: `${total} ден · ${req.method}`,
    locationName: loc.name,
    source: 'Till',
  });

  return {
    invoice: await invoiceContract(trx, inv.id),
    checkoutId: co.id,
    checkoutStatus: status,
    transactions: txs.map((t) => ({
      id: t.id,
      paymentAccountId: t.paymentAccountId,
      legalEntityId: t.legalEntityId,
      amount: t.amount,
      method: t.method,
      status: t.status,
    })),
    total,
    pointsEarned,
    shortages,
  };
}

async function replayed(trx: Trx, invoiceId: string): Promise<SaleResponse> {
  const inv = await invoiceContract(trx, invoiceId);
  const co = await trx
    .selectFrom('checkouts')
    .selectAll()
    .where('invoiceId', '=', invoiceId)
    .executeTakeFirstOrThrow();
  const txs = await trx
    .selectFrom('merchantTransactions')
    .selectAll()
    .where('checkoutId', '=', co.id)
    .execute();
  return {
    invoice: inv,
    checkoutId: co.id,
    checkoutStatus: co.status,
    transactions: txs.map((t) => ({
      id: t.id,
      paymentAccountId: t.paymentAccountId,
      legalEntityId: t.legalEntityId,
      amount: t.amount,
      method: t.method,
      status: t.status,
    })),
    total: inv.total,
    pointsEarned: 0,
    shortages: [],
  };
}

export async function checkoutStatus(trx: Trx, checkoutId: string) {
  const txs = await trx
    .selectFrom('merchantTransactions')
    .selectAll()
    .where('checkoutId', '=', checkoutId)
    .execute();
  if (!txs.length) throw new TillError('NOT_FOUND', 'Unknown checkout');
  return {
    status: checkoutStatusOf(txs.map((t) => t.status)),
    transactions: txs.map((t) => ({
      id: t.id,
      paymentAccountId: t.paymentAccountId,
      legalEntityId: t.legalEntityId,
      amount: t.amount,
      method: t.method,
      status: t.status,
    })),
  };
}

/** Paid is locked and NEVER collected again; only failed retries; the
 *  idempotency key never changes; incomplete config must be fixed
 *  first. */
export async function retryTransaction(trx: Trx, id: string) {
  const m = await trx
    .selectFrom('merchantTransactions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!m) throw new TillError('NOT_FOUND', 'Unknown transaction');
  if (m.status === 'paid') throw new TillError('REFUSED', 'Paid is locked — it is never collected twice');
  if (m.status === 'config_incomplete')
    throw new TillError('REFUSED', 'Complete the seller configuration first');
  await trx.updateTable('merchantTransactions').set({ status: 'paid' }).where('id', '=', id).execute();
  const txs = await trx
    .selectFrom('merchantTransactions')
    .select('status')
    .where('checkoutId', '=', m.checkoutId)
    .execute();
  await trx
    .updateTable('checkouts')
    .set({ status: checkoutStatusOf(txs.map((t) => t.status)) })
    .where('id', '=', m.checkoutId)
    .execute();
}

export async function listInvoices(
  trx: Trx,
  q: { locationId?: string | undefined; limit: number; offset: number },
) {
  let sel = trx
    .selectFrom('invoices')
    .select('id')
    .orderBy('createdAt', 'desc')
    .limit(q.limit)
    .offset(q.offset);
  if (q.locationId) sel = sel.where('locationId', '=', q.locationId);
  const rows = await sel.execute();
  const out = [];
  for (const r of rows) out.push(await invoiceContract(trx, r.id));
  return out;
}

export async function refundInvoice(trx: Trx, claims: AccessClaims, id: string, reason: string) {
  const inv = await trx
    .selectFrom('invoices')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!inv) throw new TillError('NOT_FOUND', 'Unknown invoice');
  if (inv.status === 'Refunded') throw new TillError('REFUSED', 'Already refunded');
  await trx.updateTable('invoices').set({ status: 'Refunded' }).where('id', '=', id).execute();
  const actor = await trx
    .selectFrom('employees')
    .select('name')
    .where('id', '=', claims.sub)
    .executeTakeFirst();
  await logAudit(trx, inv.tenantId, {
    actorEmployeeId: claims.sub,
    actorName: actor?.name ?? '',
    action: 'Refund',
    object: `Invoice · ${inv.number}`,
    before: `${inv.total} ден paid`,
    after: `${inv.total} ден refunded`,
    reason,
  });
  return invoiceContract(trx, id);
}
