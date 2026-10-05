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
 * Confirmed by Alex (2026-10-02): +30 per additional service — three
 * services earn 160; the brief's "190" example was a mistake.
 * Everything derived reads the constant from here.
 */
export const LOYALTY_RULES = {
  /** 2 (2026-10-02): any choice beyond Standard — a length, an option — earns on top.
   *  3 (2026-10-05): the quiet-time bonus, +20 on a slot the algorithm marks quiet. */
  version: 3,
  /** On the first email verification of an account. */
  registration: 100,
  appointment: {
    firstService: 100,
    additionalService: 30,
    productUnit: 20,
    /** Each choice beyond the Standard card (Alex, 2026-10-02): a length
     *  other than the base one, an option from a group — on top of the
     *  service's own points, once per choice. */
    extraChoice: 20,
    /** A quiet slot (Alex, 2026-10-05): a start the location's own
     *  history shows is usually free, booked through the Velnes app.
     *  Flat, platform-paid, per visit; cleared by any reschedule. */
    quietSlot: 20,
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
/** Points for choices beyond Standard — lengths and options, counted one each. */
export function extraPoints(extras: number, rules = LOYALTY_RULES): number {
  return Math.max(0, Math.floor(extras)) * rules.appointment.extraChoice;
}
export function appointmentPoints(serviceCount: number, productUnits: number, extras = 0, rules = LOYALTY_RULES) {
  const s = servicePoints(serviceCount, rules);
  const p = productPoints(productUnits, rules);
  const x = extraPoints(extras, rules);
  return { servicePoints: s, productPoints: p, extraPoints: x, total: s + p + x };
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
  extraChoice: z.number().int().default(0),
  quietSlot: z.number().int().default(0),
  review: z.number().int(),
});

/**
 * How a quiet slot is found (Alex, 2026-10-05) — one place for every
 * number, so tuning is a constant and the HQ view can say them. A
 * location needs `minCompleted` completed visits in its history; a
 * weekday-and-start pair is judged over the last `windowWeeks`, only
 * when open in at least `minOpenWeeks` of them; it is quiet when its
 * fill (weeks booked over that time ÷ weeks open) is under `maxFill`
 * and under half the location's own fill; at most `maxShare` of each
 * weekday's judged pairs are tagged, the quietest first (ties go to the
 * hours the salon is least booked at over the whole week).
 */
export const QUIET_SLOT_RULE = {
  windowWeeks: 6,
  minOpenWeeks: 4,
  maxFill: 0.2,
  minCompleted: 40,
  maxShare: 0.3,
} as const;

export const HqQuietSlotsSchema = z.object({
  rule: z.object({
    windowWeeks: z.number().int(),
    minOpenWeeks: z.number().int(),
    maxFill: z.number(),
    minCompleted: z.number().int(),
    maxShare: z.number(),
    bonus: z.number().int(),
  }),
  locations: z.array(
    z.object({
      locationId: z.uuid(),
      tenantId: z.uuid(),
      locationName: z.string(),
      salonName: z.string(),
      computedAt: z.iso.datetime().nullable(),
      completed: z.number().int(),
      qualified: z.boolean(),
      openPairs: z.number().int(),
      locationFill: z.number(),
      quietCount: z.number().int(),
      /** 0 = Monday … 6 = Sunday. */
      slots: z.array(z.object({ weekday: z.number().int(), t: z.string(), openWeeks: z.number().int(), bookedWeeks: z.number().int(), fill: z.number() })),
    }),
  ),
});
export type HqQuietSlots = z.infer<typeof HqQuietSlotsSchema>;

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
  extraChoice: LOYALTY_RULES.appointment.extraChoice,
  quietSlot: LOYALTY_RULES.appointment.quietSlot,
  review: LOYALTY_RULES.review,
});
