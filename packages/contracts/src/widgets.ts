import { z } from 'zod';
import { LangSchema } from './auth.js';

/**
 * The owner's side of online booking: widgets, their keys and the
 * integration health feed. Everything here sits behind
 * `integrations.manage`.
 */

export const WidgetStatusSchema = z.enum(['draft', 'live']);

export const AdminWidgetSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  publishableKey: z.string(),
  locationIds: z.array(z.uuid()),
  categories: z.array(z.string()), // ['all'] follows the catalog
  lang: LangSchema,
  theme: z.string(),
  accent: z.string(),
  radius: z.string(),
  btnStyle: z.string(),
  startStep: z.string(),
  deposit: z.string(),
  cancelPolicy: z.string(),
  domains: z.array(z.string()),
  status: WidgetStatusSchema,
  bookings: z.number().int(), // appointments attributed to this widget
});
export type AdminWidget = z.infer<typeof AdminWidgetSchema>;

export const WidgetListResponseSchema = z.object({
  widgets: z.array(AdminWidgetSchema),
  slug: z.string().nullable(), // the hosted booking-link slug
});

export const WidgetCreateSchema = z.object({ name: z.string().min(1) });

export const WidgetPatchSchema = z.object({
  name: z.string().min(1).optional(),
  locationIds: z.array(z.uuid()).optional(),
  categories: z.array(z.string()).optional(),
  lang: LangSchema.optional(),
  theme: z.string().optional(),
  accent: z.string().optional(),
  radius: z.string().optional(),
  btnStyle: z.string().optional(),
  startStep: z.string().optional(),
  deposit: z.string().optional(),
  cancelPolicy: z.string().optional(),
  domains: z.array(z.string()).optional(),
  status: WidgetStatusSchema.optional(),
});
export type WidgetPatch = z.infer<typeof WidgetPatchSchema>;

export const IntegrationEventSchema = z.object({
  id: z.uuid(),
  ts: z.iso.datetime(),
  widgetId: z.uuid().nullable(),
  level: z.string(),
  code: z.string(),
  msg: z.string(),
  fix: z.string(),
});
export const IntegrationEventsResponseSchema = z.object({
  events: z.array(IntegrationEventSchema),
});
