import { z } from 'zod';

/**
 * Verified reviews (Alex, 2026-09-30): one per completed appointment,
 * four whole-star dimensions, an optional written part.
 *
 * Stored keys are stable and language-independent — `service`,
 * `timing`, `cleanliness`, `professional` — whatever the screens call
 * them. The salon's score is the mean of the first three (Option B);
 * the professional's score is the fourth, theirs alone. Public
 * averages are one decimal; counts are integers; submission is whole
 * stars.
 */
export const StarSchema = z.number().int().min(1).max(5);
export const REVIEW_BODY_MAX = 800;

export const ReviewRatingsSchema = z.object({
  service: StarSchema,
  timing: StarSchema,
  cleanliness: StarSchema,
  professional: StarSchema,
});
export type ReviewRatings = z.infer<typeof ReviewRatingsSchema>;

/** What the consumer sends. The appointment is in the URL; everything
 *  else about it is derived from the appointment, never trusted. */
export const ReviewSubmitSchema = ReviewRatingsSchema.extend({
  body: z.string().max(REVIEW_BODY_MAX).optional(),
});
export type ReviewSubmit = z.infer<typeof ReviewSubmitSchema>;

/** An aggregate: average to one decimal, and how many it rests on. */
export const RatingSummarySchema = z.object({
  avg: z.number(),
  count: z.number().int(),
});
export type RatingSummary = z.infer<typeof RatingSummarySchema>;

/** The consumer's own review, as the appointment carries it. */
export const ClientReviewSchema = ReviewRatingsSchema.extend({
  id: z.uuid(),
  body: z.string().nullable(),
  at: z.string(),
  /** Velnes Loyalty points this submission earned — on the submit
   *  response only, for the thank-you card (docs/LOYALTY.md). */
  loyaltyPoints: z.number().int().optional(),
});

/** The salon page's summary: the salon's score (service, timing,
 *  cleanliness), its parts, and how the whole-star overalls fall. */
export const PublicReviewSummarySchema = z.object({
  avg: z.number(),
  count: z.number().int(),
  service: z.number(),
  timing: z.number(),
  cleanliness: z.number(),
  /** Reviews per rounded overall star, index 0 = one star … 4 = five. */
  distribution: z.array(z.number().int()).length(5),
});
export type PublicReviewSummary = z.infer<typeof PublicReviewSummarySchema>;

/** One review as the public sees it: no email, no phone, no ids that
 *  lead anywhere — a first name and an initial, the stars, the words
 *  when they are published, the month it happened. */
export const PublicReviewSchema = z.object({
  id: z.uuid(),
  overall: z.number(),
  service: StarSchema,
  timing: StarSchema,
  cleanliness: StarSchema,
  professional: StarSchema,
  body: z.string().nullable(),
  reviewer: z.string(),
  serviceName: z.string().nullable(),
  professionalName: z.string().nullable(),
  locationName: z.string().nullable(),
  /** The visit's month, "2026-09" — never the day, never the time. */
  visitMonth: z.string(),
  verified: z.literal(true),
  at: z.string(),
});
export const PublicReviewsPageSchema = z.object({
  reviews: z.array(PublicReviewSchema),
  total: z.number().int(),
  offset: z.number().int(),
  limit: z.number().int(),
});

/** The salon's own view — read-only, filterable, with the names the
 *  salon already knows for that appointment. */
export const WorkspaceReviewSchema = z.object({
  id: z.uuid(),
  appointmentId: z.uuid(),
  overall: z.number(),
  service: StarSchema,
  timing: StarSchema,
  cleanliness: StarSchema,
  professional: StarSchema,
  body: z.string().nullable(),
  bodyStatus: z.enum(['published', 'hidden']),
  ratingStatus: z.enum(['valid', 'void']),
  customerName: z.string(),
  serviceName: z.string().nullable(),
  employeeId: z.uuid().nullable(),
  employeeName: z.string().nullable(),
  locationId: z.uuid(),
  locationName: z.string(),
  appointmentDate: z.iso.date(),
  at: z.string(),
});
export const WorkspaceReviewsPageSchema = z.object({
  reviews: z.array(WorkspaceReviewSchema),
  total: z.number().int(),
  offset: z.number().int(),
  limit: z.number().int(),
});
export const WorkspaceReviewsQuerySchema = z.object({
  locationId: z.uuid().optional(),
  employeeId: z.uuid().optional(),
  /** Whole-star overall to filter on, 1–5. */
  stars: z.coerce.number().int().min(1).max(5).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type WorkspaceReviewsQuery = z.infer<typeof WorkspaceReviewsQuerySchema>;
export const WorkspaceReviewsSummarySchema = z.object({
  avg: z.number(),
  count: z.number().int(),
  service: z.number(),
  timing: z.number(),
  cleanliness: z.number(),
  distribution: z.array(z.number().int()).length(5),
  employees: z.array(
    z.object({ id: z.uuid(), name: z.string(), avg: z.number(), count: z.number().int() }),
  ),
  locations: z.array(
    z.object({ id: z.uuid(), name: z.string(), avg: z.number(), count: z.number().int() }),
  ),
});
export const PublicReviewsQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

/** Round the way the public sees it: one decimal, half up. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
/** The salon-side overall of one review: service, timing, cleanliness. */
export function salonOverall(r: { service: number; timing: number; cleanliness: number }): number {
  return (r.service + r.timing + r.cleanliness) / 3;
}
