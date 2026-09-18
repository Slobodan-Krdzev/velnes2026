import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  AvailabilityResponseSchema,
  DiscoveryCategoriesSchema,
  DiscoverySalonDetailSchema,
  DiscoverySalonsSchema,
  PublicServicesResponseSchema,
} from '@velnes/contracts';
import { pub } from './client.js';

type Categories = z.infer<typeof DiscoveryCategoriesSchema>;
type Salons = z.infer<typeof DiscoverySalonsSchema>;
type SalonDetail = z.infer<typeof DiscoverySalonDetailSchema>;
type Services = z.infer<typeof PublicServicesResponseSchema>;
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

export function useSalonServices(key: string | null | undefined, locationId: string | undefined) {
  return useQuery({
    queryKey: ['services', key, locationId],
    queryFn: () => pub<Services>(`/services?key=${key}&locationId=${locationId}`),
    enabled: Boolean(key && locationId),
    staleTime: 60_000,
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
