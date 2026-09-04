import { z } from 'zod';
import { MoneySchema } from './catalog.js';

/**
 * The supplier chain (Phase 10): supplier catalog → own catalog →
 * stock per location → consumption or sale → forecast → order →
 * delivery. Every step writes into the same records.
 */

export const SupplierSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.string(),
  territory: z.string(),
  verified: z.boolean(),
  minOrder: MoneySchema,
  lead: z.string(),
  terms: z.string(),
  contact: z.string(),
  manager: z.string(),
  rating: z.number().nullable(),
  products: z.number().int(),
  // The salon's side of the relationship:
  status: z.enum(['available', 'pending', 'connected']),
  customerNo: z.string(),
  connected: z.iso.date().nullable(),
  share: z.record(z.string(), z.boolean()),
  locationIds: z.array(z.uuid()),
});
export type Supplier = z.infer<typeof SupplierSchema>;
export const SupplierListSchema = z.object({ suppliers: z.array(SupplierSchema) });

export const SupplierProductSchema = z.object({
  id: z.uuid(),
  supplierId: z.uuid(),
  brand: z.string(),
  name: z.string(),
  sku: z.string(),
  ean: z.string(),
  size: z.string(),
  pack: z.number().int(),
  buy: MoneySchema,
  rrp: MoneySchema,
  vat: z.number().int(),
  moq: z.number().int(),
  stock: z.number().int(),
  lead: z.string(),
  use: z.string(), // pro | retail | both
  category: z.string(),
  descr: z.string(),
  sample: z.boolean(),
  active: z.boolean().optional(), // portal view only
  linkedProductId: z.uuid().nullable(), // the salon's own product
});
export type SupplierProduct = z.infer<typeof SupplierProductSchema>;
export const SupplierProductListSchema = z.object({
  products: z.array(SupplierProductSchema),
});

export const ORDER_FLOW = ['submitted', 'accepted', 'processing', 'shipped', 'delivered'] as const;
export const PurchaseOrderStatusSchema = z.enum([
  'draft', 'approval', 'submitted', 'accepted', 'partial', 'processing',
  'shipped', 'partdelivered', 'delivered', 'cancelled', 'disputed',
]);
export type PurchaseOrderStatus = z.infer<typeof PurchaseOrderStatusSchema>;

export const PurchaseOrderLineSchema = z.object({
  id: z.uuid(),
  supplierProductId: z.uuid(),
  name: z.string(),
  sku: z.string(),
  qty: z.number().int(),
  price: MoneySchema,
  free: z.number().int(),
  recv: z.number().int(),
  dmg: z.number().int(),
});
export const PurchaseOrderSchema = z.object({
  id: z.uuid(),
  ref: z.string(),
  supplierId: z.uuid(),
  supplierName: z.string(),
  salonName: z.string().nullable().default(null),
  locationId: z.uuid(),
  locationName: z.string().nullable().default(null),
  status: PurchaseOrderStatusSchema,
  byName: z.string(),
  expected: z.iso.date().nullable(),
  track: z.string(),
  supplierNote: z.string().default(''), // why the supplier declined, if it did
  createdAt: z.iso.datetime(),
  lines: z.array(PurchaseOrderLineSchema),
  total: MoneySchema,
});
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;
export const PurchaseOrderListSchema = z.object({ orders: z.array(PurchaseOrderSchema) });

export const OrderCreateSchema = z.object({
  supplierId: z.uuid(),
  locationId: z.uuid(),
  lines: z.array(z.object({ supplierProductId: z.uuid(), qty: z.number().int().min(1) })).min(1),
  submit: z.boolean().default(false),
});

export const ReceiveRequestSchema = z.object({
  lines: z.array(
    z.object({
      lineId: z.uuid(),
      received: z.number().int().min(0),
      damaged: z.number().int().min(0).default(0),
    }),
  ),
});

export const SupplierPromotionSchema = z.object({
  id: z.uuid(),
  supplierId: z.uuid(),
  supplierName: z.string(),
  brand: z.string(),
  title: z.string(),
  kind: z.string(), // pct | bxgy | gift
  productIds: z.array(z.uuid()),
  starts: z.iso.date(),
  ends: z.iso.date(),
  minOrder: MoneySchema,
  usageLimit: z.number().int(),
  terms: z.string(),
  audience: z.string(),
  value: z.number().int(),
  per: z.number().int(),
});
export const SupplierPromotionListSchema = z.object({
  promotions: z.array(SupplierPromotionSchema),
});

