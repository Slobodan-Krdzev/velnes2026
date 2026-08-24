import { z } from 'zod';

/** The lifecycle — states and legal edges exactly as the prototype's
 *  LOC_EDGES. One field, one transition door, one liveness predicate. */
export const LocationLifecycleSchema = z.enum([
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'CHANGES_REQUIRED',
  'RESUBMITTED',
  'APPROVED',
  'ACTIVE',
  'SUSPENDED',
  'CLOSED',
]);
export type LocationLifecycle = z.infer<typeof LocationLifecycleSchema>;

export const LOC_EDGES: Record<LocationLifecycle, LocationLifecycle[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW', 'CHANGES_REQUIRED', 'APPROVED'],
  UNDER_REVIEW: ['CHANGES_REQUIRED', 'APPROVED'],
  CHANGES_REQUIRED: ['RESUBMITTED'],
  RESUBMITTED: ['UNDER_REVIEW', 'CHANGES_REQUIRED', 'APPROVED'],
  APPROVED: ['ACTIVE'],
  ACTIVE: ['SUSPENDED', 'CLOSED'],
  SUSPENDED: ['ACTIVE', 'CLOSED'],
  CLOSED: [],
};

export const LocationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  city: z.string().nullable(),
  address: z.string().nullable(),
  tz: z.string(),
  phone: z.string().nullable(),
  rooms: z.number().int(),
  invPrefix: z.string().nullable(),
  online: z.boolean(),
  cancelHours: z.number().int(),
  opened: z.string().nullable(), // ISO date
  lifecycle: LocationLifecycleSchema,
});
export type Location = z.infer<typeof LocationSchema>;

export const LocationListResponseSchema = z.object({
  locations: z.array(LocationSchema),
});
export type LocationListResponse = z.infer<typeof LocationListResponseSchema>;

export const TransitionRequestSchema = z.object({
  to: LocationLifecycleSchema,
  reason: z.string().optional(),
});
export type TransitionRequest = z.infer<typeof TransitionRequestSchema>;

export const TransitionResponseSchema = z.object({
  location: LocationSchema,
});
export type TransitionResponse = z.infer<typeof TransitionResponseSchema>;

/** The readiness gate: five hard requirements; cosmetics never block. */
export const ReadinessItemSchema = z.object({
  k: z.enum(['legal', 'address', 'hours', 'service', 'staff']),
  label: z.string(),
  ok: z.boolean(),
});
export const ReadinessResponseSchema = z.object({
  items: z.array(ReadinessItemSchema),
  ok: z.boolean(),
});
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
