import { z } from 'zod';

/** Money is whole MKD denars (integers), exactly as the prototype. */
export const MoneySchema = z.number().int();

export const ServiceStatusSchema = z.enum(['active', 'draft']);

export const ServiceVariantSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  durationMin: z.number().int().positive(),
  price: MoneySchema,
  std: z.boolean(),
});
export type ServiceVariant = z.infer<typeof ServiceVariantSchema>;

export const ModifierOptionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  price: MoneySchema, // may be negative (e.g. small-group discount)
  durationMin: z.number().int(),
});
export const ModifierGroupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.enum(['single', 'multi']),
  required: z.boolean(),
  options: z.array(ModifierOptionSchema),
});
export type ModifierGroup = z.infer<typeof ModifierGroupSchema>;

export const ServiceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  category: z.string().nullable(),
  durationMin: z.number().int().positive(),
  price: MoneySchema,
  vat: z.number().int(),
  status: ServiceStatusSchema,
  pos: z.boolean(),
  online: z.boolean(),
  prepMin: z.number().int().nullable(),
  resetMin: z.number().int().nullable(),
  variants: z.array(ServiceVariantSchema),
  modifiers: z.array(ModifierGroupSchema),
});
export type Service = z.infer<typeof ServiceSchema>;

/** svcAt — the per-location resolution of one service. */
export const ResolvedServiceConfigSchema = z.object({
  active: z.boolean(),
  price: MoneySchema,
  durationMin: z.number().int(),
  online: z.boolean(),
  pos: z.boolean(),
});
export type ResolvedServiceConfig = z.infer<typeof ResolvedServiceConfigSchema>;

/** svcChoice — what you get when nothing (or a variant) is chosen. */
export const ServiceChoiceSchema = z.object({
  vid: z.uuid().nullable(),
  label: z.string().nullable(),
  price: MoneySchema,
  durationMin: z.number().int(),
});
export type ServiceChoice = z.infer<typeof ServiceChoiceSchema>;

export const ResolvedServiceSchema = ServiceSchema.omit({
  variants: true,
  modifiers: true,
}).extend({
  config: ResolvedServiceConfigSchema,
  variants: z.array(ServiceVariantSchema.extend({ active: z.boolean() })),
  modifiers: z.array(ModifierGroupSchema),
});

/** The product photo's hard numbers — small on purpose: it sits on
 *  44px catalog rows and the till tiles. */
export const PRODUCT_IMG_MAX_CHARS = 200_000; // data-URL chars ≈ 150 KB
export const PRODUCT_IMG_MAX_EDGE_PX = 512;

export const ResolvedProductSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  category: z.string().nullable(),
  img: z.string().nullable().default(null),
  sku: z.string().nullable(),
  vat: z.number().int(),
  own: z.boolean(),
  config: z.object({
    active: z.boolean(),
    price: MoneySchema,
    pos: z.boolean(),
    stock: z.number().int(),
    lowStock: z.number().int(),
  }),
});

export const LocationCatalogResponseSchema = z.object({
  services: z.array(ResolvedServiceSchema),
  products: z.array(ResolvedProductSchema),
});
export type LocationCatalogResponse = z.infer<typeof LocationCatalogResponseSchema>;

/** Per-location override writes (PATCH bodies). */
export const ServiceOverridePatchSchema = z.object({
  active: z.boolean().optional(),
  price: MoneySchema.optional(),
  durationMin: z.number().int().positive().optional(),
  online: z.boolean().optional(),
  pos: z.boolean().optional(),
  prepMin: z.number().int().nullable().optional(),
  resetMin: z.number().int().nullable().optional(),
});
export const VariantOverridePatchSchema = z.object({
  active: z.boolean().optional(),
  price: MoneySchema.nullable().optional(),
  durationMin: z.number().int().positive().nullable().optional(),
});

/** Catalog writes (create/update). Nested arrays reconcile by id:
 *  update kept, insert new, delete missing. */
