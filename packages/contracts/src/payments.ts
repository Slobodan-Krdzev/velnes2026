import { z } from 'zod';
import { MoneySchema } from './catalog.js';

/**
 * Paying for a booking from the Velnes app — Alex, 2026-09-22.
 *
 * Three ways: a card, Apple Pay, or paying at the venue. The first two
 * go through a payment provider that is still "mock" (like mail
 * transport): the provider accepts a well-formed card, returns a
 * reference, and nothing leaves the building. What is real is the
 * sale it produces — the till's own `finishSale` writes the invoice,
 * the merchant transaction and the code redemptions, so the salon's
 * calendar, till and reports see a paid appointment exactly as if the
 * front desk had taken the money. The full price is charged (deposits
 * stay deferred); the salon's own promo codes and gift cards apply.
 */

export const PayMethodSchema = z.enum(['card', 'apple_pay', 'venue']);
export type PayMethod = z.infer<typeof PayMethodSchema>;

/** What the card form sends. The number never lands anywhere: the
 *  provider (mock today) turns it into a reference, and only the brand
 *  and last four digits are kept. */
export const CardInputSchema = z.object({
  number: z.string().min(12).max(23),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int().min(2024).max(2099),
  cvc: z.string().min(3).max(4),
  holder: z.string().min(1).max(80),
});
export type CardInput = z.infer<typeof CardInputSchema>;

export const PayCodesSchema = z.object({
  promoCode: z.string().trim().max(40).optional(),
  giftCode: z.string().trim().max(40).optional(),
});

export const PayQuoteRequestSchema = PayCodesSchema.extend({ appointmentId: z.uuid() });
export type PayQuoteRequest = z.infer<typeof PayQuoteRequestSchema>;

/** Where the appointment stands for paying. */
export const PayableStatusSchema = z.enum(['payable', 'requested', 'paid', 'cancelled']);

export const PayQuoteSchema = z.object({
  appointmentId: z.uuid(),
  salonName: z.string(),
  locationName: z.string(),
  items: z.array(
    z.object({
      id: z.uuid(),
      serviceName: z.string(),
      date: z.iso.date(),
      time: z.string(),
      end: z.string(),
      price: MoneySchema,
    }),
  ),
  subtotal: MoneySchema,
  promo: z.object({ code: z.string(), label: z.string(), amount: MoneySchema }).nullable(),
  gift: z.object({ code: z.string(), amount: MoneySchema, remaining: MoneySchema }).nullable(),
  /** What is left to pay after the codes. */
  total: MoneySchema,
  status: PayableStatusSchema,
  /** Why a code did not apply, in the till's words — null when both applied. */
  codeError: z.string().nullable(),
});
export type PayQuote = z.infer<typeof PayQuoteSchema>;

export const PayRequestSchema = PayQuoteRequestSchema.extend({
  method: PayMethodSchema,
  card: CardInputSchema.optional(),
  /** The wallet's token — mock today. */
  applePayToken: z.string().max(200).optional(),
  /** Ask the account to keep this card (never for a guest). */
  saveCard: z.boolean().default(false),
  /** Pay with a card the account already keeps instead of a new one. */
  savedCardId: z.uuid().optional(),
});
export type PayRequest = z.infer<typeof PayRequestSchema>;

export const PayResultSchema = z.object({
  status: z.enum(['paid', 'venue']),
  method: PayMethodSchema,
  amount: MoneySchema,
  invoiceNumber: z.string().nullable(),
  card: z.object({ brand: z.string(), last4: z.string() }).nullable(),
});
export type PayResult = z.infer<typeof PayResultSchema>;

/** The guest doors carry the salon key and the appointment's own token. */
export const PublicPayQuoteRequestSchema = PayQuoteRequestSchema.extend({
  key: z.string().min(4),
  token: z.string().min(8),
});
export const PublicPayRequestSchema = PayRequestSchema.extend({
  key: z.string().min(4),
  token: z.string().min(8),
});
