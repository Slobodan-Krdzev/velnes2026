import { env } from '../../env.js';
import { randomBytes } from 'node:crypto';
import type { PayQuote, PayRequest, PayResult } from '@velnes/contracts';
import type { Trx } from '../../db/index.js';
import { BookingRefused, refuse } from '../booking/booking.service.js';
import { notifySalon } from '../clients/clients.service.js';
import { queueMail } from '../mail/mail.service.js';
import { settleSale, validateCode } from '../till/till.service.js';
import { hhmm, localIso } from '../scheduling/scheduling.service.js';

/**
 * Paying for a booking from the Velnes app — Alex, 2026-09-22.
 *
 * The payment provider is mock, and says so: `mockCharge` accepts a
 * well-formed card (Luhn, a future expiry, a 3–4 digit code) and hands
 * back a reference; a card ending in 0000 is declined, so the refusal
 * path can be seen. Apple Pay is a token we accept as-is. Nothing here
 * talks to the outside world — the same honest emptiness as the mail
 * transport, swapped for a real provider in one place.
 *
 * What is real is the sale: `settleSale`, the till's own door, writes
 * the invoice, the merchant transaction (stamped with the provider's
 * reference), the code redemptions and the personal-offer redemption.
 * The appointment is then paid the way the till understands paid — a
 * live invoice line references it — so the drawer says so, the till
 * stops offering it and the reports count it.
 */

/** The whole visit: appointments booked together share an idempotency
 *  key prefix, so paying the first pays them all. */
async function visitOf(trx: Trx, appointmentId: string) {
  const a = await trx
    .selectFrom('appointments as a')
    .leftJoin('services as s', 's.id', 'a.serviceId')
    .selectAll('a')
    .select('s.name as serviceName')
    .where('a.id', '=', appointmentId)
    .executeTakeFirst();
  if (!a) throw new BookingRefused(refuse('NOT_PAYABLE', {}, 'Unknown appointment'));
  const m = a.idempotencyKey?.match(/^(.*):(\d+)$/);
  if (!m) return [a];
  return trx
    .selectFrom('appointments as a')
    .leftJoin('services as s', 's.id', 'a.serviceId')
    .selectAll('a')
    .select('s.name as serviceName')
    .where('a.idempotencyKey', 'like', `${m[1]}:%`)
    .orderBy('a.startMin')
    .execute();
}

async function alreadyPaid(trx: Trx, ids: string[]): Promise<boolean> {
  const line = await trx
    .selectFrom('invoiceLines as l')
    .innerJoin('invoices as i', 'i.id', 'l.invoiceId')
    .select('l.id')
    .where('l.appointmentId', 'in', ids)
    .where('i.status', '!=', 'Refunded')
    .limit(1)
    .executeTakeFirst();
  return !!line;
}

/** What the customer would pay: the visit, the codes, the total. */
export async function quotePayment(
  trx: Trx,
  req: { appointmentId: string; promoCode?: string | undefined; giftCode?: string | undefined },
): Promise<PayQuote> {
  const visit = await visitOf(trx, req.appointmentId);
  const first = visit[0]!;
  const biz = await trx.selectFrom('businesses').select('name').executeTakeFirstOrThrow();
  const loc = await trx.selectFrom('locations').select('name').where('id', '=', first.locationId).executeTakeFirst();
  const items = visit.map((a) => ({
    id: a.id,
    serviceName: a.serviceName ?? a.title,
    date: localIso(a.date),
    time: hhmm(a.startMin),
    end: hhmm(a.startMin + a.durationMin),
    price: a.price,
  }));
  const subtotal = items.reduce((s, i) => s + i.price, 0);

  let status: PayQuote['status'] = 'payable';
  if (visit.some((a) => a.status === 'cancelled')) status = 'cancelled';
  else if (visit.some((a) => a.status === 'requested')) status = 'requested';
  else if (await alreadyPaid(trx, visit.map((a) => a.id))) status = 'paid';

  let promo: PayQuote['promo'] = null;
  let gift: PayQuote['gift'] = null;
  let codeError: string | null = null;
  if (req.promoCode) {
    const v = await validateCode(trx, req.promoCode, subtotal);
    if (v.kind === 'promo') promo = { code: v.code, label: v.label, amount: Math.min(v.amount, subtotal) };
    else codeError = v.kind === 'invalid' ? v.message : `${req.promoCode} is a gift card — enter it as one`;
  }
  const afterPromo = Math.max(0, subtotal - (promo?.amount ?? 0));
  if (req.giftCode) {
    const v = await validateCode(trx, req.giftCode, afterPromo);
    if (v.kind === 'gift') gift = { code: v.code, amount: Math.min(v.remaining, afterPromo), remaining: v.remaining };
    else codeError = v.kind === 'invalid' ? v.message : `${req.giftCode} is a promo code — enter it as one`;
  }
  const total = Math.max(0, afterPromo - (gift?.amount ?? 0));
  return {
    appointmentId: first.id,
    salonName: biz.name,
    locationName: loc?.name ?? '',
    items,
    subtotal,
    promo,
    gift,
    total,
    status,
    codeError,
  };
}