export const ServiceWriteSchema = z.object({
  name: z.string().min(1),
  category: z.string().nullable().optional(),
  durationMin: z.number().int().positive(),
  price: MoneySchema.nonnegative(),
  vat: z.number().int().optional(),
  status: ServiceStatusSchema.optional(),
  pos: z.boolean().optional(),
  online: z.boolean().optional(),
  prepMin: z.number().int().min(0).nullable().optional(),
  resetMin: z.number().int().min(0).nullable().optional(),
  // Who performs this service. null = every worker; an array names
  // exactly the performers; omitted = leave assignments untouched.
  performerIds: z.array(z.uuid()).nullable().optional(),
  variants: z
    .array(
      z.object({
        id: z.uuid().optional(),
        label: z.string().min(1),
        durationMin: z.number().int().positive(),
        price: MoneySchema.nonnegative(),
        std: z.boolean().optional(),
      }),
    )
    .optional(),
  modifiers: z
    .array(
      z.object({
        id: z.uuid().optional(),
        name: z.string().min(1),
        type: z.enum(['single', 'multi']),
        required: z.boolean().optional(),
        options: z.array(
          z.object({
            id: z.uuid().optional(),
            name: z.string().min(1),
            price: MoneySchema,
            durationMin: z.number().int().optional(),
          }),
        ),
      }),
    )
    .optional(),
});
export type ServiceWrite = z.infer<typeof ServiceWriteSchema>;

export const ProductWriteSchema = z.object({
  name: z.string().min(1),
  category: z.string().nullable().optional(),
  img: z.string().max(PRODUCT_IMG_MAX_CHARS, 'IMG_TOO_LARGE').nullable().optional(),
  sku: z.string().nullable().optional(),
  price: MoneySchema.nonnegative().optional(),
  cost: MoneySchema.nonnegative().nullable().optional(),
  vat: z.number().int().optional(),
  active: z.boolean().optional(),
  own: z.boolean().optional(),
  sellerLegalEntityId: z.uuid().nullable().optional(),
});
export type ProductWrite = z.infer<typeof ProductWriteSchema>;

export const IdResponseSchema = z.object({ id: z.uuid() });

/** svcLine — one quoted line for calendar/till/booking. */
export const LineQuoteRequestSchema = z.object({
  serviceId: z.uuid(),
  locationId: z.uuid(),
  variantId: z.uuid().nullable().optional(),
  modifierOptionIds: z.array(z.uuid()).default([]),
  employeeId: z.uuid().nullable().optional(),
});
export const LineQuoteResponseSchema = z.object({
  vid: z.uuid().nullable(),
  label: z.string().nullable(),
  price: MoneySchema,
  treatmentMin: z.number().int(),
  prepMin: z.number().int(),
  resetMin: z.number().int(),
  operationalMin: z.number().int(),
  basis: z.enum(['catalog', 'employee-approved', 'employee-pace']),
  modNames: z.array(z.string()),
  missingRequired: z.array(z.string()),
});
export type LineQuoteResponse = z.infer<typeof LineQuoteResponseSchema>;

/** Categories as their own door — the prototype's "New category"
 *  panel. One level: Catalog → item type → category → item. */
export const CategoryTypeSchema = z.enum(['services', 'products']);
export const CategoryRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: CategoryTypeSchema,
  items: z.number().int(),
});
export const CategoryListResponseSchema = z.object({
  categories: z.array(CategoryRowSchema),
});
export type CategoryRow = z.infer<typeof CategoryRowSchema>;

/** Category requests — a salon asks HQ for a new shelf. */
export const CategoryRequestCreateSchema = z.object({
  name: z.string().min(1).max(60),
  type: CategoryTypeSchema,
  note: z.string().max(300).default(''),
});
export const CategoryRequestSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: CategoryTypeSchema,
  note: z.string(),
  status: z.enum(['pending', 'approved', 'declined']),
  hqReason: z.string(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});
export const CategoryRequestListSchema = z.object({
  requests: z.array(CategoryRequestSchema),
});

/** Platform notices — HQ speaks, every salon reads. */
export const PlatformNoticeSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export const PlatformNoticeListSchema = z.object({
  notices: z.array(PlatformNoticeSchema),
});
