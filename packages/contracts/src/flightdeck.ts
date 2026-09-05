import { z } from 'zod';

/**
 * The salon's flightdeck (dashboard). One door composes the whole
 * view from live data: the pulse, the priority-of-today hero, the
 * opportunities and Kumo insight (from the insights provider — rules
 * today, Claude later), the low-stock side card and the "good to know"
 * strip. The UI computes nothing; it renders what this returns.
 */

/** One opportunity the salon could act on now. */
export const FlightdeckOpportunitySchema = z.object({
  key: z.string(),
  icon: z.string(), // an I.* icon name resolved by the UI
  title: z.string(),
  detail: z.string(),
  value: z.number().int(), // expected upside in whole MKD, 0 if not quantifiable
  actionLabel: z.string(),
  actionTarget: z.string(), // a nav route key: 'customers' | 'reports' | 'catalog' | 'suppliers' | 'marketing'
});
export type FlightdeckOpportunity = z.infer<typeof FlightdeckOpportunitySchema>;

/** The Kumo strip — a longer-horizon insight. Null when the provider
 *  has nothing honest to say. `ai` marks whether a model wrote it. */
export const FlightdeckKumoSchema = z.object({
  text: z.string(),
  actionTarget: z.string(),
  ai: z.boolean().default(false),
});

export const FlightdeckHeroSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('capacity'),
    when: z.enum(['today', 'tomorrow']),
    date: z.string(),
    locationId: z.string(),
    openSlots: z.number().int(),
    fromTime: z.string(),
    toTime: z.string(),
    potential: z.number().int(),
    memberCount: z.number().int(),
  }),
  z.object({ kind: z.literal('quiet') }),
]);

export const FlightdeckSchema = z.object({
  greetingName: z.string(),
  pulse: z.object({
    capacityPct: z.number().int(),
    bookedToday: z.number().int(),
    totalSlots: z.number().int(),
    revenueToday: z.number().int(),
    revenueTarget: z.number().int(),
    newCustomers: z.number().int(),
    newCustomersDeltaPct: z.number().int().nullable().default(null),
    avgSpend: z.number().int(),
    avgSpendDeltaPct: z.number().int().nullable().default(null),
  }),
  /** Pending Velnes Premium member recommendations, for the hero's
   *  member-opportunity card. */
  memberRecs: z.object({ count: z.number().int(), value: z.number().int() }),
  hero: FlightdeckHeroSchema,
  opportunities: z.array(FlightdeckOpportunitySchema),
  kumo: FlightdeckKumoSchema.nullable().default(null),
  snapshot: z.object({
    bookedToday: z.number().int(),
    totalSlots: z.number().int(),
    onlineToday: z.number().int(),
    noShows: z.number().int(),
    noShowPct: z.number().int(),
    revenue: z.number().int(),
    productSales: z.number().int(),
  }),
  staff: z.array(
    z.object({ employeeId: z.string(), name: z.string(), value: z.number().int() }),
  ),
  inventory: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      stock: z.number().int(),
      soldOut: z.boolean(),
    }),
  ),
  /** Which engine produced the opportunities/kumo — 'rules' or 'claude'. */
  provider: z.enum(['rules', 'claude']),
});
export type Flightdeck = z.infer<typeof FlightdeckSchema>;
