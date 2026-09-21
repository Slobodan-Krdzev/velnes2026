import { describe, expect, it } from 'vitest';
import { applyFilters, inBand, priceOf, priceTercilesOf, WIDEN_BELOW } from './filters.js';
import type { RankCandidate } from './rank.js';

/**
 * Step 8 of the Search phase — docs/SEARCH.md.
 *
 * Filters are hard admission, decided here and nowhere else. Pure, so
 * the rules can be tested without a database: what a band means, when
 * bands are honest enough to offer at all, and what is allowed to be
 * quietly widened (almost nothing).
 */

let n = 0;
function cand(p: number | null, extra: Partial<RankCandidate> = {}): RankCandidate {
  n += 1;
  return {
    id: `s${n}`,
    name: `Service ${n}`,
    categoryId: 'cat-a',
    durationMin: 60,
    price: p,
    priceFrom: null,
    salon: {
      slug: `salon-${n}`,
      businessId: `biz-${n}`,
      name: `Salon ${n}`,
      lat: 41.9981,
      lng: 21.4254,
      bookable: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    ...extra,
  };
}
const SKOPJE = { lat: 41.9981, lng: 21.4254 };
/** Far enough that no plausible radius reaches it. */
const OHRID = { lat: 41.1231, lng: 20.8016 };
const none = { radiusKm: null, priceBand: null, categoryId: null };

describe('what a treatment costs, for filtering', () => {
  it('is the cheapest way in, not the headline', () => {
    // Filtering a service by a price the customer need never pay would
    // hide it from exactly the band it belongs in.
    expect(priceOf(cand(4000, { priceFrom: 900 }))).toBe(900);
    expect(priceOf(cand(4000))).toBe(4000);
    expect(priceOf(cand(null))).toBeNull();
  });
});

describe('price bands', () => {
  it('are terciles of this answer, not of the platform', () => {
    const t = priceTercilesOf([300, 600, 900, 1200, 1500, 1800].map((p) => cand(p)))!;
    expect(t).toEqual({ lowMax: 600, midMax: 1200 });
    // Each boundary is inclusive upward, so every price lands in
    // exactly one band and none falls through the gaps.
    expect(inBand(600, 'low', t)).toBe(true);
    expect(inBand(601, 'low', t)).toBe(false);
    expect(inBand(601, 'mid', t)).toBe(true);
    expect(inBand(1200, 'mid', t)).toBe(true);
    expect(inBand(1201, 'high', t)).toBe(true);
  });

  it('are absent rather than misleading on thin data', () => {
    // Three bands over five treatments sorts them into ones and twos.
    expect(priceTercilesOf([100, 200, 300, 400, 500].map((p) => cand(p)))).toBeNull();
    // Enough prices, but not enough different ones — a control that
    // cannot do what it says should not be offered.
    expect(priceTercilesOf([500, 500, 500, 500, 500, 500].map((p) => cand(p)))).toBeNull();
  });

  it('ignore treatments whose salon publishes no prices', () => {
    const t = priceTercilesOf(
      [300, 600, 900, 1200, 1500, 1800].map((p) => cand(p)).concat([cand(null), cand(null)]),
    )!;
    expect(t).toEqual({ lowMax: 600, midMax: 1200 });
    // And an unpriced treatment is in no band at all.
    expect(inBand(null, 'low', t)).toBe(false);
    expect(inBand(null, 'high', t)).toBe(false);
  });
});

describe('admission', () => {
  const priced = [300, 600, 900, 1200, 1500, 1800].map((p) => cand(p));

  it('removes what a band excludes rather than demoting it', () => {
    const t = priceTercilesOf(priced)!;
    const { admitted } = applyFilters(priced, { ...none, priceBand: 'low' }, null, t);
    expect(admitted.map((c) => c.price)).toEqual([300, 600]);
  });

  it('says how many treatments a band hid for having no price', () => {
    const pool = [...priced, cand(null), cand(null)];
    const t = priceTercilesOf(pool)!;
    const { admitted, hiddenUnpriced } = applyFilters(pool, { ...none, priceBand: 'low' }, null, t);
    // A salon that hides its prices vanishing from a price filter looks
    // like a missing salon unless the page can say why.
    expect(hiddenUnpriced).toBe(2);
    expect(admitted.every((c) => c.price != null)).toBe(true);
  });

  it('does nothing about price when the bands were too thin to offer', () => {
    const thin = [100, 200, 300].map((p) => cand(p));
    const { admitted } = applyFilters(thin, { ...none, priceBand: 'high' }, null, null);
    expect(admitted).toHaveLength(3);
  });

  it('narrows to one category, and only when asked', () => {
    const pool = [cand(100), cand(200, { categoryId: 'cat-b' })];
    expect(applyFilters(pool, none, null, null).admitted).toHaveLength(2);
    expect(
      applyFilters(pool, { ...none, categoryId: 'cat-b' }, null, null).admitted.map((c) => c.id),
    ).toEqual([pool[1]!.id]);
  });

  it('ignores a radius when nobody said where they are', () => {
    // Distance without a position is not a filter, it is a guess.
    const { admitted, widened } = applyFilters(priced, { ...none, radiusKm: 1 }, null, null);
    expect(admitted).toHaveLength(priced.length);
    expect(widened).toBeNull();
  });

  describe('the radius', () => {
    const far = Array.from({ length: 8 }, () => cand(500, { salon: { ...cand(0).salon, ...OHRID } }));
    const near = Array.from({ length: WIDEN_BELOW }, () => cand(500));

    it('is hard, and by default never widens — Phase B settled that', () => {
      const { admitted, widened } = applyFilters(far, { ...none, radiusKm: 5 }, SKOPJE, null);
      expect(admitted).toHaveLength(0);
      expect(widened).toBeNull();
    });

    it('widens once for a text query, and says so', () => {
      const { admitted, widened } = applyFilters(far, { ...none, radiusKm: 5 }, SKOPJE, null, true);
      expect(admitted).toHaveLength(far.length);
      // Silently widening and presenting the result as the search is
      // the one thing this surface must not do.
      expect(widened).toBe('radius');
    });

    it('does not widen when enough survive it', () => {
      const pool = [...near, ...far];
      const { admitted, widened } = applyFilters(pool, { ...none, radiusKm: 5 }, SKOPJE, null, true);
      expect(admitted).toHaveLength(near.length);
      expect(widened).toBeNull();
    });
  });

  it('never widens a price band or a category, however little is left', () => {
    const t = priceTercilesOf(priced)!;
    const { admitted, widened } = applyFilters(
      priced,
      { ...none, priceBand: 'low', categoryId: 'cat-nothing' },
      null,
      t,
      true,
    );
    // An explicit choice that returns nothing returns nothing. Answering
    // a question nobody asked is worse than an empty page.
    expect(admitted).toHaveLength(0);
    expect(widened).toBeNull();
  });
});
