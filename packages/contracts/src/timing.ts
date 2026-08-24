import { z } from 'zod';

/** The timing engine's tuning constants — the prototype's TIMING. */
export const TIMING = {
  MIN_SVC: 12, // observations for a service-level pace
  MIN_VAR: 8, // observations for a variant's own duration
  WINDOW: 180, // days that count
  REGROW: 0.25, // sample growth before re-proposing after dismissal
  MIN_DELTA: 5, // fewer minutes of difference is not worth proposing
  MIN_PCT: 0.1, // and less than this fraction is not either
  LOW: 0.4, // outside this ratio band it is an error, not an observation
  HIGH: 2.5,
} as const;

export const TimingStatusSchema = z.enum(['none', 'suggested', 'approved', 'dismissed']);

export const TimingSuggestionSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  serviceId: z.uuid(),
  serviceName: z.string(),
  variantId: z.uuid().nullable(),
  observedN: z.number().int(),
  observedMedianMin: z.number().int().nullable(),
  paceFactor: z.number().nullable(),
  recommendedMin: z.number().int().nullable(),
  currentMin: z.number().int().nullable(),
  status: TimingStatusSchema,
});
export const TimingSuggestionsResponseSchema = z.object({
  suggestions: z.array(TimingSuggestionSchema),
});

export const RecomputeResponseSchema = z.object({
  pairs: z.number().int(), // employee-service pairs recomputed
  suggested: z.number().int(), // now on the owner's stack
});
