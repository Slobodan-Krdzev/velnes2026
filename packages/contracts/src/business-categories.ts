import { z } from 'zod';

/** The salon verticals Revelapps HQ curates. The registration wizard
 *  reads the enabled ones; HQ manages the whole list. */
export const BusinessCategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  enabled: z.boolean(),
  sort: z.number().int(),
});
export type BusinessCategory = z.infer<typeof BusinessCategorySchema>;

export const BusinessCategoryListSchema = z.object({
  categories: z.array(BusinessCategorySchema),
});

export const BusinessCategoryCreateSchema = z.object({
  name: z.string().min(1).max(60),
});
export const BusinessCategoryPatchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  enabled: z.boolean().optional(),
});
