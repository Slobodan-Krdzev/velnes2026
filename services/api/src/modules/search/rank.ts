import type { SearchConfigPayload } from '@velnes/contracts';

/**
 * The ranker — §5, docs/SEARCH-RANKING.md.
 *
 * A pure function of (candidates, viewer, config). No database, no
 * Fastify, no clock it does not own: `now` is passed in so recency and
 * the new-salon window are testable rather than dependent on the day
 * the suite runs. Everything it needs has already been fetched.
 *
 * Three stages, kept separate so that any result can be explained:
 * admission excludes (and we can say why), scoring orders (and we can
 * show the components), diversification re-orders (and that is a
 * platform rule, not a judgement about a salon).
 */

export interface RankSalon {
  slug: string;
  businessId: string;
  name: string;
  lat: number | null;
  lng: number | null;
  /** A live widget exists, so the booking doors answer for it. */
  bookable: boolean;
  /** ISO date; drives the new-salon window. */
  createdAt: string;
}

export interface RankCandidate {
  id: string;
  name: string;
  categoryId: string;
  durationMin: number;
  /** Null when the salon publishes no prices. Never a ranking penalty. */
  price: number | null;
  priceFrom: number | null;
  salon: RankSalon;
  /**
   * How well this treatment answers what was typed — 0–1, from
   * `textRelevanceOf`.
   *
   * Absent on a category card, where there is no text to answer. The
   * component then drops out of the weighting for the whole request and
   * the rest renormalise, exactly as they do for a viewer who gave no
   * location. Two entry points, one scorer.
   */
  textRelevance?: number;
}

/**
 * What the viewer brings. Both fields may be absent — a signed-out
 * visitor with no location is a perfectly ordinary caller, and gets a
 * perfectly good page.
 */
export interface Viewer {
  /** Already rounded to ~110m by the browser. Never stored. */
  position: { lat: number; lng: number } | null;
  /** Null when signed out, or when the client has switched
   *  personalisation off. Only ever this viewer's own history. */
  history: ViewerHistory | null;
}

/** The viewer's own completed bookings, keyed for lookup. Dates are ISO
 *  and are the most recent qualifying booking of each kind. */
export interface ViewerHistory {
  services: Record<string, string>;
  businesses: Record<string, string>;
  categories: Record<string, string>;
  /** Durations booked per category, for the weak "similar" signal. */
  durationsByCategory: Record<string, number[]>;
  /** Empty until favourites are persisted (Phase C). */
  favouriteServiceIds: string[];
  favouriteBusinessIds: string[];
}

export interface RankedCandidate {
  candidate: RankCandidate;
  score: number;
  /** Per-component, for the HQ Search lab and for explaining an order.
   *  Never shipped to a consumer response. */
  components: Record<string, number>;
}

const EARTH_KM = 6371;

/** Great-circle distance. Good to well under the 110m the coordinates
 *  were rounded to, which is all ranking needs. */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

