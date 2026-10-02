import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import type { z } from 'zod';
import type {
  DiscoveryRecommendedSchema,
  DiscoveryNewestSchema,
  AvailabilityResponseSchema,
  DiscoveryCategoriesSchema,
  DiscoverySalonDetailSchema,
  DiscoverySalonsSchema,
  DiscoveryCategoryServicesSchema,
  DiscoveryRankedServicesSchema,
  DiscoverySuggestionsSchema,
  DiscoveryTownsSchema,
  MostChosenSchema,
  SearchResultsSchema,
  AmenityKey,
  PriceBand,
  PublicServicesResponseSchema,
  PublicReviewsPageSchema,
  When,
} from '@velnes/contracts';
import { pub, pubGet, pubPost } from './client.js';

type Categories = z.infer<typeof DiscoveryCategoriesSchema>;
type Salons = z.infer<typeof DiscoverySalonsSchema>;
type Recommended = z.infer<typeof DiscoveryRecommendedSchema>;
type Newest = z.infer<typeof DiscoveryNewestSchema>;
type SalonDetail = z.infer<typeof DiscoverySalonDetailSchema>;
type PublicReviewsPage = z.infer<typeof PublicReviewsPageSchema>;
type Services = z.infer<typeof PublicServicesResponseSchema>;
type CategoryServices = z.infer<typeof DiscoveryCategoryServicesSchema>;
type RankedServices = z.infer<typeof DiscoveryRankedServicesSchema>;

/**
 * What the viewer narrowed the answer to — step 8 of docs/SEARCH.md.
 *
 * Carried to the door and never applied here: filters are admission,
 * and a page that re-filtered what it was given would be showing a
 * different answer from the one the ranker produced.
 */
export interface SearchFilters {
  priceBand: PriceBand | null;
  categoryId: string | null;
  radiusKm: number | null;
  /** "Available now": what can start within the next half hour first,
   *  with a word from the door when nothing can. Not admission. */
  now: boolean;
  /** A town the salon is in — the sheet's "Where" when not "Nearby". */
  city: string | null;
  /** A price range in whole denars, inclusive — the filters panel's
   *  histogram handles; either end open when null. */
  priceMin: number | null;
  priceMax: number | null;
  /** Amenities the salon's location must all have — keys. */
  amenities: AmenityKey[];
  /** A day with a free start — today, tomorrow, this weekend — hard
   *  admission on the doors; each card then carries `availableOn`. */
  when: When | null;
  /** "For two": only where this many can be seen at the same time. */
  party: number;
}
export const NO_FILTERS: SearchFilters = {
  priceBand: null, categoryId: null, radiusKm: null, now: false, city: null, priceMin: null, priceMax: null, amenities: [], when: null, party: 1,
};
type Towns = z.infer<typeof DiscoveryTownsSchema>;
type Suggestions = z.infer<typeof DiscoverySuggestionsSchema>;

/**
 * Discovery suggestions for the search sheet's empty field — search
 * intents from the door, shaped by the viewer's own account when they
 * are signed in and allow it, by the town or position given, or by the
 * platform's inventory. Whether there is a token belongs in the key;
 * its value does not.
 */
export function useSuggestions(
  position: { lat: number; lng: number } | null,
  city: string | null,
  token: string | null,
) {
  const at = position
    ? { lat: Math.round(position.lat * 1000) / 1000, lng: Math.round(position.lng * 1000) / 1000 }
    : null;
  const qs = new URLSearchParams();
  if (at) {
    qs.set('lat', String(at.lat));
    qs.set('lng', String(at.lng));
  }
  if (city) qs.set('city', city);
  const q = qs.toString();
  return useQuery({
    queryKey: ['suggestions', at?.lat ?? null, at?.lng ?? null, city, Boolean(token)],
    queryFn: () => pubGet<Suggestions>(`/discovery/suggestions${q ? `?${q}` : ''}`, token),
    staleTime: 60_000,
  });
}

/** The towns admitted salons are in — the sheet's "Where" list. */
export function useTowns() {
  return useQuery({
    queryKey: ['towns'],
    queryFn: () => pub<Towns>('/discovery/towns'),
    staleTime: 5 * 60_000,
  });
}
type SearchResults = z.infer<typeof SearchResultsSchema>;
type MostChosen = z.infer<typeof MostChosenSchema>;
type Availability = z.infer<typeof AvailabilityResponseSchema>;

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => pub<Categories>('/discovery/categories'),
    staleTime: 5 * 60_000,
  });
}

export function useSalons() {
  return useQuery({
    queryKey: ['salons'],
    queryFn: () => pub<Salons>('/discovery/salons'),
    staleTime: 60_000,
  });
}

