import { DEFAULT_SEARCH_CONFIG, type SearchConfigPayload } from '@velnes/contracts';
import { describe, expect, it } from 'vitest';
import { affinityOf, distanceKm, rank, type RankCandidate, type ViewerHistory } from './rank.js';

/**
 * Step 2 of Phase B: the ranker, tested without a database.
 *
 * Ranking is where test suites usually give up, so §7 names what is
 * actually checkable: a golden order, each component in isolation, the
 * inert ones proven inert, determinism, renormalisation, dedup and cold
 * start.
 */

const NOW = new Date('2026-09-20T12:00:00Z');
const SKOPJE = { lat: 41.9981, lng: 21.4254 };

/** Old enough that the new-salon window never fires by accident. */
const ESTABLISHED = '2024-01-01T00:00:00Z';

function candidate(over: Partial<RankCandidate> & { id: string }): RankCandidate {
  return {
    name: over.name ?? `Service ${over.id}`,
    categoryId: 'cat-massage',
    durationMin: 60,
    price: 2000,
    priceFrom: null,
    ...over,
    salon: {
      slug: `salon-${over.id}`,
      businessId: `biz-${over.id}`,
      name: `Salon ${over.id}`,
      lat: SKOPJE.lat,
      lng: SKOPJE.lng,
      bookable: true,
      createdAt: ESTABLISHED,
      ...(over.salon ?? {}),
    },
  };
}

const noHistory: ViewerHistory = {
  services: {},
  businesses: {},
  categories: {},
  durationsByCategory: {},
  favouriteServiceIds: [],
  favouriteBusinessIds: [],
};

const cfg = DEFAULT_SEARCH_CONFIG;
const order = (rs: ReturnType<typeof rank>) => rs.map((r) => r.candidate.id);

