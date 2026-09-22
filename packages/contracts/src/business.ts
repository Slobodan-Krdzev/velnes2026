import { z } from 'zod';
import { WeekHoursSchema } from './locations.js';

/**
 * The business card and the settings document (workspace Settings
 * parity). Configuration that is pure choice lives in one jsonb
 * document with a schema per section — one door, PATCH by section.
 */

/** The gallery's hard numbers — one truth for the door, the client
 *  resize and the note under the upload tile. */
export const GALLERY_MAX_PHOTOS = 12;
// Data-URL characters (base64 inflates ~4/3): ≈0.45 MB of image.
export const GALLERY_IMG_MAX_CHARS = 600_000;
export const GALLERY_MAX_EDGE_PX = 1600;

export const GalleryPhotoSchema = z.object({
  id: z.string(),
  name: z.string(),
  img: z.string().nullable(), // data URL — the file is the storage
  tone: z.string().nullable().optional(),
  /** The photograph the consumer app shows on the salon's card. At most
   *  one is meant to carry it; absent, the first photograph does. */
  card: z.boolean().optional(),
});

/** What the PATCH accepts: the read side stays permissive so an
 *  older, larger photo still renders; the write side refuses. */
export const GalleryPhotoWriteSchema = GalleryPhotoSchema.extend({
  img: z.string().max(GALLERY_IMG_MAX_CHARS, 'IMG_TOO_LARGE').nullable(),
});

/** The four links a salon shows on its page — as typed (a handle or a
 *  URL); empty means none. The public door turns them into links. */
export const SocialLinksSchema = z.object({
  website: z.string().max(200).default(''),
  instagram: z.string().max(200).default(''),
  facebook: z.string().max(200).default(''),
  tiktok: z.string().max(200).default(''),
});
export type SocialLinks = z.infer<typeof SocialLinksSchema>;
/** A partial write: only the keys sent change; no defaults sneak in. */
export const SocialLinksPatchSchema = z.object({
  website: z.string().max(200).optional(),
  instagram: z.string().max(200).optional(),
  facebook: z.string().max(200).optional(),
  tiktok: z.string().max(200).optional(),
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
  socials: SocialLinksSchema,
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
  gallery: z.array(GalleryPhotoWriteSchema).max(GALLERY_MAX_PHOTOS).optional(),
  socials: SocialLinksPatchSchema.optional(),
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

/**
 * The HQ categories a salon is placed under in the consumer app —
 * read from its active, online services, the same predicate discovery
 * uses, so Settings can never say something the shelf does not.
 * Read-only by design: to appear under another category, add a
 * service there.
 */
export const BusinessCategoriesSchema = z.object({
  categories: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export type BusinessCategories = z.infer<typeof BusinessCategoriesSchema>;

/** The weekly template + booking-policy fields the Opening-hours
 *  section edits, plus the location card the settings panel edits.
 *  Hours use the same shape scheduleFor reads: weekday index
 *  "0"(Mon)…"6"(Sun) → [["09:00","19:00"],…] | null. */
export const LocationPatchSchema = z.object({
  hours: WeekHoursSchema.optional(),
  cancelHours: z.number().int().min(0).max(168).optional(),
  invPrefix: z.string().min(1).max(20).optional(),
  name: z.string().min(1).optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  tz: z.string().min(1).optional(),
  rooms: z.number().int().min(1).max(50).optional(),
  online: z.boolean().optional(),
  // The map pin. Sent together (a half-set coordinate is meaningless);
  // null clears it back to "no pin".
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});

/** Copy setup between EXISTING locations — the prototype's
 *  copyConfig panel. Stock, appointments and customers never copy;
 *  the target's chosen parts are overwritten. */
export const CopySetupRequestSchema = z.object({
  toLocationId: z.uuid(),
  parts: z.object({
    services: z.boolean().default(true), // with price and duration
    products: z.boolean().default(true), // with price and minimum stock
    hours: z.boolean().default(true),
    payments: z.boolean().default(true),
    policy: z.boolean().default(true), // cancellation window
    widget: z.boolean().default(true), // online bookability
  }),
});
export type CopySetupRequest = z.infer<typeof CopySetupRequestSchema>;
export const CopySetupResponseSchema = z.object({ ok: z.literal(true) });