/** "Recommended for you": the door decides from the viewer's own
 *  bookings and favourites, else their position, and says which. */
export function useRecommended(position: { lat: number; lng: number } | null, token: string | null) {
  const at = position ? { lat: Math.round(position.lat * 1000) / 1000, lng: Math.round(position.lng * 1000) / 1000 } : null;
  const qs = at ? `?lat=${at.lat}&lng=${at.lng}` : '';
  return useQuery({
    queryKey: ['recommended', at?.lat ?? null, at?.lng ?? null, Boolean(token)],
    queryFn: async () => {
      const res = await fetch(`/api/v1/public/discovery/recommended${qs}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(res.statusText);
      return (await res.json()) as Recommended;
    },
    staleTime: 60_000,
  });
}

/** "Newest to Velnes": the salons that joined within the door's window. */
export function useNewest() {
  return useQuery({
    queryKey: ['newest'],
    queryFn: async () => {
      const res = await fetch('/api/v1/public/discovery/newest');
      if (!res.ok) throw new Error(res.statusText);
      return (await res.json()) as Newest;
    },
    staleTime: 60_000,
  });
}

/** A salon's verified reviews, newest first, `limit` at a time. */
export function useSalonReviews(slug: string | undefined, limit: number) {
  return useQuery({
    queryKey: ['salon-reviews', slug, limit],
    queryFn: () => pub<PublicReviewsPage>(`/discovery/salons/${slug}/reviews?limit=${limit}`),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });
}

export function useSalonDetail(slug: string | undefined) {
  return useQuery({
    queryKey: ['salon', slug],
    queryFn: () => pub<SalonDetail>(`/discovery/salons/${slug}`),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });
}

/** Everything offered in one category, across every listed salon — the
 *  door behind a category card. The id comes from the category list the
 *  app already holds, so this waits until that has arrived. */
export function useCategoryServices(categoryId: string | undefined) {
  return useQuery({
    queryKey: ['category-services', categoryId],
    queryFn: () => pub<CategoryServices>(`/discovery/categories/${categoryId}/services`),
    enabled: Boolean(categoryId),
    staleTime: 60_000,
  });
}

/**
 * The ranked form of the same results — §5.
 *
 * A POST because the position travels in the body: a precise location in
 * a URL ends up in access logs, proxy logs and referrers. The
 * coordinates are rounded to three decimals (~110m) here, before they
 * are sent — finer than ranking needs, and coarse enough that the exact
 * position never leaves the device. The rounding is also what keeps this
 * cacheable: a viewer who shifts a few metres is not a new query.
 */
export function useRankedCategoryServices(
  categoryId: string | undefined,
  position: { lat: number; lng: number } | null,
  token: string | null,
  filters: SearchFilters = NO_FILTERS,
) {
  const at = useSettledPosition(position);
  return useQuery({
    // Whether there is a token belongs in the key, because signing in or
    // out changes the order. The token's value does not — a cache key is
    // no place for a credential.
    queryKey: [
      'ranked-services',
      categoryId,
      at?.lat ?? null,
      at?.lng ?? null,
      Boolean(token),
      filters.priceBand,
      filters.radiusKm,
      filters.now,
      filters.city,
      filters.priceMin,
      filters.priceMax,
      filters.amenities.join(','),
      filters.when,
      filters.party,
    ],
    queryFn: () =>
      pubPost<RankedServices>(
        `/discovery/categories/${categoryId}/services`,
        {
          lat: at?.lat ?? null,
          lng: at?.lng ?? null,
          radiusKm: at ? filters.radiusKm : null,
          priceBand: filters.priceBand,
          now: filters.now,
          city: filters.city,
          priceMin: filters.priceMin,
          priceMax: filters.priceMax,
          amenities: filters.amenities,
          when: filters.when,
          party: filters.party,
        },
        token,
      ),
    enabled: Boolean(categoryId),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useSalonServices(key: string | null | undefined, locationId: string | undefined) {
  return useQuery({
    queryKey: ['services', key, locationId],
    queryFn: () => pub<Services>(`/services?key=${key}&locationId=${locationId}`),
    enabled: Boolean(key && locationId),
    staleTime: 60_000,
  });
}

/** Free times for a whole visit — one or several treatments. The one
 *  answer the salon page asks for, so a time is never offered that only
 *  part of the visit can keep. */
export function useVisitSlots(args: {
  key: string | null | undefined;
  locationId: string | undefined;
  date: string | undefined;
  employeeId?: string;
  items: { serviceId: string; variantId?: string | null; modifierOptionIds?: string[] }[];
}) {
  const { key, locationId, date, employeeId, items } = args;
  const sig = items.map((i) => `${i.serviceId}:${i.variantId ?? ''}:${(i.modifierOptionIds ?? []).join('+')}`).join(',');
  return useQuery({
    queryKey: ['visit-slots', key, locationId, date, employeeId ?? 'any', sig],
    queryFn: () =>
      pubPost<Availability>('/slots', {
        key,
        locationId,
        date,
        employeeId: employeeId ?? 'any',
        items: items.map((i) => ({
          serviceId: i.serviceId,
          ...(i.variantId ? { variantId: i.variantId } : {}),
          modifierOptionIds: i.modifierOptionIds ?? [],
        })),
      }),
    enabled: Boolean(key && locationId && date && items.length),
    staleTime: 30_000,
  });
}

export function useAvailability(args: {
  key: string | null | undefined;
  locationId: string | undefined;
  serviceId: string | undefined;
  date: string | undefined;
  employeeId?: string;
  variantId?: string | null;
}) {
  const { key, locationId, serviceId, date, employeeId, variantId } = args;
  return useQuery({
    queryKey: ['availability', key, locationId, serviceId, date, employeeId ?? 'any', variantId ?? ''],
    queryFn: () =>
      pub<Availability>(
        `/availability?key=${key}&locationId=${locationId}&serviceId=${serviceId}&date=${date}&employeeId=${employeeId ?? 'any'}` +
          (variantId ? `&variantId=${variantId}` : ''),
      ),
    enabled: Boolean(key && locationId && serviceId && date),
    staleTime: 30_000,
  });
}


/**
 * A submitted search — step 7 of docs/SEARCH.md.
 *
 * The same viewer context the category door takes, and the same
 * treatment of it: the position is rounded here before it is sent, and
 * travels in the body. Only the query reaches the URL, because a search
 * is worth sharing and a location is not.
 */
/**
 * The position a search is keyed on (Alex, 2026-10-02, from a phone:
 * "locating all the time, results so slow"). The live watch nudges the
 * fix every few seconds, and a key rounded to ~100 m changed with it —
 * each time a fresh request and an empty list. A search re-keys only
 * once the person has really moved (`SETTLE_M`); and while it refetches,
 * the previous list stays on screen (`keepPreviousData`).
 */
const SETTLE_M = 250;
function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}
export function settledPosition(
  last: { lat: number; lng: number } | null,
  next: { lat: number; lng: number } | null,
  settleM = SETTLE_M,
): { lat: number; lng: number } | null {
  if (!next) return null;
  if (last && metres(last, next) < settleM) return last;
  return { lat: Math.round(next.lat * 1000) / 1000, lng: Math.round(next.lng * 1000) / 1000 };
}
function useSettledPosition(position: { lat: number; lng: number } | null) {
  const last = useRef<{ lat: number; lng: number } | null>(null);
  last.current = settledPosition(last.current, position);
  return last.current;
}

export function useSearch(
  q: string | null,
  position: { lat: number; lng: number } | null,
  token: string | null,
  filters: SearchFilters = NO_FILTERS,
) {
  const at = useSettledPosition(position);
  return useQuery({
    queryKey: [
      'search',
      q,
      at?.lat ?? null,
      at?.lng ?? null,
      Boolean(token),
      filters.priceBand,
      filters.categoryId,
      filters.radiusKm,
      filters.now,
      filters.city,
      filters.priceMin,
      filters.priceMax,
      filters.amenities.join(','),
      filters.when,
      filters.party,
    ],
    queryFn: () =>
      pubPost<SearchResults>(
        '/discovery/search',
        {
          q,
          lat: at?.lat ?? null,
          lng: at?.lng ?? null,
          // A distance without a position filters nothing, and sending
          // one would only invite the door to think otherwise.
          radiusKm: at ? filters.radiusKm : null,
          priceBand: filters.priceBand,
          categoryId: filters.categoryId,
          now: filters.now,
          city: filters.city,
          priceMin: filters.priceMin,
          priceMax: filters.priceMax,
          amenities: filters.amenities,
          when: filters.when,
          party: filters.party,
        },
        token,
      ),
    enabled: Boolean(q && q.trim().length >= 2),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * "Most chosen" — step 9 of docs/SEARCH.md.
 *
 * What the platform books most, for the panel that opens before anybody
 * has typed. An empty list is a real answer and the expected one on
 * thin data: the panel then shows nothing rather than a label that
 * means nothing.
 *
 * Cached hard. It is a ninety-day aggregate; it does not move.
 */
export function useMostChosen() {
  return useQuery({
    queryKey: ['most-chosen'],
    queryFn: () => pub<MostChosen>('/discovery/most-chosen'),
    staleTime: 600_000,
  });
}
