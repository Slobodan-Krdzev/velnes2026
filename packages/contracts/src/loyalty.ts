import { z } from 'zod';

/**
 * Velnes Loyalty — the platform points ledger (Alex, 2026-09-30).
 * docs/LOYALTY.md. One balance per consumer account, earned at any
 * salon; every point a row with a reason and a source. Not the salon's
 * own loyalty card at the till, which is a different ledger.
 */

/**
 * The rules, versioned. Every ledger row records the version and its
 * own breakdown, so changing a number here never rewrites history.
 *
 * PROVISIONAL (2026-09-30): the brief states "+30 per additional
 * service" and also gives an example where 3 services = 190, which
 * that rule does not produce. `additionalService` holds the stated
 * rule until Alex confirms; everything derived reads it from here.
 */
export const LOYALTY_RULES = {
  version: 1,
  /** On the first email verification of an account. */
  registration: 100,
  appointment: {
    firstService: 100,
    additionalService: 30,
    productUnit: 20,
    /** Hours after the visit's end before it is settled — so a checkout
     *  at the till, with its products, is already on the invoice. */
    settleHours: 2,
  },
  /** On a verified review's first submission. */
  review: 50,
} as const;

/** Points for `n` delivered services: the first at the full rate, the
 *  rest at the additional rate. Zero services, zero points. */
export function servicePoints(n: number, rules = LOYALTY_RULES): number {
  if (n < 1) return 0;
  return rules.appointment.firstService + rules.appointment.additionalService * (n - 1);
}
/** Points for product units sold with the visit — quantity, never rows. */
export function productPoints(units: number, rules = LOYALTY_RULES): number {
  return Math.max(0, Math.floor(units)) * rules.appointment.productUnit;
}
export function appointmentPoints(serviceCount: number, productUnits: number, rules = LOYALTY_RULES) {
  const s = servicePoints(serviceCount, rules);
  const p = productPoints(productUnits, rules);
  return { servicePoints: s, productPoints: p, total: s + p };
}

/** Stable typed reasons. The last six have no writer yet; the ledger
 *  understands them so the future needs no migration. */
export const LoyaltyTypeSchema = z.enum([
  'registration_bonus',
  'appointment_completed',
  'review_submitted',
  'appointment_reversal',
  'product_return_reversal',
  'reward_redeemed',
  'promotion_bonus',
  'manual_adjustment',
  'points_expired',
]);
export type LoyaltyType = z.infer<typeof LoyaltyTypeSchema>;

export const LoyaltyEntrySchema = z.object({
  id: z.uuid(),
  type: LoyaltyTypeSchema,
  /** Signed. */
  points: z.number().int(),
  sourceType: z.string().nullable(),
  sourceId: z.string().nullable(),
  /** The salon it was earned at, when it was earned at one. */
  salonName: z.string().nullable(),
  /** The breakdown that explains the number, as it was when written. */
  meta: z.record(z.string(), z.unknown()).default({}),
  at: z.iso.datetime(),
});
export type LoyaltyEntry = z.infer<typeof LoyaltyEntrySchema>;

export const LoyaltyRulesSchema = z.object({
  version: z.number().int(),
  registration: z.number().int(),
  firstService: z.number().int(),
  additionalService: z.number().int(),
  productUnit: z.number().int(),
  review: z.number().int(),
});

/** What the customer sees: the balance, the rules as words can use
 *  them, and the ledger newest first. */
export const LoyaltyAccountSchema = z.object({
  balance: z.number().int(),
  rules: LoyaltyRulesSchema,
  entries: z.array(LoyaltyEntrySchema),
});
export type LoyaltyAccount = z.infer<typeof LoyaltyAccountSchema>;

/** HQ's lookup: the account beside its ledger. */
export const HqLoyaltyLookupSchema = LoyaltyAccountSchema.extend({
  account: z.object({ id: z.uuid(), email: z.string(), name: z.string(), since: z.iso.date(), verified: z.boolean() }),
});

export const rulesForClients = () => ({
  version: LOYALTY_RULES.version,
  registration: LOYALTY_RULES.registration,
  firstService: LOYALTY_RULES.appointment.firstService,
  additionalService: LOYALTY_RULES.appointment.additionalService,
  productUnit: LOYALTY_RULES.appointment.productUnit,
  review: LOYALTY_RULES.review,
});
