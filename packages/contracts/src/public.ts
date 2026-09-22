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

/** A visit: one or more treatments, booked together. The consumer app
 *  lets people pick several; the widget sends one. Same shape either
 *  way, so there is one answer to "what is being booked". */
export const ChainItemSchema = z.object({
  serviceId: z.uuid(),
  variantId: z.uuid().nullable().optional(),
  modifierOptionIds: z.array(z.uuid()).default([]),
});
export const PublicChainSlotsRequestSchema = z.object({
  key: z.string().min(4),
  locationId: z.uuid(),
  date: z.iso.date(),
  employeeId: z.union([z.uuid(), z.literal('any')]).default('any'),
  items: z.array(ChainItemSchema).min(1).max(8),
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
  /** More than one treatment in the same visit. When present this is
   *  what gets booked, and serviceId names the first of them. */
  items: z.array(ChainItemSchema).min(1).max(8).optional(),
  name: z.string().min(1),
  phone: z.string().min(3),
  email: z.email().optional(),
});

export const PublicBookResponseSchema = z.object({
  ref: z.string(), // appointment id (the visit's first treatment)
  date: z.iso.date(),
  time: ClockSchema,
  end: ClockSchema,
  serviceName: z.string(),
  /** Every treatment in the visit, in order. One entry for a single
   *  booking — the app never has to special-case the common case. */
  items: z
    .array(
      z.object({
        ref: z.string(),
        serviceName: z.string(),
        time: ClockSchema,
        end: ClockSchema,
        price: z.number().int(),
        employeeName: z.string(),
      }),
    )
    .default([]),
  locationName: z.string(),
  employeeName: z.string(),
  price: MoneySchema,
});

export { AvailabilityResponseSchema, BookingRefusalSchema, HoldResponseSchema };

/**
 * The consumer app's key for the public booking doors: `salon:<slug>`.
 * The platform's own surface books without any widget — a salon is on
 * the Velnes app once HQ approved it with live services; the website
 * widget is a separate product it may or may not have (Alex,
 * 2026-09-22). The doors resolve it to the salon's ACTIVE locations.
 */
export const CONSUMER_KEY_PREFIX = 'salon:';
export const consumerKey = (slug: string): string => `${CONSUMER_KEY_PREFIX}${slug}`;
