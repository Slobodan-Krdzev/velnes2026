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

export const LegalEntityRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  taxId: z.string().nullable(),
  status: z.string(),
  isDefault: z.boolean(),
});
export const LegalEntityListSchema = z.object({
  entities: z.array(LegalEntityRowSchema),
});

/** The New-location wizard's one door: create (scratch or snapshot
 *  copy), attach or create the legal entity, optionally submit to HQ
 *  in the same act. */
export const CopyChecklistSchema = z.object({
  services: z.boolean().default(true),
  prices: z.boolean().default(true),
  timing: z.boolean().default(true),
  products: z.boolean().default(true),
  hours: z.boolean().default(true),
  policies: z.boolean().default(true),
  payments: z.boolean().default(true),
});
export type CopyChecklist = z.infer<typeof CopyChecklistSchema>;

export const LocationCreateSchema = z.object({
  name: z.string().min(1),
  city: z.string().min(1),
  address: z.string().min(1),
  zip: z.string().default(''),
  country: z.string().default('North Macedonia'),
  tz: z.string().default('Europe/Skopje'),
  phone: z.string().default(''),
  rooms: z.coerce.number().int().min(1).default(2),
  invPrefix: z.string().default(''),
  mode: z.enum(['scratch', 'copy']),
  srcLocationId: z.uuid().nullable().default(null),
  copy: CopyChecklistSchema.default({
    services: true,
    prices: true,
    timing: true,
    products: true,
    hours: true,
    policies: true,
    payments: true,
  }),
  legal: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('existing'), legalEntityId: z.uuid() }),
    z.object({
      mode: z.literal('new'),
      name: z.string().min(1),
      taxId: z.string().min(1),
      vat: z.string().default(''),
      currency: z.string().default('MKD'),
    }),
  ]),
  submit: z.boolean().default(false),
});
export type LocationCreate = z.infer<typeof LocationCreateSchema>;

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