describe('the ranker', () => {
  it('produces one exact order for a fixed world — the golden test', () => {
    // A close, cheap, bookable salon; a far one; an expensive one; one
    // that takes no online bookings. Any weight change moves this, which
    // is the point of writing it down.
    const cands = [
      candidate({ id: 'far', salon: { ...candidate({ id: 'far' }).salon, lat: 41.5, lng: 20.9 } }),
      candidate({ id: 'pricey', price: 6000 }),
      candidate({ id: 'near-cheap', price: 1200 }),
      candidate({
        id: 'offline',
        price: 1000,
        salon: { ...candidate({ id: 'offline' }).salon, bookable: false },
      }),
    ];
    const ranked = rank(cands, { position: SKOPJE, history: null }, cfg, { now: NOW });
    expect(order(ranked)).toEqual(['near-cheap', 'pricey', 'offline', 'far']);
  });

  it('would let a nearby unbookable salon beat a distant bookable one — which is why admission exists', () => {
    // The ranker weighs; it does not forbid. At proximity 0.30 against
    // availability 0.20 a salon on your street that takes no online
    // bookings does out-score a bookable one 70km away, and no weight
    // can be trusted to prevent that because another weight can always
    // out-argue it.
    //
    // So consumer service discovery does not hand it such a candidate
    // in the first place: bookability is a Stage 1 admission rule (see
    // admittedBusinesses in discovery.routes.ts), and this test is kept
    // to show exactly what that rule is protecting against.
    const near = candidate({ id: 'near-offline' });
    near.salon.bookable = false;
    const far = candidate({
      id: 'far-bookable',
      salon: { ...candidate({ id: 'far-bookable' }).salon, lat: 41.5, lng: 20.9 },
    });
    const ranked = rank([far, near], { position: SKOPJE, history: null }, cfg, { now: NOW });
    expect(order(ranked)).toEqual(['near-offline', 'far-bookable']);
  });

  it('returns the same order twice — a page that reshuffles is untrustworthy', () => {
    const cands = [candidate({ id: 'a' }), candidate({ id: 'b' }), candidate({ id: 'c' })];
    const viewer = { position: SKOPJE, history: null };
    expect(order(rank(cands, viewer, cfg, { now: NOW }))).toEqual(
      order(rank(cands, viewer, cfg, { now: NOW })),
    );
  });

  describe('one component at a time', () => {
    it('prefers the nearer salon, all else equal', () => {
      const near = candidate({ id: 'near' });
      const far = candidate({
        id: 'far',
        salon: { ...candidate({ id: 'far' }).salon, lat: 42.6, lng: 21.16 },
      });
      const ranked = rank([far, near], { position: SKOPJE, history: null }, cfg, { now: NOW });
      expect(order(ranked)).toEqual(['near', 'far']);
    });

    it('prefers the cheaper treatment, all else equal', () => {
      const ranked = rank(
        [candidate({ id: 'dear', price: 5000 }), candidate({ id: 'cheap', price: 1000 })],
        { position: null, history: null },
        cfg,
        { now: NOW },
      );
      expect(order(ranked)).toEqual(['cheap', 'dear']);
    });

    it('prefers a salon you can actually book', () => {
      const off = candidate({ id: 'off' });
      off.salon.bookable = false;
      const ranked = rank([off, candidate({ id: 'on' })], { position: null, history: null }, cfg, {
        now: NOW,
      });
      expect(order(ranked)).toEqual(['on', 'off']);
    });

    it('lifts a treatment the viewer has booked before over a cheaper stranger', () => {
      const known = candidate({ id: 'known', price: 3000 });
      const stranger = candidate({ id: 'stranger', price: 2500 });
      const history: ViewerHistory = {
        ...noHistory,
        services: { known: '2026-09-01T00:00:00Z' },
      };
      const cold = rank([known, stranger], { position: null, history: null }, cfg, { now: NOW });
      expect(order(cold), 'without history the cheaper one leads').toEqual(['stranger', 'known']);
      const warm = rank([known, stranger], { position: null, history }, cfg, { now: NOW });
      expect(order(warm), 'with history the familiar one leads').toEqual(['known', 'stranger']);
    });
  });

  describe('affinity', () => {
    it('decays with age — a haircut booked years ago is not a preference', () => {
      const c = candidate({ id: 'x' });
      const recent = affinityOf(c, { ...noHistory, services: { x: '2026-09-19T00:00:00Z' } }, cfg, NOW);
      const halfYear = affinityOf(c, { ...noHistory, services: { x: '2026-03-24T00:00:00Z' } }, cfg, NOW);
      const ancient = affinityOf(c, { ...noHistory, services: { x: '2023-01-01T00:00:00Z' } }, cfg, NOW);
      expect(recent).toBeGreaterThan(halfYear);
      expect(halfYear).toBeGreaterThan(ancient);
      // 180-day half-life: six months back is worth about half.
      expect(halfYear).toBeCloseTo(0.5, 1);
    });

    it('combines with max, not sum — one loyal relationship cannot swamp the rest', () => {
      const c = candidate({ id: 'x' });
      // Booked this exact service, at this salon, in this category: if
      // these summed, affinity would exceed 1 and drown every other
      // component. It must not.
      const all = affinityOf(
        c,
        {
          ...noHistory,
          services: { x: NOW.toISOString() },
          businesses: { 'biz-x': NOW.toISOString() },
          categories: { 'cat-massage': NOW.toISOString() },
          durationsByCategory: { 'cat-massage': [60] },
        },
        cfg,
        NOW,
      );
      expect(all).toBeLessThanOrEqual(1);
      expect(all).toBeCloseTo(cfg.affinity.weights.bookedThisService, 5);
    });

    it('counts a similar treatment, and does not count an unrelated one', () => {
      const c = candidate({ id: 'x', durationMin: 60 });
      const similar = affinityOf(
        c,
        {
          ...noHistory,
          categories: { 'cat-massage': NOW.toISOString() },
          durationsByCategory: { 'cat-massage': [75] }, // within ±50%
        },
        cfg,
        NOW,
      );
      const unrelated = affinityOf(
        c,
        {
          ...noHistory,
          categories: { 'cat-massage': NOW.toISOString() },
          durationsByCategory: { 'cat-massage': [15] }, // far outside
        },
        cfg,
        NOW,
      );
      expect(similar).toBeCloseTo(cfg.affinity.weights.bookedSimilar, 5);
      expect(unrelated).toBeCloseTo(cfg.affinity.weights.bookedInCategory, 5);
      expect(similar).toBeGreaterThan(unrelated);
    });

    it('does not double-count a treatment that is both booked and favourited', () => {
      // Phase C's guard, and the reason §2.2 chose max over sum before
      // favourites existed. Booked scores 1.00 and favourited 0.90; if
      // these were added the result would be 1.90 and one relationship
      // would drown every other component.
      const c = candidate({ id: 'x' });
      const bookedOnly = affinityOf(c, { ...noHistory, services: { x: NOW.toISOString() } }, cfg, NOW);
      const favOnly = affinityOf(c, { ...noHistory, favouriteServiceIds: ['x'] }, cfg, NOW);
      const both = affinityOf(
        c,
        { ...noHistory, services: { x: NOW.toISOString() }, favouriteServiceIds: ['x'] },
        cfg,
        NOW,
      );
      expect(bookedOnly).toBeCloseTo(cfg.affinity.weights.bookedThisService, 5);
      expect(favOnly).toBeCloseTo(cfg.affinity.weights.favourited, 5);
      expect(both, 'max, not sum').toBeCloseTo(Math.max(bookedOnly, favOnly), 5);
      expect(both).toBeLessThanOrEqual(1);
    });

    it('counts a favourite without decaying it — a favourite is not an event', () => {
      // A booking fades; a standing statement about what you like does
      // not. Nothing about when it was saved enters the score.
      const c = candidate({ id: 'x' });
      const now = affinityOf(c, { ...noHistory, favouriteServiceIds: ['x'] }, cfg, NOW);
      const later = affinityOf(
        c,
        { ...noHistory, favouriteServiceIds: ['x'] },
        cfg,
        new Date('2030-01-01T00:00:00Z'),
      );
      expect(later).toBe(now);
    });

    it('lets a favourited salon lift its treatments', () => {
      const liked = candidate({ id: 'liked', price: 4000 });
      const other = candidate({ id: 'other', price: 2000 });
      const cold = rank([liked, other], { position: null, history: noHistory }, cfg, { now: NOW });
      expect(order(cold), 'on price alone the cheaper leads').toEqual(['other', 'liked']);
      const warm = rank(
        [liked, other],
        { position: null, history: { ...noHistory, favouriteBusinessIds: ['biz-liked'] } },
        cfg,
        { now: NOW },
      );
      expect(order(warm)).toEqual(['liked', 'other']);
    });

    it('is absent entirely for a viewer with no history', () => {
      const ranked = rank([candidate({ id: 'a' })], { position: null, history: null }, cfg, {
        now: NOW,
      });
      expect(ranked[0]!.components.affinity).toBeUndefined();
    });
  });

  describe('text relevance', () => {
    it('is absent entirely when the request carried no text', () => {
      // A category card has nothing to answer. The component drops out
      // of the weighting and the rest renormalise — the same mechanism
      // as a viewer who gave no location.
      const ranked = rank([candidate({ id: 'a' })], { position: null, history: null }, cfg, {
        now: NOW,
      });
      expect(ranked[0]!.components.textRelevance).toBeUndefined();
    });

    /** A candidate at a chosen distance due north of Skopje. */
    const atKm = (id: string, km: number, textRelevance: number) => {
      const c = candidate({ id });
      return {
        ...c,
        textRelevance,
        salon: { ...c.salon, lat: SKOPJE.lat + km / 111, lng: SKOPJE.lng },
      };
    };

    it('lifts a named treatment over a nearer stranger, across a city', () => {
      // Someone typed "deep tissue". The deep tissue treatment three
      // kilometres away should beat a generic massage next door.
      const ranked = rank(
        [atKm('nearer', 0.05, 0.5), atKm('named', 3, 1)],
        { position: SKOPJE, history: null },
        cfg,
        { now: NOW },
      );
      expect(order(ranked)).toEqual(['named', 'nearer']);
    });

    it('lets distance win again once the named treatment is far enough away', () => {
      // The trade-off is real and worth pinning rather than pretending
      // text always wins: at 0.50 against proximity 0.30 and a 5km
      // decay, the crossover is about nine kilometres. Forty is well
      // past it, and at that point "nearest thing that fits" is the
      // better answer.
      const ranked = rank(
        [atKm('nearer', 0.05, 0.5), atKm('named', 40, 1)],
        { position: SKOPJE, history: null },
        cfg,
        { now: NOW },
      );
      expect(order(ranked)).toEqual(['nearer', 'named']);
    });

    it('gives a treatment found through its category the neutral middle', () => {
      const withText = { ...candidate({ id: 'a' }), textRelevance: 1 };
      const viaCategory = candidate({ id: 'b' }); // no textRelevance
      const ranked = rank([withText, viaCategory], { position: null, history: null }, cfg, {
        now: NOW,
      });
      const b = ranked.find((r) => r.candidate.id === 'b')!;
      // Not zero: being found the ordinary way is not evidence against
      // a treatment, exactly as a hidden price is not.
      expect(b.components.textRelevance).toBe(0.5);
    });

    it('carries no weight in a config written before text search existed', () => {
      // v1 has no textRelevance at all. Activating it again should roll
      // the component back to nothing rather than raise.
      const old: SearchConfigPayload = {
        ...cfg,
        weights: { ...cfg.weights, textRelevance: 0 },
      };
      const cands = [
        { ...candidate({ id: 'named' }), textRelevance: 1 },
        { ...candidate({ id: 'other' }), textRelevance: 0.5, price: 1000 },
      ];
      const ranked = rank(cands, { position: null, history: null }, old, { now: NOW });
      // With the weight at zero the cheaper one leads on value alone.
      expect(order(ranked)).toEqual(['other', 'named']);
    });
  });

  describe('the inert components', () => {
    it('change no order, because their weights are zero', () => {
      const cands = [candidate({ id: 'a' }), candidate({ id: 'b', price: 3000 })];
      const viewer = { position: SKOPJE, history: null };
      const base = order(rank(cands, viewer, cfg, { now: NOW }));
      // Turn quality and exposure up to full: if either were wired into
      // the score today, this order would move.
      const loud: SearchConfigPayload = {
        ...cfg,
        weights: { ...cfg.weights, quality: 1, exposure: 1 },
      };
      const withQuality = rank(cands, viewer, loud, { now: NOW });
      expect(withQuality.every((r) => r.components.exposure === 0)).toBe(true);
      // quality is the same constant for everybody, so it cannot reorder.
      expect(order(withQuality)).toEqual(base);
    });
  });

  describe('renormalisation', () => {
    it('keeps a signed-out viewer with no location on a sensible order', () => {
      const ranked = rank(
        [candidate({ id: 'dear', price: 5000 }), candidate({ id: 'cheap', price: 1000 })],
        { position: null, history: null },
        cfg,
        { now: NOW },
      );
      expect(order(ranked)).toEqual(['cheap', 'dear']);
      // Not everything bunched at the midpoint: the components that do
      // apply keep their full strength.
      expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
    });

    it('does not punish a salon that publishes no prices', () => {
      const hidden = candidate({ id: 'hidden', price: null, priceFrom: null });
      const median = candidate({ id: 'median', price: 2000 });
      const ranked = rank([hidden, median], { position: null, history: null }, cfg, { now: NOW });
      const h = ranked.find((r) => r.candidate.id === 'hidden')!;
      const m = ranked.find((r) => r.candidate.id === 'median')!;
      // Neutral, not zero — hiding prices must not be a ranking penalty.
      expect(h.components.value).toBe(0.5);
      expect(h.score).toBeCloseTo(m.score, 5);
    });

    it('treats a missing pin as unknown rather than as far away', () => {
      const pinless = candidate({ id: 'pinless' });
      pinless.salon.lat = null;
      pinless.salon.lng = null;
      const ranked = rank([pinless], { position: SKOPJE, history: null }, cfg, { now: NOW });
      expect(ranked[0]!.components.proximity).toBe(0.5);
    });
  });

  describe('diversity', () => {
    it('lets one business take at most two of the first ten', () => {
      // One chain with six strong matches, plus four other salons.
      const chain = Array.from({ length: 6 }, (_, i) =>
        candidate({
          id: `chain-${i}`,
          price: 500 + i,
          salon: {
            slug: `chain-${i}`,
            businessId: 'the-chain',
            name: 'The Chain',
            lat: SKOPJE.lat,
            lng: SKOPJE.lng,
            bookable: true,
            createdAt: ESTABLISHED,
          },
        }),
      );
      // More than the window holds, so that "the first ten" means
      // something. With ten candidates and a ten-slot window the cap
      // could never be observed.
      const others = Array.from({ length: 12 }, (_, i) =>
        candidate({ id: `other-${i}`, price: 3000 + i }),
      );
      const ranked = rank([...chain, ...others], { position: SKOPJE, history: null }, cfg, {
        now: NOW,
      });
      const inWindow = ranked
        .slice(0, cfg.diversity.windowSize)
        .filter((r) => r.candidate.salon.businessId === 'the-chain');
      expect(inWindow.length).toBe(cfg.diversity.maxPerBusinessInWindow);
      // Moved below the window, never dropped: a salon with six relevant
      // treatments should not be hidden, only prevented from being the
      // whole page.
      expect(ranked.length).toBe(18);
      expect(ranked.filter((r) => r.candidate.salon.businessId === 'the-chain').length).toBe(6);
      const tailChain = ranked
        .slice(cfg.diversity.windowSize)
        .filter((r) => r.candidate.salon.businessId === 'the-chain');
      expect(tailChain.length).toBe(4);
    });

    it('gives a brand-new salon a place on the first page', () => {
      // Twelve established salons that all outrank it, and one salon
      // that opened yesterday with nothing going for it.
      const established = Array.from({ length: 12 }, (_, i) =>
        candidate({ id: `old-${i}`, price: 1000 + i }),
      );
      const fresh = candidate({
        id: 'fresh',
        price: 9000,
        salon: {
          slug: 'fresh',
          businessId: 'biz-fresh',
          name: 'Brand New',
          lat: SKOPJE.lat,
          lng: SKOPJE.lng,
          bookable: true,
          createdAt: '2026-09-19T00:00:00Z',
        },
      });
      const ranked = rank([...established, fresh], { position: SKOPJE, history: null }, cfg, {
        now: NOW,
      });
      const at = ranked.findIndex((r) => r.candidate.id === 'fresh');
      expect(at, 'a new salon that never surfaces can never join').toBeLessThan(
        cfg.diversity.windowSize,
      );
    });

    it('leaves the order alone when a new salon already ranks well', () => {
      const fresh = candidate({
        id: 'fresh',
        price: 100,
        salon: {
          slug: 'fresh',
          businessId: 'biz-fresh',
          name: 'Brand New',
          lat: SKOPJE.lat,
          lng: SKOPJE.lng,
          bookable: true,
          createdAt: '2026-09-19T00:00:00Z',
        },
      });
      const ranked = rank([fresh, candidate({ id: 'old', price: 5000 })], {
        position: SKOPJE,
        history: null,
      }, cfg, { now: NOW });
      expect(order(ranked)).toEqual(['fresh', 'old']);
    });
  });

  it('measures distance well enough for ranking', () => {
    // Skopje to Bitola is roughly 130 km as the crow flies.
    expect(distanceKm(SKOPJE, { lat: 41.0314, lng: 21.3347 })).toBeGreaterThan(100);
    expect(distanceKm(SKOPJE, { lat: 41.0314, lng: 21.3347 })).toBeLessThan(160);
    expect(distanceKm(SKOPJE, SKOPJE)).toBe(0);
  });
});

