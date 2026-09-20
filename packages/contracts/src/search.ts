import { z } from 'zod';

/**
 * The Search lab's ranking config — §5, docs/SEARCH-RANKING.md.
 *
 * Every constant the ranker uses lives here rather than in code, so
 * tuning is a config version rather than a deploy, and so a result set
 * can always be explained after the fact: the door stamps the version
 * it ranked under onto its response.
 *
 * Platform-level and HQ-only. A salon that could read the weights is a
 * salon that could game them.
 *
 * Not to be confused with `ranking.ts`, which is the employee
 * leaderboard inside one salon. "Ranking" means two unrelated things in
 * this codebase; this file is the consumer-facing search one, and is
 * named for search rather than ranking to keep them apart.
 */

/**
 * How much each component of the score is worth.
 *
 * All weights are non-negative magnitudes. `exposure` is **subtracted**
 * rather than added — it is the fairness brake, not a merit — so it is
 * written here as a positive number and applied with a minus. Encoding
 * the sign in the number instead would make a config document where one
 * field silently means the opposite of its neighbours.
 *
 * The set does not have to sum to 1. Components a viewer cannot supply
 * (no location, no history, signed out) are dropped and the rest
 * renormalised, so only the ratios between them matter.
 */
export const SearchWeightsSchema = z.object({
  proximity: z.number().min(0).max(1),
  affinity: z.number().min(0).max(1),
  availability: z.number().min(0).max(1),
  value: z.number().min(0).max(1),
  /** Zero until reviews exist. See the inert note below. */
  quality: z.number().min(0).max(1),
  /** Zero until impressions are counted. Subtracted, never added. */
  exposure: z.number().min(0).max(1),
});

/**
 * Two of the six components are deliberately inert in v1: `quality`
 * waits on reviews, `exposure` on an impressions counter. Their weights
 * are seeded at zero and a test asserts they change no order. The slots
 * exist so that turning either on later is a data change rather than a
 * ranking rewrite — and so that neither gets approximated in the
 * meantime with a proxy that looks like a signal and is not one.
 */
export const INERT_COMPONENTS = ['quality', 'exposure'] as const;

export const SearchConfigPayloadSchema = z.object({
  weights: SearchWeightsSchema,
  proximity: z.object({
    /** Exponential decay distance: score = exp(-km / decayKm). */
    decayKm: z.number().positive(),
  }),
  affinity: z.object({
    /** A booking counts fully today, half after this many days. */
    recencyHalfLifeDays: z.number().positive(),
    /**
     * The nested sub-signals, combined with max rather than sum —
     * booking a service implies booking at the salon implies booking in
     * the category, and adding them up would let one loyal relationship
     * swamp distance entirely.
     */
    weights: z.object({
      bookedThisService: z.number().min(0).max(1),
      /** Reads as zero until favourites are persisted (Phase C). */
      favourited: z.number().min(0).max(1),
      bookedAtThisSalon: z.number().min(0).max(1),
      bookedSimilar: z.number().min(0).max(1),
      bookedInCategory: z.number().min(0).max(1),
    }),
    /**
     * "Similar" without service tags: same HQ category, and a duration
     * within this fraction of the other. 0.5 means ±50%. A weak notion,
     * and labelled weak on purpose — see §2.2.
     */
    similarDurationTolerance: z.number().min(0).max(1),
  }),
  diversity: z.object({
    /** At most this many results from one business in the window. */
    maxPerBusinessInWindow: z.number().int().positive(),
    /** The window the cap applies to — the first page, in effect. */
    windowSize: z.number().int().positive(),
    /**
     * A business this new is guaranteed a slot on the first page. With
     * exposure decay deferred, this and the dedup cap are the only
     * things standing between a new salon and ranking last forever.
     */
    newSalonWindowDays: z.number().int().nonnegative(),
  }),
});

/** One version of the config. Rows are written once and then only
 *  activated or deactivated, so the table is its own audit trail. */
export const SearchConfigVersionSchema = z.object({
  version: z.number().int().positive(),
  payload: SearchConfigPayloadSchema,
  note: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
  activatedAt: z.string().nullable(),
});

export const SearchConfigListSchema = z.object({
  versions: z.array(SearchConfigVersionSchema),
});

/**
 * The defaults argued for in docs/SEARCH-RANKING.md §2, and the single
 * source of truth for them.
 *
 * The migration seeds this same payload as v1 in SQL, because a fresh
 * production database has to come up with a config in force and never
 * runs the demo seed. That is two copies of the same numbers, so a test
 * asserts the seeded row equals this constant — drift between them
 * would mean production and development rank differently, which is the
 * kind of bug that is invisible until somebody compares two screens.
 */
export const DEFAULT_SEARCH_CONFIG: z.infer<typeof SearchConfigPayloadSchema> = {
  weights: {
    proximity: 0.3,
    affinity: 0.25,
    availability: 0.2,
    value: 0.1,
    quality: 0,
    exposure: 0,
  },
  proximity: { decayKm: 5 },
  affinity: {
    recencyHalfLifeDays: 180,
    weights: {
      bookedThisService: 1,
      favourited: 0.9,
      bookedAtThisSalon: 0.7,
      bookedSimilar: 0.45,
      bookedInCategory: 0.35,
    },
    similarDurationTolerance: 0.5,
  },
  diversity: {
    maxPerBusinessInWindow: 2,
    windowSize: 10,
    newSalonWindowDays: 30,
  },
};

export type SearchWeights = z.infer<typeof SearchWeightsSchema>;
export type SearchConfigPayload = z.infer<typeof SearchConfigPayloadSchema>;
export type SearchConfigVersion = z.infer<typeof SearchConfigVersionSchema>;
