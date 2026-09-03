import { z } from 'zod';
import { MoneySchema } from './catalog.js';

export const ProductSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  category: z.string().nullable(),
  sku: z.string().nullable(),
  price: MoneySchema,
  cost: MoneySchema.nullable(),
  vat: z.number().int(),
  active: z.boolean(),
  own: z.boolean(),
  sellerLegalEntityId: z.uuid().nullable(),
});
export type Product = z.infer<typeof ProductSchema>;

export const StockMovementKindSchema = z.enum([
  'adjustment',
  'transfer_in',
  'transfer_out',
  'delivery',
  'sale',
  'own_use',
]);

/** The one stock door. Adjustment/own-use touch one location;
 *  a transfer names both and writes both sides atomically. */
export const StockMoveRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('adjustment'),
    productId: z.uuid(),
    locationId: z.uuid(),
    qty: z.number().int(), // signed delta
    note: z.string().optional(),
  }),
  z.object({
    kind: z.literal('own_use'),
    productId: z.uuid(),
    locationId: z.uuid(),
    qty: z.number().int().positive(), // containers taken from stock
    note: z.string().optional(),
  }),
  z.object({
    kind: z.literal('transfer'),
    productId: z.uuid(),
    fromLocationId: z.uuid(),
    toLocationId: z.uuid(),
    qty: z.number().int().positive(),
    note: z.string().optional(),
  }),
]);
export type StockMoveRequest = z.infer<typeof StockMoveRequestSchema>;

export const StockLevelSchema = z.object({
  locationId: z.uuid(),
  stock: z.number().int(),
  lowStock: z.number().int(),
});

/** The ledger read — inventory.view's door. Every stock change is a
 *  movement; this lists them, newest first. */
export const StockMovementQuerySchema = z.object({
  productId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const StockMovementRowSchema = z.object({
  id: z.uuid(),
  at: z.string(), // ISO timestamp
  kind: StockMovementKindSchema,
  qty: z.number().int(),
  productId: z.uuid(),
  productName: z.string(),
  locationId: z.uuid(),
  locationName: z.string(),
  ref: z.string().nullable(),
  note: z.string().nullable(),
  actorName: z.string().nullable(),
});
export const StockMovementListSchema = z.object({
  movements: z.array(StockMovementRowSchema),
});
export type StockMovementRow = z.infer<typeof StockMovementRowSchema>;
export const StockMoveResponseSchema = z.object({
  levels: z.array(StockLevelSchema), // affected locations, after the move
});
export type StockMoveResponse = z.infer<typeof StockMoveResponseSchema>;
