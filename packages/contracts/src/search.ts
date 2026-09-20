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
  /**
   * How much answering what was actually typed is worth — the Search
   * phase's one addition to the scorer.
   *
   * Optional, with a default, because versions written before free-text
   * search existed genuinely had no such weight and must keep parsing.
   * An old config is not broken; it is a config from before this
   * mattered, and activating one should roll text relevance back rather
   * than raise.
   */
  textRelevance: z.number().min(0).max(1).default(0),
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
    /**
     * The heaviest single component on a text query, and deliberately:
     * someone who typed "deep tissue" wants the deep tissue treatment,
     * not whatever massage is nearest.
     *
     * The number has a meaning that can be stated, which is the only
     * honest way to pick one. Against proximity's 0.30 and a 5km decay,
     * 0.50 means **a treatment the customer named beats one merely in
     * the right category until it is about nine kilometres further
     * away**. At 0.40 that distance is 5.6km, at 0.55 it is 13km. Nine
     * is a city.
     *
     * It is also the first number to tune in the Search lab once there
     * are real queries to tune against; arithmetic only buys a starting
     * point.
     */
    textRelevance: 0.5,
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


/** A new version, as HQ writes it. */
export const SearchConfigDraftSchema = z.object({
  payload: SearchConfigPayloadSchema,
  note: z.string().max(400).default(''),
  /** Activate it now, or leave it parked for a dry run first. */
  activate: z.boolean().default(false),
});

/**
 * A dry run: score one category under a draft and say how the order
 * would move, without anybody's results changing.
 *
 * The whole point of the Search lab is that a weight change can be
 * looked at before it is live. A number that only reveals itself in
 * production is a number nobody will dare touch.
 */
export const SearchPreviewRequestSchema = z.object({
  categoryId: z.uuid(),
  payload: SearchConfigPayloadSchema,
  /** Rank as though standing here, since proximity is usually the
   *  weight being argued about. */
  lat: z.number().min(-90).max(90).nullable().default(null),
  lng: z.number().min(-180).max(180).nullable().default(null),
});

export const SearchPreviewRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  salon: z.string(),
  /** Position under the active config, and under the draft. */
  was: z.number().int(),
  now: z.number().int(),
  /** now - was: negative means it moved up. */
  moved: z.number().int(),
  score: z.number(),
  /** Per-component, so a move can be explained rather than guessed at.
   *  HQ-only: these never reach a consumer response. */
  components: z.record(z.string(), z.number()),
});

export const SearchPreviewSchema = z.object({
  category: z.string(),
  activeVersion: z.number().int(),
  rows: z.array(SearchPreviewRowSchema),
  /** How many results changed place at all. */
  moved: z.number().int(),
});

/**
 * What people asked for and did not find — step 10 of docs/SEARCH.md,
 * decision 3.
 *
 * HQ-only, and aggregate by construction. There is no client, no
 * session and no moment here because none was recorded: one row per
 * normalized query per day, carrying a count. It is a list of gaps in
 * what the platform sells, and it is deliberately unable to be anything
 * else.
 *
 * It never touches ranking. Ranking reads `search_config` and has never
 * heard of this.
 */
export const SearchMissSchema = z.object({
  /** The normalized form, which is also the form the index matched —
   *  so a miss can be replayed exactly as it was asked. */
  norm: z.string(),
  day: z.string(),
  /** How many times it was submitted that day. */
  asked: z.number().int(),
  /** What it last came back with. Zero is the interesting case; one or
   *  two is the other one. */
  results: z.number().int(),
  /** How the text was read. The difference between "we did not
   *  understand it" and "we understood it and have nothing" is the
   *  whole value of the log: the first is a synonym to add, the second
   *  is a salon to recruit. */
  how: z.enum(['salon', 'category', 'service', 'fuzzy', 'none']),
});

export const SearchMissesSchema = z.object({
  misses: z.array(SearchMissSchema),
  /** The window these cover, in days. */
  days: z.number().int(),
});

export type SearchMisses = z.infer<typeof SearchMissesSchema>;
export type SearchConfigDraft = z.infer<typeof SearchConfigDraftSchema>;
export type SearchPreview = z.infer<typeof SearchPreviewSchema>;