/** The mock provider. Swap this for the real one; nothing else knows. */
export function mockCharge(card: { number: string; expMonth: number; expYear: number; cvc: string }): {
  ref: string;
  brand: string;
  last4: string;
} {
  const digits = card.number.replace(/[\s-]/g, '');
  if (!/^\d{12,19}$/.test(digits) || !luhn(digits))
    throw new BookingRefused(refuse('CARD_DECLINED', {}, 'That card number is not valid'));
  const now = new Date();
  const exp = new Date(card.expYear, card.expMonth, 0, 23, 59, 59);
  if (exp < now) throw new BookingRefused(refuse('CARD_DECLINED', {}, 'That card has expired'));
  if (!/^\d{3,4}$/.test(card.cvc)) throw new BookingRefused(refuse('CARD_DECLINED', {}, 'Check the security code'));
  const last4 = digits.slice(-4);
  // The one card the mock declines, so the refusal path is a real path.
  if (last4 === '0000') throw new BookingRefused(refuse('CARD_DECLINED', {}, 'The card was declined'));
  const brand = digits.startsWith('4')
    ? 'Visa'
    : /^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)
      ? 'Mastercard'
      : /^3[47]/.test(digits)
        ? 'American Express'
        : 'Card';
  return { ref: `mock_ch_${randomBytes(9).toString('base64url')}`, brand, last4 };
}

function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/**
 * Pay for the visit. `who` names the payer for the bells and the mail;
 * `card` is the tokenised answer of the provider when a saved card was
 * used (step 3), else the form is charged here.
 */