describe('"now" — the earliest available first', () => {
  it('puts what can start within the half hour first, soonest first, and the rest in their earned order', () => {
    // Three ordinary candidates and one the ranker would otherwise put
    // last (pricey, far). Asked for now, the two that can start lead —
    // 10:30 before 11:00 — whatever their scores; the two that cannot
    // follow in the order they already had.
    const cands = [
      candidate({ id: 'cheap-later', price: 800, availableAt: null }),
      candidate({ id: 'far-soon', price: 6000, salon: { ...candidate({ id: 'far-soon' }).salon, lat: 41.5, lng: 20.9 }, availableAt: '11:00' }),
      candidate({ id: 'mid-later', price: 2000, availableAt: null }),
      candidate({ id: 'near-soon', price: 2000, availableAt: '10:30' }),
    ];
    const got = order(rank(cands, { position: SKOPJE, history: null }, cfg, { now: NOW }));
    expect(got.slice(0, 2)).toEqual(['near-soon', 'far-soon']);
    // The tail keeps the ordinary order: cheaper and equally near first.
    expect(got.slice(2)).toEqual(['cheap-later', 'mid-later']);
  });

  it('is the availability component: a start within the window is 1, none is 0', () => {
    const cands = [
      candidate({ id: 'a', availableAt: '10:30' }),
      candidate({ id: 'b', availableAt: null }),
    ];
    const got = rank(cands, { position: null, history: null }, cfg, { now: NOW });
    expect(got.find((r) => r.candidate.id === 'a')!.components.availability).toBe(1);
    expect(got.find((r) => r.candidate.id === 'b')!.components.availability).toBe(0);
  });

  it('changes nothing when now was not asked — availability stays the widget proxy', () => {
    const plain = [candidate({ id: 'x' }), candidate({ id: 'y', price: 800 })];
    const got = rank(plain, { position: null, history: null }, cfg, { now: NOW });
    expect(got.every((r) => r.components.availability === 1)).toBe(true);
    expect(order(got)).toEqual(['y', 'x']);
  });
});
