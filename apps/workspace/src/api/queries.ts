import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  LineQuoteRequestSchema} from '@velnes/contracts';
import {
  AppointmentChangesSchema,
  ChangeRequestListSchema,
  ChangeRequestSchema,
  AppointmentListResponseSchema,
  AvailabilityResponseSchema,
  BookResponseSchema,
  AppointmentSchema,
  CustomerListResponseSchema,
  DayScheduleSchema,
  EmployeeListResponseSchema,
  LineQuoteResponseSchema,
  LocationCatalogResponseSchema,
  LocationListResponseSchema,
  type BookRequest,
} from '@velnes/contracts';
import type { z } from 'zod';
import { get, patch, post } from '@velnes/client';

export const useLocations = () =>
  useQuery({
    queryKey: ['locations'],
    queryFn: () => get(LocationListResponseSchema, '/locations'),
  });

export const useEmployees = () =>
  useQuery({
    queryKey: ['employees'],
    queryFn: () => get(EmployeeListResponseSchema, '/employees'),
  });

export const useLocationCatalog = (locationId: string | null) =>
  useQuery({
    queryKey: ['catalog', locationId],
    queryFn: () => get(LocationCatalogResponseSchema, `/locations/${locationId}/catalog`),
    enabled: !!locationId,
  });

export const useDaySchedule = (locationId: string | null, date: string) =>
  useQuery({
    queryKey: ['schedule', locationId, date],
    queryFn: () => get(DayScheduleSchema, `/locations/${locationId}/schedule?date=${date}`),
    enabled: !!locationId,
  });

export const useAppointments = (locationId: string | null, from: string, to: string) =>
  useQuery({
    queryKey: ['appointments', locationId, from, to],
    queryFn: () =>
      get(
        AppointmentListResponseSchema,
        `/appointments?locationId=${locationId}&from=${from}&to=${to}`,
      ),
    enabled: !!locationId,
  });

export const useAvailability = (q: {
  locationId: string | null;
  serviceId: string | null;
  employeeId: string;
  date: string;
  variantId?: string | null;
}) =>
  useQuery({
    queryKey: ['availability', q],
    queryFn: () =>
      get(
        AvailabilityResponseSchema,
        `/availability?locationId=${q.locationId}&serviceId=${q.serviceId}&employeeId=${q.employeeId}&date=${q.date}` +
          (q.variantId ? `&variantId=${q.variantId}` : ''),
      ),
    enabled: !!q.locationId && !!q.serviceId,
  });

export const useLineQuote = (body: z.infer<typeof LineQuoteRequestSchema> | null) =>
  useQuery({
    queryKey: ['lineQuote', body],
    queryFn: () => post(LineQuoteResponseSchema, '/catalog/line-quote', body),
    enabled: !!body,
  });

export const useCustomers = (query: string) =>
  useQuery({
    queryKey: ['customers', query],
    queryFn: () =>
      get(CustomerListResponseSchema, `/customers?query=${encodeURIComponent(query)}`),
  });

export const useBook = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BookRequest) => post(BookResponseSchema, '/appointments', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['appointments'] }),
  });
};

/** The salon's answer to a booking request — accept or decline. */
export const useDecideRequest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; decision: 'accept' | 'decline'; reason?: string | undefined }) =>
      post(AppointmentSchema, `/appointments/${v.id}/decide`, {
        decision: v.decision,
        ...(v.reason ? { reason: v.reason } : {}),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['appointments'] }),
  });
};

/** Booking changes (2026-09-30): what a visit went through, the
 *  requests waiting for the salon, and the two decisions. */
export const useAppointmentChanges = (id: string | null) =>
  useQuery({
    queryKey: ['appointment-changes', id],
    queryFn: () => get(AppointmentChangesSchema, `/appointments/${id}/changes`),
    enabled: !!id,
    staleTime: 10_000,
  });
export const useChangeRequests = (status: 'pending' | 'declined' | 'approved' | 'withdrawn' | 'resolved' = 'pending') =>
  useQuery({
    queryKey: ['change-requests', status],
    queryFn: () => get(ChangeRequestListSchema, `/change-requests?status=${status}`),
    refetchInterval: 60_000,
  });
export const useDecideChange = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; action: 'approve' | 'decline'; reason?: string | undefined }) =>
      post(ChangeRequestSchema, `/change-requests/${v.id}/${v.action}`, v.reason ? { reason: v.reason } : {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['appointments'] });
      void qc.invalidateQueries({ queryKey: ['appointment-changes'] });
      void qc.invalidateQueries({ queryKey: ['change-requests'] });
    },
  });
};

export const useCancelAppointment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      patch(AppointmentSchema, `/appointments/${id}`, { status: 'cancelled' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['appointments'] }),
  });
};