export async function payAppointment(
  trx: Trx,
  tenantId: string,
  req: PayRequest,
  who: { clientUserId: string | null; charged?: { ref: string; brand: string; last4: string } | undefined },
): Promise<PayResult> {
  const quote = await quotePayment(trx, req);
  if (quote.status === 'requested')
    throw new BookingRefused(refuse('NOT_PAYABLE', {}, 'The salon has not accepted this request yet'));
  if (quote.status === 'cancelled') throw new BookingRefused(refuse('NOT_PAYABLE', {}, 'This appointment was cancelled'));
  if (quote.status === 'paid') throw new BookingRefused(refuse('ALREADY_PAID', {}, 'This appointment is already paid'));
  if (quote.codeError) throw new BookingRefused(refuse('BAD_CODE', { message: quote.codeError }, quote.codeError));

  const visit = await visitOf(trx, req.appointmentId);
  const first = visit[0]!;
  const history = (what: string) =>
    Promise.all(
      visit.map((a) =>
        trx
          .insertInto('appointmentHistory')
          .values({ tenantId, appointmentId: a.id, what, byName: first.title, source: 'marketplace' })
          .execute(),
      ),
    );

  if (req.method === 'venue') {
    await history('Will pay at the venue');
    return { status: 'venue', method: 'venue', amount: quote.total, invoiceNumber: null, card: null };
  }

  let charged: { ref: string; brand: string; last4: string };
  if (req.method === 'apple_pay') {
    if (!req.applePayToken) throw new BookingRefused(refuse('CARD_DECLINED', {}, 'Apple Pay did not hand over a token'));
    charged = { ref: `mock_ap_${randomBytes(9).toString('base64url')}`, brand: 'Apple Pay', last4: '' };
  } else if (who.charged) charged = who.charged;
  else {
    if (!req.card) throw new BookingRefused(refuse('CARD_DECLINED', {}, 'Enter a card'));
    charged = mockCharge(req.card);
  }

  const method = req.method === 'apple_pay' ? 'Apple Pay' : 'Online card';
  const sale = await settleSale(
    trx,
    { tenantId, employeeId: null, name: 'Velnes app', source: 'Velnes app' },
    {
      key: `pay:${first.id}`,
      locationId: first.locationId,
      lines: visit.map((a) => ({ kind: 'appointment' as const, appointmentId: a.id, lineDiscount: 0 })),
      method,
      customerId: first.customerId,
      employeeId: first.employeeId,
      tip: 0,
      serviceCharge: 0,
      cartDiscount: 0,
      pointsRedeemed: 0,
      giftCardCode: quote.gift?.code ?? null,
      giftAmount: quote.gift?.amount ?? 0,
      promoCode: quote.promo?.code ?? null,
    },
  );
  // The provider's reference lands on the transaction rows the sale
  // made — the reserved column, used.
  await trx
    .updateTable('merchantTransactions')
    .set({ providerRef: charged.ref })
    .where('checkoutId', '=', sale.checkoutId)
    .execute();
  await trx
    .updateTable('appointments')
    .set({ paid: 'paid' })
    .where(
      'id',
      'in',
      visit.map((a) => a.id),
    )
    .execute();
  const cardLbl = charged.last4 ? `${charged.brand} ••${charged.last4}` : charged.brand;
  await history(`Paid online · ${cardLbl} · ${sale.total}`);

  const biz = await trx.selectFrom('businesses').select('name').executeTakeFirstOrThrow();
  const what = visit.map((a) => a.serviceName ?? a.title).join(' + ');
  const when = `${localIso(first.date)} at ${hhmm(first.startMin)}`;
  await notifySalon(trx, tenantId, {
    kind: 'payment',
    title: 'Paid online',
    body: `${first.title} paid ${sale.total} MKD for ${what} on ${when} (${cardLbl}). Invoice ${sale.invoice.number}.`,
    refId: first.id,
  });
  const cust = first.customerId
    ? await trx.selectFrom('customers').select('email').where('id', '=', first.customerId).executeTakeFirst()
    : undefined;
  if (cust?.email)
    await queueMail(trx, {
      tenantId,
      to: cust.email,
      subject: `Paid — ${what} at ${biz.name}`,
      body: `Thank you. ${sale.total} MKD for ${what} on ${when} at ${biz.name} was paid with ${cardLbl}.${
        quote.promo ? `\nPromo ${quote.promo.code}: −${quote.promo.amount} MKD.` : ''
      }${quote.gift ? `\nGift card ${quote.gift.code}: −${quote.gift.amount} MKD.` : ''}\n\nInvoice ${sale.invoice.number}. See you there.`,
      kind: 'payment_received',
      refId: first.id,
      cta: { label: 'See your appointment', url: `${env.consumerAppUrl}/account` },
    });

  return {
    status: 'paid',
    method: req.method,
    amount: sale.total,
    invoiceNumber: sale.invoice.number,
    card: { brand: charged.brand, last4: charged.last4 },
  };
}

/** Raw SQL-free helper kept for the routes: is this appointment in this tenant? */
export async function appointmentTenant(trx: Trx, id: string): Promise<string | null> {
  const r = await trx.selectFrom('appointments').select('tenantId').where('id', '=', id).executeTakeFirst();
  return r?.tenantId ?? null;
}

