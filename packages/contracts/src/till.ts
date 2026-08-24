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

export const SaleRequestSchema = z.object({
  key: z.string().min(8),
  locationId: z.uuid(),
  lines: z.array(SaleLineSchema).min(1),
  method: z.string().min(1), // Cash | Card | …
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
  unitPrice: MoneySchema,
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
