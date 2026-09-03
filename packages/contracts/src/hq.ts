import { z } from 'zod';
import { LocationLifecycleSchema } from './locations.js';
import { AuditEntrySchema } from './audit.js';

/** Revelapps HQ — the internal operations surface. Separate
 *  principals (hq_users), separate tokens, explicit app.hq reads. */

export const HqRoleSchema = z.enum([
  'hq_super',
  'hq_onboard',
  'hq_support',
  'hq_finance',
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
  rol: z.string(),
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

/** HQ team management — the platform's own people. */
export const HqTeamMemberSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  roleName: z.string().default(''),
  status: z.enum(['active', 'invited', 'disabled']),
  createdAt: z.string(),
});
export const HqTeamListSchema = z.object({ members: z.array(HqTeamMemberSchema) });
export const HqTeamInviteSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  role: z.string().min(1),
});
export const HqTeamRolePatchSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.email().optional(),
  role: z.string().min(1).optional(),
});

/** The HQ role kit — the prototype's six standard roles plus custom. */
export const HqRoleKitSchema = z.object({
  id: z.string(),
  name: z.string(),
  descr: z.string(),
  customerAccess: z.enum(['write', 'read', 'none']),
  std: z.boolean(),
  locked: z.boolean(),
  users: z.number().int(),
  userNames: z.array(z.object({ name: z.string(), email: z.string() })),
});
export const HqRoleListSchema = z.object({ roles: z.array(HqRoleKitSchema) });
export const HqRoleCreateSchema = z.object({
  name: z.string().min(1).max(60),
  descr: z.string().max(300).default(''),
  base: z.string().min(1), // standard role whose customer reach it copies
});

/** Brand, supplier and distributor — three different things. */
export const HqBrandSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  owner: z.string(),
  country: z.string(),
});
export const HqBrandListSchema = z.object({
  brands: z.array(HqBrandSchema),
  carriage: z.array(
    z.object({
      supplierId: z.uuid(),
      supplierName: z.string(),
      territory: z.string(),
      brands: z.array(z.string()),
    }),
  ),
});
export const HqBrandCreateSchema = z.object({
  name: z.string().min(1).max(80),
  owner: z.string().max(120).default(''),
  country: z.string().max(80).default(''),
  supplierId: z.uuid().nullable().optional(),
});

/** Supplier Intelligence — the operator's view over the chain. */
export const HqSupplierRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.string(),
  territory: z.string(),
  contact: z.string().default(''),
  verified: z.boolean(),
  brands: z.array(z.string()).default([]),
  merchant: z
    .object({
      entityName: z.string(),
      merchantId: z.string().nullable(),
      ready: z.boolean(),
    })
    .nullable()
    .default(null),
  products: z.number().int(),
  connectedSalons: z.number().int(),
  pendingSalons: z.number().int(),
  orders: z.number().int(),
  orderValue: z.number().int(),
});
export const HqSupplierListSchema = z.object({ suppliers: z.array(HqSupplierRowSchema) });
export const HqSupplierCreateSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.string().default('Distributor'),
  territory: z.string().default('North Macedonia'),
  contact: z.string().default(''),
});
export const HqSupplierPatchSchema = z.object({
  verified: z.boolean().optional(),
  territory: z.string().optional(),
  contact: z.string().optional(),
});

/** The mail outbox, HQ-visible: what the platform said to whom. */
export const HqOutboxRowSchema = z.object({
  id: z.uuid(),
  to: z.string(),
  subject: z.string(),
  kind: z.string(),
  status: z.string(),
  createdAt: z.string(),
});
export const HqOutboxListSchema = z.object({ mails: z.array(HqOutboxRowSchema) });
