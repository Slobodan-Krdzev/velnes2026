import { z } from 'zod';
import { MoneySchema } from './catalog.js';

/**
 * Customers & customer intelligence (Phase 9). custStats is THE one
 * insights door: only completed visits count, visits are days (two
 * treatments in one sitting are one visit), medians over averages so
 * one long holiday cannot break a rhythm — the prototype's rules
 * verbatim.
 */

export const CI = {
  MIN_VISITS: 5,
  MIN_EMP_PCT: 60,
  MIN_WD_PCT: 45,
  MIN_BAND_PCT: 50,
  RHYTHM_SPREAD: 0.6,
  LAPSE_MIN: 4,
  LAPSE_WINDOW: 180,
  OVERDUE_FACTOR: 1.4,
  TREND_WINDOW: 182,
  TREND_PCT: 0.2,
  HIVAL_FACTOR: 2,
  HIVAL_DAYS: 90,
  BDAY_WINDOW: 14,
  PAGE: 15,
} as const;

export const PremiumStateSchema = z
  .object({
    status: z.string(),
    since: z.string(),
    renews: z.string(),
  })
  .nullable();

export const CustomerProfileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  group: z.string(),
  since: z.string().nullable(),
  visits: z.number().int(),
  spend: MoneySchema,
  points: z.number().int(),
  prepaid: MoneySchema,
  blacklisted: z.boolean(),
  noShows: z.number().int(),
  note: z.string().nullable(),
  birthday: z.string().nullable(), // ISO date; year may be historic
  tags: z.array(z.string()),
  premium: PremiumStateSchema, // platform truth, mirrored read-only
  isPremium: z.boolean(), // the one door's answer
});
export type CustomerProfile = z.infer<typeof CustomerProfileSchema>;

export const CustomerPatchSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  group: z.string().optional(),
  birthday: z.string().nullable().optional(),
  blacklisted: z.boolean().optional(),
});

export const CustomerApptRowSchema = z.object({
  id: z.uuid(),
  date: z.iso.date(),
  start: z.string(),
  end: z.string(),
  serviceName: z.string(),
  locationName: z.string(),
  employeeName: z.string().nullable(),
  status: z.string(),
  source: z.string(),
  price: MoneySchema,
});
export const CustomerApptsSchema = z.object({
  upcoming: z.array(CustomerApptRowSchema),
  history: z.array(CustomerApptRowSchema),
});

export const CustomerInvoiceRowSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  date: z.iso.date(),
  method: z.string(),
  total: MoneySchema,
});
export const CustomerInvoicesSchema = z.object({
  invoices: z.array(CustomerInvoiceRowSchema),
});

export const LoyaltyRowSchema = z.object({
  id: z.uuid(),
  reason: z.string(),
  ref: z.string(),
  when: z.iso.date(),
  points: z.number().int(),
});
export const CustomerLoyaltySchema = z.object({
  balance: z.number().int(),
  worth: MoneySchema,
  nextRewardAt: z.number().int(),
  rows: z.array(LoyaltyRowSchema),
});

export const ActivityEntrySchema = z.object({
  id: z.uuid(),
  ts: z.iso.datetime(),
  actorName: z.string().nullable(),
  type: z.string(),
  refType: z.string(),
  refId: z.string(),
  meta: z.record(z.string(), z.unknown()),
});
export const ActivityListSchema = z.object({ entries: z.array(ActivityEntrySchema) });

const VisitRowSchema = z.object({
  serviceId: z.uuid().nullable(),
  service: z.string(),
  employeeId: z.uuid().nullable(),
  employeeName: z.string(),
  start: z.string(),
  end: z.string(),
  amount: MoneySchema,
});
export const VisitDetailSchema = z.object({
  date: z.iso.date(),
  rows: z.array(VisitRowSchema),
  amount: MoneySchema,
});

export const CustomerInsightsSchema = z.object({
  seeded: z.boolean(), // false = only the recorded totals, no history
  totals: z.object({
    visits: z.number().int(),
    spend: MoneySchema,
    avgSpend: MoneySchema,
    firstDate: z.string().nullable(),
    lastDate: z.string().nullable(),
  }),
  firstVisit: VisitDetailSchema.nullable(),
  lastVisit: VisitDetailSchema.nullable(),
  services: z.array(
    z.object({
      serviceId: z.uuid().nullable(),
      name: z.string(),
      count: z.number().int(),
      spend: MoneySchema,
      pct: z.number().int(),
    }),
  ),
  products: z.array(
    z.object({
      productId: z.uuid().nullable(),
      name: z.string(),
      qty: z.number().int(),
      spend: MoneySchema,
    }),
  ),
  times: z.array(z.object({ hour: z.number().int(), count: z.number().int() })),
  weekdays: z.array(z.object({ wd: z.number().int(), count: z.number().int() })),
  employees: z.array(
    z.object({
      empId: z.uuid().nullable(),
      name: z.string(),
      count: z.number().int(),
      pct: z.number().int(),
    }),
  ),
  cadence: z.object({
    medianGapDays: z.number().nullable(),
    sampleSize: z.number().int(),
    trend: z.enum(['up', 'down', 'flat']).nullable(),
    steady: z.boolean(),
  }),
  overdueDays: z.number().nullable(),
  lapsedServices: z.array(
    z.object({ serviceId: z.uuid().nullable(), name: z.string(), count: z.number().int() }),
  ),
  favoriteService: z
    .object({
      serviceId: z.uuid().nullable(),
      name: z.string(),
      count: z.number().int(),
      spend: MoneySchema,
      pct: z.number().int(),
    })
    .nullable(),
  favoriteProduct: z
    .object({
      productId: z.uuid().nullable(),
      name: z.string(),
      qty: z.number().int(),
      spend: MoneySchema,
    })
    .nullable(),
  // 'returning' / 'at_risk' only with a proven rhythm; otherwise no
  // label at all — a label without proof is a guess, not an insight.
  retention: z.enum(['returning', 'at_risk']).nullable(),
});
export type CustomerInsights = z.infer<typeof CustomerInsightsSchema>;

/** A personal offer: a promise to one customer for one service.
 *  'expired' is derived from validUntil, never stored. */
export const PersonalOfferStatusSchema = z.enum(['live', 'cancelled', 'redeemed', 'expired']);
export const PersonalOfferSchema = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
  customerName: z.string().optional(),
  serviceId: z.uuid(),
  serviceName: z.string(),
  variantId: z.uuid().nullable(),
  locationId: z.uuid(),
  specialPrice: MoneySchema,
  normalPrice: MoneySchema,
  validUntil: z.iso.date(),
  intent: z.string(),
  status: PersonalOfferStatusSchema,
  createdAt: z.iso.datetime(),
});
export type PersonalOffer = z.infer<typeof PersonalOfferSchema>;
export const PersonalOfferListSchema = z.object({ offers: z.array(PersonalOfferSchema) });

export const PersonalOfferCreateSchema = z.object({
  serviceId: z.uuid(),
  variantId: z.uuid().nullable().optional(),
  locationId: z.uuid(),
  specialPrice: MoneySchema,
  validUntil: z.iso.date(),
  intent: z.string().default(''),
});