// ── The portal's own principals. ─────────────────────────────────

export const SupplierLoginResponseSchema = z.object({
  accessToken: z.string(),
  user: z.object({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
    role: z.string(),
    supplierId: z.uuid(),
    supplierName: z.string(),
  }),
});

/** Shaped to reject tenant and HQ tokens by construction. */
export const SupplierClaimsSchema = z.object({
  sup: z.uuid(), // supplier id
  sub: z.uuid(),
  name: z.string(),
  rol: z.string(),
});
export type SupplierClaims = z.infer<typeof SupplierClaimsSchema>;

export const PortalSalonSchema = z.object({
  businessId: z.uuid(),
  name: z.string(),
  customerNo: z.string(),
  status: z.string(),
  connected: z.iso.date().nullable(),
  orders: z.number().int(),
  value: MoneySchema,
  openOrders: z.number().int(),
  note: z.string(),
});
export const PortalSalonListSchema = z.object({ salons: z.array(PortalSalonSchema) });

export const PortalDashboardSchema = z.object({
  supplierName: z.string(),
  supplierType: z.string(),
  brands: z.array(z.string()),
  salons: z.number().int(),
  openOrders: z.number().int(),
  orderValue30: MoneySchema,
  repeatRate: z.number().nullable(), // percent; null when no accounts ordered
  trainingSeats: z.object({ taken: z.number().int(), seats: z.number().int() }).nullable(), // null = academy engine pending
  products: z.number().int(),
  pendingConnections: z.number().int(),
  payments: z.object({
    legalEntity: z.string().nullable(),
    merchantId: z.string().nullable(),
    provider: z.string().nullable(),
    settlement: z.string().nullable(),
    status: z.enum(['active', 'pending', 'incomplete', 'none']),
  }),
  bestSelling: z.array(z.object({ name: z.string(), value: MoneySchema })),
  recentOrders: z.array(
    z.object({
      id: z.uuid(),
      ref: z.string(),
      salonName: z.string().nullable(),
      createdAt: z.iso.datetime(),
      total: MoneySchema,
      status: PurchaseOrderStatusSchema,
    }),
  ),
  requests: z.array(
    z.object({
      businessId: z.uuid(),
      name: z.string(),
      city: z.string().nullable(),
      locations: z.number().int(),
      note: z.string(),
      shares: z.string(),
    }),
  ),
  attention: z.array(
    z.object({
      icon: z.enum(['products', 'invoice', 'tag']),
      title: z.string(),
      detail: z.string(),
      tab: z.enum(['catalog', 'orders', 'promotions']),
    }),
  ),
});

/** The portal's own Add-product panel: publishes to every connected
 *  salon (they compare and adopt). */
export const PortalProductCreateSchema = z.object({
  name: z.string().min(1).max(120),
  brand: z.string().min(1),
  category: z.string().max(80).default(''),
  sku: z.string().min(1).max(60),
  ean: z.string().max(40).default(''),
  size: z.string().max(40).default(''),
  pack: z.number().int().min(1).default(6),
  buy: MoneySchema,
  rrp: MoneySchema.default(0),
  moq: z.number().int().min(1).default(1),
  stock: z.number().int().min(0).default(0),
  use: z.enum(['retail', 'pro', 'both']).default('both'),
  descr: z.string().max(500).default(''),
});

/** The portal's Add-promotion panel: an offer, not a change. */
export const PortalPromotionCreateSchema = z.object({
  title: z.string().min(1).max(120),
  kind: z.enum(['pct', 'amt', 'tier', 'bxgy', 'gift', 'bundle', 'training']).default('pct'),
  productIds: z.array(z.uuid()).min(1),
  starts: z.iso.date(),
  ends: z.iso.date(),
  minOrder: z.number().int().min(0).default(0),
  usageLimit: z.number().int().min(0).default(0),
  terms: z.string().max(500).default(''),
  audience: z.string().max(120).default('Connected salons only'),
});

// ── Portal Settings: the supplier's own team + role kit. ─────────

