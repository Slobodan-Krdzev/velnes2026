import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  AvailabilityResponseSchema,
  DiscoveryCategoriesSchema,
  DiscoverySalonDetailSchema,
  DiscoverySalonsSchema,
  DiscoveryCategoryServicesSchema,
  DiscoveryRankedServicesSchema,
  MostChosenSchema,
  SearchResultsSchema,
  PriceBand,
  PublicServicesResponseSchema,
} from '@velnes/contracts';
import { pub, pubPost } from './client.js';

type Categories = z.infer<typeof DiscoveryCategoriesSchema>;
type Salons = z.infer<typeof DiscoverySalonsSchema>;
type SalonDetail = z.infer<typeof DiscoverySalonDetailSchema>;
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
}
export const NO_FILTERS: SearchFilters = { priceBand: null, categoryId: null, radiusKm: null, now: false };
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
  const at = position
    ? { lat: Math.round(position.lat * 1000) / 1000, lng: Math.round(position.lng * 1000) / 1000 }
    : null;
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
        },
        token,
      ),
    enabled: Boolean(categoryId),
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
export function useSearch(
  q: string | null,
  position: { lat: number; lng: number } | null,
  token: string | null,
  filters: SearchFilters = NO_FILTERS,
) {
  const at = position
    ? { lat: Math.round(position.lat * 1000) / 1000, lng: Math.round(position.lng * 1000) / 1000 }
    : null;
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
        },
        token,
      ),
    enabled: Boolean(q && q.trim().length >= 2),
    staleTime: 60_000,
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
