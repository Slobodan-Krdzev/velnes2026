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
  locationId: z.uuid(),
  status: PurchaseOrderStatusSchema,
  byName: z.string(),
  expected: z.iso.date().nullable(),
  track: z.string(),
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
  salons: z.number().int(),
  openOrders: z.number().int(),
  products: z.number().int(),
  pendingConnections: z.number().int(),
});