/** The prototype's PO_PERM_GROUPS — what a portal role may reach. */
export const PO_PERM_GROUPS: [string, [string, string][]][] = [
  [
    'Commercial',
    [
      ['po.catalog', 'Products, prices and availability'],
      ['po.promotions', 'Create and run promotions'],
      ['po.terms', 'Commercial terms and payment conditions'],
    ],
  ],
  [
    'Salons',
    [
      ['po.salons', 'See connected salons and their contacts'],
      ['po.orders', 'Handle orders, shipping and delivery'],
      ['po.disputes', 'Handle disputes and credit notes'],
    ],
  ],
  ['Knowledge', [['po.academy', 'Training events and registrations']]],
  ['Insight', [['po.reports', 'Reporting and export']]],
  ['Administration', [['po.users', 'Manage users and roles']]],
];
export const PO_SCOPES: [string, string][] = [
  ['none', 'No access'],
  ['own', 'Own salons'],
  ['all', 'All salons'],
];
/** These permissions have no per-salon middle ground: none or all. */
export const PO_FLAT = ['po.catalog', 'po.promotions', 'po.terms', 'po.academy', 'po.users'];
export const PoScopeSchema = z.enum(['none', 'own', 'all']);

export const PortalCompanySchema = z.object({
  name: z.string(),
  territory: z.string(),
  minOrder: z.number().int(),
  lead: z.string(),
  terms: z.string(),
  contact: z.string(),
});

export const PortalTeamMemberSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  roleName: z.string(),
  status: z.enum(['active', 'invited', 'disabled']),
});
export const PortalTeamListSchema = z.object({ members: z.array(PortalTeamMemberSchema) });
export const PortalTeamInviteSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  role: z.string().min(1),
});
export const PortalTeamPatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    email: z.email().optional(),
    role: z.string().min(1).optional(),
  })
  .refine((b) => b.name !== undefined || b.email !== undefined || b.role !== undefined, {
    message: 'Nothing to change',
  });

export const PortalRoleKitSchema = z.object({
  id: z.string(),
  name: z.string(),
  scope: z.string(),
  std: z.boolean(),
  locked: z.boolean(),
  perms: z.record(z.string(), PoScopeSchema),
  users: z.number().int(),
  userNames: z.array(z.object({ name: z.string(), email: z.string() })),
});
export const PortalRoleListSchema = z.object({ roles: z.array(PortalRoleKitSchema) });
export const PortalRoleCreateSchema = z.object({
  name: z.string().min(1).max(60),
  scope: z.string().max(300).default(''),
  base: z.string().min(1),
});
export const PortalRolePatchSchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    scope: z.string().max(300).optional(),
    perms: z.record(z.string(), PoScopeSchema).optional(),
  })
  .refine((b) => b.name !== undefined || b.scope !== undefined || b.perms !== undefined, {
    message: 'Nothing to change',
  });

// ── Portal Reports: real where derivable. ────────────────────────
export const PortalReportsSchema = z.object({
  orderValue: MoneySchema,
  orders: z.number().int(),
  averageOrder: MoneySchema,
  repeatRate: z.number().nullable(), // percent, null when no accounts ordered
  promotionUptake: z.number().nullable(), // salons; null = not tracked yet
  bySalon: z.array(
    z.object({ name: z.string(), orders: z.number().int(), value: MoneySchema }),
  ),
  promotions: z.array(z.object({ title: z.string() })), // taken/orders not tracked yet
});

/** The portal's product edit — every official field, plus the
 *  availability flag. Editing writes to the supplier's own product;
 *  the salon-side "compare and adopt" proposal flow is separate. */
export const PortalProductPatchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    brand: z.string().min(1).optional(),
    category: z.string().max(80).optional(),
    sku: z.string().min(1).max(60).optional(),
    ean: z.string().max(40).optional(),
    size: z.string().max(40).optional(),
    pack: z.number().int().min(1).optional(),
    buy: MoneySchema.optional(),
    rrp: MoneySchema.optional(),
    moq: z.number().int().min(1).optional(),
    stock: z.number().int().min(0).optional(),
    use: z.enum(['retail', 'pro', 'both']).optional(),
    descr: z.string().max(500).optional(),
    active: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to change' });

/** Bulk price adjustment across the supplier's whole catalog. */
export const PortalBulkPriceSchema = z.object({
  target: z.enum(['buy', 'rrp', 'both']),
  percent: z.number().min(-90).max(500),
});

/** The supplier portal's notification feed (newest first). */
export const PortalNotificationSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  refId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export const PortalNotificationListSchema = z.object({
  notifications: z.array(PortalNotificationSchema),
});
