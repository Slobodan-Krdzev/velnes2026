import { z } from 'zod';
import { MoneySchema } from './catalog.js';

/**
 * priceFor — THE single pricing door. The full response shape is
 * fixed now; offers (last-minute, personal, member) add entries to
 * `options` in later phases without changing this contract.
 */

export const PriceOptionKindSchema = z.enum(['list', 'offer', 'personal', 'member']);

export const PriceOptionSchema = z.object({
  kind: PriceOptionKindSchema,
  price: MoneySchema,
  label: z.string(),
  spends: z.boolean(), // does taking it consume a credit/points?
  ref: z.string().nullable(), // offer/phase id when applicable
});
export type PriceOption = z.infer<typeof PriceOptionSchema>;

export const PriceForRequestSchema = z.object({
  serviceId: z.uuid(),
  locationId: z.uuid(),
  variantId: z.uuid().nullable().optional(),
  customerId: z.uuid().nullable().optional(),
  channel: z.string().nullable().optional(),
  date: z.iso.date().optional(),
  slotId: z.string().nullable().optional(), // a last-minute capacity slot
});
export type PriceForRequest = z.infer<typeof PriceForRequestSchema>;

export const PriceForResponseSchema = z.object({
  base: MoneySchema,
  options: z.array(PriceOptionSchema),
  best: PriceOptionSchema,
  effective: MoneySchema,
  choices: z.array(PriceOptionSchema), // options that spend a credit
  hasChoice: z.boolean(),
  discounted: z.boolean(),
});
export type PriceForResponse = z.infer<typeof PriceForResponseSchema>;
