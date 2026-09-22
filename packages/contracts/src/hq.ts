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

/** The prototype's ONBOARD_STEPS, derived from the real tables —
 *  never stored, so they can't drift from the truth. */
export const HqOnboardStepsSchema = z.object({
  account: z.boolean(),
  locations: z.boolean(),
  catalog: z.boolean(),
  employees: z.boolean(),
  payments: z.boolean(),
  widget: z.boolean(),
});
export type HqOnboardSteps = z.infer<typeof HqOnboardStepsSchema>;

/** Derived, not stored: invited while the owner hasn't completed the
 *  invite, live once a location is ACTIVE, onboarding in between. */
export const HqBusinessStatusSchema = z.enum(['live', 'invited', 'onboarding']);

/** Platform plan prices (MKD a month, subscriptions only) — the
 *  prototype's numbers, the platform's single source. */
export const PLAN_PRICES: Record<string, number> = { Starter: 49, Business: 139 };

export const HqBusinessRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string().nullable(),
  city: z.string().nullable(),
  plan: z.string(),
  since: z.string().nullable(),
  ownerName: z.string().nullable(),
  ownerEmail: z.string().nullable(),
  locations: z.number().int(),
  liveLocations: z.number().int(),
  employees: z.number().int(),
  status: HqBusinessStatusSchema,
  steps: HqOnboardStepsSchema,
  // HQ's per-salon AI Assistant switch (default off). Toggled from the
  // businesses list; the workspace + server both honour it.
  assistantEnabled: z.boolean().default(false),
  mrr: z.number(),
  syncErrors7d: z.number().int(),
  // Support tickets aren't built yet — honest zeros/nulls from the
  // one door until the support surface lands, never UI guesses.
  openTickets: z.number().int(),
  lastSupportAccess: z.string().nullable(),
});
/** HQ toggling a salon's AI Assistant entitlement. */
export const HqAssistantToggleSchema = z.object({ enabled: z.boolean() });
export const HqAssistantToggleResponseSchema = z.object({ id: z.uuid(), assistantEnabled: z.boolean() });

export const HqBusinessListSchema = z.object({
  businesses: z.array(HqBusinessRowSchema),
  stats: z.object({
    businesses: z.number().int(),
    live: z.number().int(),
    onboarding: z.number().int(),
    openTickets: z.number().int(),
    monthlyRevenue: z.number(),
  }),
});

/** The prototype's hqNewBiz panel: HQ creates the account and the
 *  owner is invited — HQ never holds customer passwords. */
export const HqBusinessCreateSchema = z.object({
  name: z.string().min(1).max(80),
  city: z.string().min(1).max(60),
  plan: z.enum(['Starter', 'Business']).default('Business'),
  ownerName: z.string().min(1).max(80),
  ownerEmail: z.email(),
  firstLocation: z.string().max(80).optional(),
});
export const HqBusinessCreateResponseSchema = z.object({ id: z.uuid() });

export const HqAuditListSchema = z.object({
  entries: z.array(AuditEntrySchema.extend({ tenantName: z.string() })),
});

/** The Velnes taxonomy, HQ-side: the platform's category shelves
 *  every salon picks from. */
/** Category media — data URLs, stored inline like the salon gallery until an
 *  asset host is decided. The client discovery app renders these. */
export const CATEGORY_CARD_MAX_CHARS = 600_000;
export const CATEGORY_ICON_MAX_CHARS = 200_000;
export const CategoryCardSchema = z.string().min(1).max(CATEGORY_CARD_MAX_CHARS);
export const CategoryIconSchema = z.string().min(1).max(CATEGORY_ICON_MAX_CHARS);

