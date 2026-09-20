import { distanceKm, type RankCandidate } from './rank.js';

/**
 * Step 8 of the Search phase — docs/SEARCH.md.
 *
 * Filters are **hard admission, decided on the server**, never a
 * client-side re-sort. The order is the product: a page that quietly
 * re-sorts what it was given is showing a different answer from the one
 * the ranker produced, and nobody can explain it afterwards.
 *
 * Pure on purpose, and shared by both doors. A category card and a
 * typed query filter through this one function, so "under 1.000 MKD"
 * cannot come to mean two different things depending on how somebody
 * arrived.
 */

export type PriceBand = 'low' | 'mid' | 'high';

export interface PriceTerciles {
  /** Everything at or below this is `low`, in whole denars. */
  lowMax: number;
  /** Above `lowMax` and at or below this is `mid`; above it is `high`. */
  midMax: number;
}

export interface Filters {
  /** A distance the viewer set. Only meaningful with a position. */
  radiusKm: number | null;
  priceBand: PriceBand | null;
  /** Narrows a text query that spanned several categories. */
  categoryId: string | null;
}

/**
 * Below this many results a distance limit has done more harm than
 * good, and it is dropped once — out loud. Five is few enough to feel
 * like an empty page.
 */
export const WIDEN_BELOW = 5;

/**
 * Fewer priced candidates than this and terciles are theatre: three
 * bands over five treatments sorts them into ones and twos, and a
 * "filter" that leaves one result is a worse answer than no filter.
 * Below it the bands are absent rather than misleading.
 */
const MIN_FOR_BANDS = 6;

/**
 * What a treatment costs, for filtering.
 *
 * The cheapest way in is the honest number: a service with variants
 * advertises `priceFrom`, and filtering it by a headline price the
 * customer need never pay would hide it from exactly the band it
 * belongs in.
 */
export function priceOf(c: RankCandidate): number | null {
  return c.priceFrom ?? c.price;
}

/**
 * Where the bands fall, across the admitted candidates for *this*
 * query — so "low" means low for facials when you asked for facials,
 * rather than low against every treatment on the platform.
 *
 * Computed before any filter is applied, so choosing a band does not
 * move the boundaries underneath the person who chose it.
 */
export function priceTercilesOf(candidates: RankCandidate[]): PriceTerciles | null {
  const prices = candidates
    .map(priceOf)
    .filter((p): p is number => p != null)
    .sort((a, b) => a - b);
  if (prices.length < MIN_FOR_BANDS) return null;
  const lowMax = prices[Math.floor(prices.length / 3) - 1]!;
  const midMax = prices[Math.floor((prices.length * 2) / 3) - 1]!;
  // Enough prices, but not enough different ones: three bands over two
  // distinct values is a control that cannot do what it says.
  if (!(lowMax < midMax)) return null;
  return { lowMax, midMax };
}

/** Whether a price sits in a band. A treatment with no published price
 *  sits in none of them — see `hiddenUnpriced`. */
export function inBand(price: number | null, band: PriceBand, t: PriceTerciles): boolean {
  if (price == null) return false;
  if (band === 'low') return price <= t.lowMax;
  if (band === 'mid') return price > t.lowMax && price <= t.midMax;
  return price > t.midMax;
}

export interface Admission {
  admitted: RankCandidate[];
  /**
   * A distance limit that was dropped because keeping it would have
   * left almost nothing. Always reported: silently widening a search
   * and presenting the result as the search is the one thing this
   * surface must not do.
   */
  widened: 'radius' | null;
  /**
   * How many treatments a price band pushed out for having no published
   * price at all. Said out loud, because a salon that hides its prices
   * disappearing from a price filter looks like a missing salon.
   */
  hiddenUnpriced: number;
}

/**
 * Admission, in one place.
 *
 * A price band and a category are never widened: they are explicit
 * choices, and quietly ignoring one because it returned little would be
 * answering a question nobody asked.
 *
 * The radius is the one exception, and only where `widenRadius` says
 * so. The two doors deliberately differ here:
 *
 *   - **Text search** widens once and reports it (§8 of docs/SEARCH.md).
 *     A typed query that lands on an empty page is a dead end, and the
 *     customer gave a distance as a preference, not a demand.
 *   - **A category card** keeps Phase B's contract exactly: a radius
 *     the viewer set is hard, and results outside it are absent.
 *     §5 settled that, and Phase B is closed — a closed rule does not
 *     get changed underneath as a side effect of adding filters.
 *
 * Whether those should converge is a product decision, not one to make
 * silently from inside a filter function.
 */
export function applyFilters(
  candidates: RankCandidate[],
  filters: Filters,
  position: { lat: number; lng: number } | null,
  terciles: PriceTerciles | null,
  widenRadius = false,
): Admission {
  let out = candidates;
  let widened: 'radius' | null = null;

  if (filters.categoryId) out = out.filter((c) => c.categoryId === filters.categoryId);

  let hiddenUnpriced = 0;
  if (filters.priceBand && terciles) {
    const band = filters.priceBand;
    hiddenUnpriced = out.filter((c) => priceOf(c) == null).length;
    out = out.filter((c) => inBand(priceOf(c), band, terciles));
  }

  if (position && filters.radiusKm) {
    const km = filters.radiusKm;
    const within = out.filter(
      (c) =>
        c.salon.lat != null &&
        c.salon.lng != null &&
        distanceKm(position, { lat: c.salon.lat, lng: c.salon.lng }) <= km,
    );
    if (!widenRadius || within.length >= WIDEN_BELOW) out = within;
    else widened = 'radius';
  }

  return { admitted: out, widened, hiddenUnpriced };
}
