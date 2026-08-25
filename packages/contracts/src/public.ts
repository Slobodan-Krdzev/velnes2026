import { z } from 'zod';
import { MoneySchema } from './catalog.js';
import { LangSchema } from './auth.js';
import {
  AvailabilityResponseSchema,
  BookingRefusalSchema,
  ClockSchema,
  HoldResponseSchema,
} from './scheduling.js';

/**
 * The widget's public surface — config fetch by publishable key,
 * availability, hold, book. Nothing else exists out here.
 */

export const PublicWidgetSchema = z.object({
  businessName: z.string(),
  slug: z.string().nullable(),
  widgetId: z.uuid(),
  // Publishable by definition — the hosted page resolves by slug and
  // then talks to the data endpoints with this same key.
  publishableKey: z.string(),
  name: z.string(),
  lang: LangSchema,
  theme: z.string(),
  accent: z.string(),
  radius: z.string(),
  startStep: z.string(),
  deposit: z.string(),
  cancelPolicy: z.string(),
  locations: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      city: z.string().nullable(),
      address: z.string().nullable(),
    }),
  ),
});
export type PublicWidget = z.infer<typeof PublicWidgetSchema>;

export const PublicServiceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  category: z.string().nullable(),
  durationMin: z.number().int(),
  price: MoneySchema,
  priceFrom: MoneySchema.nullable(), // when variants differ
  variants: z.array(
    z.object({
      id: z.uuid(),
      label: z.string(),
      durationMin: z.number().int(),
      price: MoneySchema,
      std: z.boolean(),
    }),
  ),
  modifiers: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      type: z.enum(['single', 'multi']),
      required: z.boolean(),
      options: z.array(
        z.object({ id: z.uuid(), name: z.string(), price: MoneySchema, durationMin: z.number().int() }),
      ),
    }),
  ),
  // Who does it here — the visitor may pick a professional or 'any'.
  employees: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export const PublicServicesResponseSchema = z.object({
  services: z.array(PublicServiceSchema),
});

export const PublicHoldRequestSchema = z.object({
  key: z.string().min(8), // the booking's idempotency key
  locationId: z.uuid(),
  serviceId: z.uuid(),
  date: z.iso.date(),
  time: ClockSchema,
  employeeId: z.union([z.uuid(), z.literal('any')]).default('any'),
});

export const PublicBookRequestSchema = z.object({
  key: z.string().min(8),
  locationId: z.uuid(),
  serviceId: z.uuid(),
  date: z.iso.date(),
  time: ClockSchema,
  employeeId: z.union([z.uuid(), z.literal('any')]).default('any'),
  variantId: z.uuid().nullable().optional(),
  modifierOptionIds: z.array(z.uuid()).default([]),
  name: z.string().min(1),
  phone: z.string().min(3),
  email: z.email().optional(),
});

export const PublicBookResponseSchema = z.object({
  ref: z.string(), // appointment id
  date: z.iso.date(),
  time: ClockSchema,
  end: ClockSchema,
  serviceName: z.string(),
  locationName: z.string(),
  employeeName: z.string(),
  price: MoneySchema,
});

export { AvailabilityResponseSchema, BookingRefusalSchema, HoldResponseSchema };