function median(ns: number[]): number | null {
  if (!ns.length) return null;
  const v = [...ns].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

const daysBetween = (fromIso: string, now: Date) =>
  (now.getTime() - new Date(fromIso).getTime()) / 86_400_000;

/**
 * The neutral value for a component this candidate has no input for —
 * no pin, no published price.
 *
 * Deliberately the midpoint and not zero. A salon that hides its prices
 * must not be ranked as though it were worst, and the same goes for one
 * whose pin is missing: absence of an input is not evidence against
 * anybody. This is distinct from a component the *viewer* cannot supply,
 * which is dropped from the weighting entirely (see `rank`).
 */
const NEUTRAL = 0.5;

/** How much of a preference an old booking still is. */
function recency(lastIso: string | undefined, now: Date, halfLifeDays: number): number {
  if (!lastIso) return 0;
  const days = Math.max(0, daysBetween(lastIso, now));
  return 0.5 ** (days / halfLifeDays);
}

/**
 * The personal component: the viewer's own history with this treatment
 * and this salon.
 *
 * Sub-signals combined with max, not sum. They are nested — booking a
 * service implies booking at the salon implies booking in the category —
 * so adding them up would let one loyal relationship swamp distance.
 */
export function affinityOf(
  c: RankCandidate,
  h: ViewerHistory,
  cfg: SearchConfigPayload,
  now: Date,
): number {
  const { weights: w, recencyHalfLifeDays: hl, similarDurationTolerance: tol } = cfg.affinity;
  const parts: number[] = [];

  const svc = h.services[c.id];
  if (svc) parts.push(w.bookedThisService * recency(svc, now, hl));

  if (h.favouriteServiceIds.includes(c.id) || h.favouriteBusinessIds.includes(c.salon.businessId))
    parts.push(w.favourited);

  const biz = h.businesses[c.salon.businessId];
  if (biz) parts.push(w.bookedAtThisSalon * recency(biz, now, hl));

  // "Similar" without service tags: same category, and a duration within
  // tolerance of something already booked there. A weak notion, and
  // labelled weak on purpose — see §2.2.
  const durations = h.durationsByCategory[c.categoryId] ?? [];
  const similar = durations.some(
    (d) => Math.abs(d - c.durationMin) <= tol * Math.max(d, c.durationMin),
  );
  const cat = h.categories[c.categoryId];
  if (similar && cat) parts.push(w.bookedSimilar * recency(cat, now, hl));
  if (cat) parts.push(w.bookedInCategory * recency(cat, now, hl));

  return parts.length ? Math.max(...parts) : 0;
}

export interface RankOptions {
  /** Passed in so recency and the new-salon window are testable. */
  now?: Date;
}

/**
 * Score and order one category's candidates.
 *
 * Weighting: a component the **viewer** cannot supply — no position, no
 * history — is dropped and the remaining weights renormalised, so the
 * components that do apply keep their full strength rather than every
 * result drifting toward a midpoint. A component a **candidate** has no
 * input for keeps its weight and scores the neutral midpoint, because
 * absence of a price or a pin is not evidence against that salon.
 */
export function rank(
  candidates: RankCandidate[],
  viewer: Viewer,
  cfg: SearchConfigPayload,
  opts: RankOptions = {},
): RankedCandidate[] {
  const now = opts.now ?? new Date();
  const w = cfg.weights;

  // Which components this request can weigh at all.
  const live: Record<string, number> = {
    availability: w.availability,
    value: w.value,
    quality: w.quality,
  };
  if (viewer.position) live.proximity = w.proximity;
  if (viewer.history) live.affinity = w.affinity;
  // A text query is the only thing that can answer "how well does this
  // match what they typed", so the component exists for the request or
  // for none of it. Inferred from the candidates rather than passed as a
  // flag: it cannot then disagree with what was actually supplied.
  const textual = candidates.some((c) => c.textRelevance !== undefined);
  if (textual) live.textRelevance = w.textRelevance ?? 0;

  const total = Object.values(live).reduce((a, b) => a + b, 0);
  // Every live weight is zero (a config of all zeroes): fall back to a
  // stable alphabetical order rather than dividing by nothing.
  const norm = total > 0 ? total : 1;

  const prices = candidates
    .map((c) => c.priceFrom ?? c.price)
    .filter((p): p is number => p != null);
  const mid = median(prices);

  const scored: RankedCandidate[] = candidates.map((c) => {
    const components: Record<string, number> = {};

    components.availability = c.salon.bookable ? 1 : 0;

    const asking = c.priceFrom ?? c.price;
    components.value =
      asking == null || mid == null || mid <= 0
        ? NEUTRAL
        : Math.max(0, Math.min(1, 0.5 + (mid - asking) / (2 * mid)));

    // Inert until reviews exist; its weight is zero, so this is only
    // ever a placeholder the shape can hang on.
    components.quality = NEUTRAL;

    // A candidate reached through its category on a text query has no
    // text score of its own; NEUTRAL, not zero, for the same reason a
    // hidden price is neutral — it was found the ordinary way, which is
    // not evidence against it.
    if (textual) components.textRelevance = c.textRelevance ?? NEUTRAL;

    if (viewer.position) {
      components.proximity =
        c.salon.lat == null || c.salon.lng == null
          ? NEUTRAL
          : Math.exp(
              -distanceKm(viewer.position, { lat: c.salon.lat, lng: c.salon.lng }) /
                cfg.proximity.decayKm,
            );
    }
    if (viewer.history) components.affinity = affinityOf(c, viewer.history, cfg, now);

    // Inert until impressions are counted. Kept as a named component
    // rather than omitted, so turning it on is a data change.
    components.exposure = 0;

    let merit = 0;
    for (const [key, weight] of Object.entries(live)) merit += weight * (components[key] ?? 0);
    // Subtracted, and outside the normaliser: exposure is the fairness
    // brake, not one of the merits being weighed against each other.
    const score = merit / norm - w.exposure * components.exposure;

    return { candidate: c, score, components };
  });

  // Stable tiebreak: a page that reorders between two identical requests
  // is one nobody trusts.
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.candidate.name.localeCompare(b.candidate.name) ||
      a.candidate.salon.name.localeCompare(b.candidate.salon.name) ||
      a.candidate.id.localeCompare(b.candidate.id),
  );

  return diversify(scored, cfg, now);
}

/**
 * Stage 3. Chain dedup, then the new-salon window.
 *
 * With exposure decay deferred, these two are the only things standing
 * between a new salon and ranking last forever, and the only brake on
 * one business owning a category.
 */
export function diversify(
  scored: RankedCandidate[],
  cfg: SearchConfigPayload,
  now: Date,
): RankedCandidate[] {
  const { maxPerBusinessInWindow: cap, windowSize, newSalonWindowDays } = cfg.diversity;

  // Chain dedup: a salon's third match in the window is moved below it,
  // never dropped. Eight relevant treatments should not be hidden, but
  // they should not be the whole page either.
  const head: RankedCandidate[] = [];
  const tail: RankedCandidate[] = [];
  const seen = new Map<string, number>();
  for (const s of scored) {
    const id = s.candidate.salon.businessId;
    const n = seen.get(id) ?? 0;
    if (head.length < windowSize && n >= cap) tail.push(s);
    else {
      head.push(s);
      seen.set(id, n + 1);
    }
  }
  const out = [...head, ...tail];

  // New-salon window: one guaranteed slot on the first page, if the
  // salon was admitted at all. Without it a new salon has no history and
  // no momentum and never surfaces — the cold-start trap that makes a
  // marketplace impossible to join.
  if (newSalonWindowDays > 0) {
    const isNew = (s: RankedCandidate) =>
      daysBetween(s.candidate.salon.createdAt, now) <= newSalonWindowDays;
    const alreadyUp = out.slice(0, windowSize).some(isNew);
    if (!alreadyUp) {
      const i = out.findIndex(isNew);
      if (i >= windowSize) {
        const [promoted] = out.splice(i, 1);
        out.splice(windowSize - 1, 0, promoted!);
      }
    }
  }

  return out;
}
