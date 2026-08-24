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

export const ResolvedProductSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  category: z.string().nullable(),
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
