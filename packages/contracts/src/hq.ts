import { z } from 'zod';
import { LocationLifecycleSchema } from './locations.js';
import { AuditEntrySchema } from './audit.js';

/** Revelapps HQ — the internal operations surface. Separate
 *  principals (hq_users), separate tokens, explicit app.hq reads. */

export const HqRoleSchema = z.enum([
  'hq_super',
  'hq_onboard',
  'hq_support',
  'hq_tech',
  'hq_audit',
]);
export type HqRole = z.infer<typeof HqRoleSchema>;

export const HqLoginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});
export const HqLoginResponseSchema = z.object({
  accessToken: z.string(),
  user: z.object({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
    role: HqRoleSchema,
  }),
});
export const HqMeResponseSchema = HqLoginResponseSchema.shape.user;

/** What an HQ access token carries. Deliberately shaped so a tenant
 *  door's AccessClaims parse refuses it, and vice versa. */
export const HqClaimsSchema = z.object({
  hq: z.literal(true),
  sub: z.uuid(),
  name: z.string(),
  rol: HqRoleSchema,
});
export type HqClaims = z.infer<typeof HqClaimsSchema>;

/** The New-locations queue: every location submitted for
 *  verification, across all tenants. */
export const HqLocationRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  businessId: z.uuid(),
  businessName: z.string(),
  city: z.string().nullable(),
  lifecycle: LocationLifecycleSchema,
  legalName: z.string().nullable(),
  legalStatus: z.string().nullable(), // 'pending' marks a compound review
});
export const HqLocationQueueSchema = z.object({
  locations: z.array(HqLocationRowSchema),
});

export const HqLocationReviewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  businessName: z.string(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  phone: z.string().nullable(),
  tz: z.string(),
  invPrefix: z.string(),
  lifecycle: LocationLifecycleSchema,
  legal: z
    .object({
      id: z.uuid(),
      name: z.string(),
      taxId: z.string(),
      status: z.string(),
    })
    .nullable(),
  paymentAccount: z.object({ provider: z.string(), status: z.string() }).nullable(),
  compound: z.boolean(), // approving also verifies a new legal entity
  log: z.array(
    z.object({ from: z.string(), to: z.string(), reason: z.string().nullable() }),
  ),
});

export const HqLocationDecisionSchema = z.object({
  action: z.enum(['approve', 'request_changes', 'start_review']),
  reason: z.string().optional(), // mandatory for request_changes
});

export const HqBusinessRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string().nullable(),
  ownerName: z.string().nullable(),
  ownerEmail: z.string().nullable(),
  locations: z.number().int(),
  liveLocations: z.number().int(),
  employees: z.number().int(),
});
export const HqBusinessListSchema = z.object({ businesses: z.array(HqBusinessRowSchema) });

export const HqAuditListSchema = z.object({
  entries: z.array(AuditEntrySchema.extend({ tenantName: z.string() })),
});

/** The Velnes taxonomy, HQ-side: the platform's category shelves
 *  every salon picks from. */
export const HqCategoryRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.enum(['services', 'products']),
  sort: z.number().int(),
});
export const HqCategoryListSchema = z.object({
  categories: z.array(HqCategoryRowSchema),
});
export const HqCategoryCreateSchema = z.object({
  name: z.string().min(1).max(60),
  type: z.enum(['services', 'products']),
});
export const HqCategoryPatchSchema = z.object({
  name: z.string().min(1).max(60),
});

/** The category-request intake, HQ-side. */
export const HqCategoryRequestSchema = z.object({
  id: z.uuid(),
  tenantName: z.string(),
  name: z.string(),
  type: z.enum(['services', 'products']),
  note: z.string(),
  status: z.enum(['pending', 'approved', 'declined']),
  hqReason: z.string(),
  createdAt: z.string(),
});
export const HqCategoryRequestListSchema = z.object({
  requests: z.array(HqCategoryRequestSchema),
});
export const HqCategoryDeclineSchema = z.object({
  reason: z.string().min(1).max(300),
});
