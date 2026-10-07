import { z } from 'zod';
import { MoneySchema } from './catalog.js';

/** One basket line as the till sends it. The server recomputes every
 *  price at the door — the screen's numbers decide nothing. */
export const SaleLineSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('appointment'),
    appointmentId: z.uuid(),
    lineDiscount: MoneySchema.nonnegative().default(0),
  }),
  z.object({
    kind: z.literal('service'),
    serviceId: z.uuid(),
    variantId: z.uuid().nullable().optional(),
    modifierOptionIds: z.array(z.uuid()).default([]),
    qty: z.number().int().positive().default(1),
    lineDiscount: MoneySchema.nonnegative().default(0),
  }),
  z.object({
    kind: z.literal('product'),
    productId: z.uuid(),
    qty: z.number().int().positive().default(1),
    lineDiscount: MoneySchema.nonnegative().default(0),
  }),
]);
export type SaleLine = z.infer<typeof SaleLineSchema>;

/** The payment methods the apps emit — the till's four, the Velnes
 *  app's two. One list (Phase 0, 2026-10-06); a CHECK NOT VALID on the
 *  ledger fences new rows to it. */
export const PAYMENT_METHODS = ['Cash', 'Card', 'Gift card', 'Bank transfer', 'Online card', 'Apple Pay'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
/** The canonical spelling for a method typed any way ("cash", " CARD ") — or the input unchanged, for the enum to refuse. */
export const normalizePaymentMethod = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  const key = v.trim().toLowerCase();
  return PAYMENT_METHODS.find((m) => m.toLowerCase() === key) ?? v;
};
export const PaymentMethodSchema = z.preprocess(normalizePaymentMethod, z.enum(PAYMENT_METHODS));

export const SaleRequestSchema = z.object({
  key: z.string().min(8),
  locationId: z.uuid(),
  lines: z.array(SaleLineSchema).min(1),
  method: PaymentMethodSchema,
  customerId: z.uuid().nullable().optional(),
  employeeId: z.uuid().nullable().optional(),
  tip: MoneySchema.nonnegative().default(0),
  serviceCharge: MoneySchema.nonnegative().default(0),
  cartDiscount: MoneySchema.nonnegative().default(0),
  pointsRedeemed: z.number().int().nonnegative().default(0),
  giftCardCode: z.string().nullable().optional(),
  giftAmount: MoneySchema.nonnegative().default(0),
  promoCode: z.string().nullable().optional(),
});
export type SaleRequest = z.infer<typeof SaleRequestSchema>;

export const InvoiceLineSchema = z.object({
  description: z.string(),
  qty: z.number().int(),
  /** After the line discount, rounded — show `amount`, not qty × this. */
  unitPrice: MoneySchema,
  /** The line's exact total after its discount (Phase 0, 2026-10-06). */
  amount: MoneySchema.default(0),
  lineDiscount: MoneySchema.default(0),
  /** The VAT rate (percent) that applied when the sale was made. */
  vat: z.number().int().default(18),
  itemClass: z.string(),
});
export const InvoiceSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  date: z.iso.date(),
  locationId: z.uuid(),
  customerName: z.string(),
  employeeName: z.string(),
  method: z.string(),
  status: z.enum(['Paid', 'Refunded']),
  total: MoneySchema,
  lines: z.array(InvoiceLineSchema),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

export const CheckoutStatusSchema = z.enum(['PAID', 'PARTIALLY_PAID', 'FAILED']);
export const MtxStatusSchema = z.enum(['paid', 'failed', 'config_incomplete']);

export const MerchantTransactionSchema = z.object({
  id: z.uuid(),
  paymentAccountId: z.uuid().nullable(),
  legalEntityId: z.uuid().nullable(),
  amount: MoneySchema,
  method: z.string(),
  status: MtxStatusSchema,
});

export const SaleResponseSchema = z.object({
  invoice: InvoiceSchema,
  checkoutId: z.uuid(),
  checkoutStatus: CheckoutStatusSchema,
  transactions: z.array(MerchantTransactionSchema),
  total: MoneySchema,
  pointsEarned: z.number().int(),
  shortages: z.array(z.string()), // "ran out during this sale"
});
export type SaleResponse = z.infer<typeof SaleResponseSchema>;

export const CheckoutStatusResponseSchema = z.object({
  status: CheckoutStatusSchema,
  transactions: z.array(MerchantTransactionSchema),
});

export const ValidateCodeRequestSchema = z.object({
  code: z.string().min(1),
  subtotal: MoneySchema.nonnegative(),
});
export const ValidateCodeResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('promo'),
    code: z.string(),
    amount: MoneySchema,
    label: z.string(),
  }),
  z.object({
    kind: z.literal('gift'),
    code: z.string(),
    remaining: MoneySchema,
    customer: z.string().nullable(),
  }),
  z.object({ kind: z.literal('invalid'), message: z.string() }),
]);

export const InvoiceListQuerySchema = z.object({
  locationId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export const InvoiceListResponseSchema = z.object({ invoices: z.array(InvoiceSchema) });

export const RefundRequestSchema = z.object({ reason: z.string().min(1) });

/** Closing the cash drawer — cash_drawer.close's door. The server
 *  computes the day's expected cash from the invoices; the counted
 *  amount and the difference go on the record. */
export const DrawerCloseRequestSchema = z.object({
  locationId: z.uuid(),
  countedCash: MoneySchema.nonnegative(),
});
export const DrawerCloseResponseSchema = z.object({
  date: z.string(),
  expectedCash: MoneySchema,
  countedCash: MoneySchema,
  difference: MoneySchema, // counted − expected
  cashSales: z.number().int(),
});
export type DrawerCloseResponse = z.infer<typeof DrawerCloseResponseSchema>;

/**
 * Due payments (Alex, 2026-10-01): visits that happened — booked or
 * confirmed, their end already passed in the location's clock — and
 * were never paid: no live invoice line references them. The till's
 * Due tab rings them up like a Today's appointment. `due` is what is
 * still owed (the price less a deposit taken at booking); the sale door
 * charges the appointment's price as it always has — netting a deposit
 * at the till is not built yet, so `deposit` is shown, not subtracted.
 */
export const DuePaymentSchema = z.object({
  appointmentId: z.uuid(),
  locationId: z.uuid(),
  locationName: z.string(),
  customerId: z.uuid().nullable(),
  customerName: z.string(),
  serviceName: z.string(),
  employeeName: z.string().nullable(),
  date: z.iso.date(),
  start: z.string(),
  end: z.string(),
  price: MoneySchema,
  deposit: MoneySchema,
  due: MoneySchema,
  /** Whole days since the visit, in the location's clock; 0 = today. */
  daysAgo: z.number().int(),
  source: z.string(),
  /** Products reserved with the booking, so the basket can carry them. */
  products: z.array(z.object({ productId: z.uuid(), name: z.string(), qty: z.number().int(), unitPrice: MoneySchema })).default([]),
});
export type DuePayment = z.infer<typeof DuePaymentSchema>;
export const DueQuerySchema = z.object({ locationId: z.uuid().optional() });
export const DuePaymentsSchema = z.object({ due: z.array(DuePaymentSchema), total: MoneySchema });
export type DuePayments = z.infer<typeof DuePaymentsSchema>;
