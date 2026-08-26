import { z } from 'zod';
import { WeekHoursSchema } from './locations.js';

/**
 * The business card and the settings document (workspace Settings
 * parity). Configuration that is pure choice lives in one jsonb
 * document with a schema per section — one door, PATCH by section.
 */

export const GalleryPhotoSchema = z.object({
  id: z.string(),
  name: z.string(),
  img: z.string().nullable(), // data URL — the file is the storage
  tone: z.string().nullable().optional(),
});

export const BusinessProfileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  country: z.string(),
  vat: z.string().nullable(),
  slug: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  phone: z.string().nullable(),
  description: z.string(),
  gallery: z.array(GalleryPhotoSchema),
  // The one switch behind prep/reset + per-employee pace (real column,
  // read by every quote).
  timingEnabled: z.boolean(),
  // Legal & payments — HQ-managed, read-only here.
  legal: z
    .object({
      name: z.string(),
      taxId: z.string().nullable(),
      status: z.string(),
      merchantId: z.string().nullable(),
      provider: z.string().nullable(),
      accountStatus: z.string().nullable(),
    })
    .nullable(),
});
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

export const BusinessPatchSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  description: z.string().optional(),
  gallery: z.array(GalleryPhotoSchema).max(12).optional(),
  timingEnabled: z.boolean().optional(),
});

/** The prototype's RANK_CRITERIA keys — the AI model weighs what the
 *  owner ticks; at least one stays on. */
export const RANK_KEYS = [
  'rank_reviews',
  'rank_upsellcount',
  'rank_turnover',
  'rank_upsellturnover',
  'rank_upsellpct',
  'rank_appointments',
] as const;

export const BusinessSettingsSchema = z.object({
  ranking: z
    .object({ criteria: z.array(z.enum(RANK_KEYS)).min(1) })
    .default({ criteria: ['rank_reviews', 'rank_upsellcount'] }),
  customers: z
    .object({
      groups: z
        .array(z.object({ name: z.string().min(1), discountPct: z.number().min(0).max(100) }))
        .min(1),
      forms: z.object({ consult: z.boolean(), intake: z.boolean() }),
    })
    .default({
      groups: [
        { name: 'New', discountPct: 0 },
        { name: 'Regulars', discountPct: 5 },
        { name: 'VIP', discountPct: 10 },
      ],
      forms: { consult: true, intake: false },
    }),
  sales: z
    .object({
      defaultVat: z.number().int().min(0).max(100),
      autoReceipt: z.boolean(),
      allowDiscounts: z.boolean(),
      roundCash: z.boolean(),
    })
    .default({ defaultVat: 18, autoReceipt: true, allowDiscounts: true, roundCash: false }),
  // Stored now, honored when search/discovery starts (§5 pending).
  marketplace: z
    .object({
      listed: z.boolean(),
      pitch: z.string().max(70),
      description: z.string(),
      categories: z.array(z.string()),
      showPrices: z.boolean(),
      showTeam: z.boolean(),
      showReviews: z.boolean(),
      autoConfirm: z.boolean(),
      depositNew: z.boolean(),
      depositPct: z.number().min(0).max(100),
      minLead: z.string(),
      cancelUntil: z.string(),
    })
    .default({
      listed: true,
      pitch: '',
      description: '',
      categories: [],
      showPrices: true,
      showTeam: true,
      showReviews: true,
      autoConfirm: true,
      depositNew: false,
      depositPct: 10,
      minLead: '2 hours',
      cancelUntil: '24 hours before',
    }),
});
export type BusinessSettings = z.infer<typeof BusinessSettingsSchema>;
export const BusinessSettingsPatchSchema = BusinessSettingsSchema.partial();

/** The weekly template + booking-policy fields the Opening-hours
 *  section edits. Hours use the same shape scheduleFor reads:
 *  weekday index "0"(Mon)…"6"(Sun) → [["09:00","19:00"],…] | null. */
export const LocationPatchSchema = z.object({
  hours: WeekHoursSchema.optional(),
  cancelHours: z.number().int().min(0).max(168).optional(),
  invPrefix: z.string().min(1).max(20).optional(),
});