export const HqCategoryRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.enum(['services', 'products']),
  sort: z.number().int(),
  // Service categories only (the client app browses them): a card image
  // and an icon, both data URLs. Null on product categories, and on
  // taxonomy rows created before this was required.
  cardImage: z.string().nullable().default(null),
  icon: z.string().nullable().default(null),
});
export const HqCategoryListSchema = z.object({
  categories: z.array(HqCategoryRowSchema),
});
export const HqCategoryCreateSchema = z
  .object({
    name: z.string().min(1).max(60),
    type: z.enum(['services', 'products']),
    cardImage: CategoryCardSchema.optional(),
    icon: CategoryIconSchema.optional(),
  })
  // A service category must ship with its card image and icon — the
  // client app has nothing to show otherwise.
  .superRefine((v, ctx) => {
    if (v.type !== 'services') return;
    if (!v.cardImage) ctx.addIssue({ code: 'custom', path: ['cardImage'], message: 'A card image is required' });
    if (!v.icon) ctx.addIssue({ code: 'custom', path: ['icon'], message: 'An icon is required' });
  });
export const HqCategoryPatchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  cardImage: CategoryCardSchema.optional(),
  icon: CategoryIconSchema.optional(),
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

/** The prototype's HQ_PERM_GROUPS: what an HQ role may reach, and at
 *  which scope. The platform's single source for the role drawer. */
export const HQ_PERM_GROUPS: [string, [string, string][]][] = [
  [
    'Customers',
    [
      ['hq.customers', 'See businesses, locations and their settings'],
      ['hq.enter', 'Open a customer environment'],
    ],
  ],
  ['Suppliers', [['hq.suppliers', 'Verify and manage suppliers']]],
  ['Finance', [['hq.finance', 'Invoices, payouts and platform fees']]],
  [
    'Platform',
    [
      ['hq.settings', 'Platform settings and feature flags'],
      ['hq.team', 'Manage HQ users and roles'],
      ['hq.audit', 'Read the platform log'],
    ],
  ],
];
export const HQ_SCOPES: [string, string][] = [
  ['none', 'No access'],
  ['read', 'Read-only'],
  ['write', 'Full'],
];
export const HqScopeSchema = z.enum(['none', 'read', 'write']);

/** The HQ role kit — the prototype's six standard roles plus custom. */
export const HqRoleKitSchema = z.object({
  id: z.string(),
  name: z.string(),
  descr: z.string(),
  customerAccess: z.enum(['write', 'read', 'none']),
  std: z.boolean(),
  locked: z.boolean(),
  perms: z.record(z.string(), HqScopeSchema),
  users: z.number().int(),
  userNames: z.array(z.object({ name: z.string(), email: z.string() })),
});
export const HqRoleListSchema = z.object({ roles: z.array(HqRoleKitSchema) });
export const HqRoleCreateSchema = z.object({
  name: z.string().min(1).max(60),
  descr: z.string().max(300).default(''),
  base: z.string().min(1), // any existing role whose permissions it copies
});
/** The role drawer: rename/describe a custom role, and move
 *  permission scopes one select at a time (merged into perms). */
export const HqRolePatchSchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    descr: z.string().max(300).optional(),
    perms: z.record(z.string(), HqScopeSchema).optional(),
  })
  .refine((b) => b.name !== undefined || b.descr !== undefined || b.perms !== undefined, {
    message: 'Nothing to change',
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
  /** Whether the supplier has its first portal keyholder yet. */
  hasOwner: z.boolean().default(false),
  ownerStatus: z.enum(['none', 'invited', 'active']).default('none'),
});
export const HqSupplierListSchema = z.object({ suppliers: z.array(HqSupplierRowSchema) });
export const HqSupplierCreateSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.string().default('Distributor'),
  territory: z.string().default('North Macedonia'),
  contact: z.string().default(''),
});
/** HQ hands a freshly-created supplier its first portal owner. */
export const HqSupplierInviteSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email().max(120),
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
  /** Delivery attempts, and the provider's last words when it refused. */
  attempts: z.number().int(),
  error: z.string().nullable(),
});
export const HqOutboxListSchema = z.object({ mails: z.array(HqOutboxRowSchema) });
