import { z } from 'zod';
import { MoneySchema } from './catalog.js';

/** The consumer discovery surface (apps/consumer): read-only, key-free
 *  public doors. Everything here is data a salon has already chosen to
 *  publish — the marketplace listing toggle plus the HQ taxonomy. */

/** A browsable service category card — the HQ taxonomy with its media.
 *  cardImage/icon are data URLs (see hq.ts CATEGORY_CARD_MAX_CHARS);
 *  null on taxonomy rows HQ has not dressed yet — the app renders those
 *  without artwork, never with a placeholder that pretends. */
export const DiscoveryCategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  cardImage: z.string().nullable(),
  icon: z.string().nullable(),
});
export const DiscoveryCategoriesSchema = z.object({
  categories: z.array(DiscoveryCategorySchema),
});

/** A salon card in discovery results: only businesses whose
 *  settings.marketplace.listed is true, and only what the card needs. */
export const DiscoverySalonCardSchema = z.object({
  slug: z.string(),
  name: z.string(),
  city: z.string().nullable(),
  address: z.string().nullable(),
  pitch: z.string(),
  categories: z.array(z.string()),
  /** HQ-taxonomy names of the categories this salon actually serves —
   *  derived from its active services, so results filter on real data. */
  serviceCategories: z.array(z.string()),
  /** First gallery photo (data URL) — null when the salon has none. */
  photo: z.string().nullable(),
  /** The first live location's pin, so results can map the salon.
   *  Null when the salon has not dropped one yet. */
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  /** A live widget exists, so the booking doors will answer for it. */
  bookable: z.boolean(),
});
export const DiscoverySalonsSchema = z.object({
  salons: z.array(DiscoverySalonCardSchema),
});

export const DiscoveryTeamMemberSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: z.string(),
  avatar: z.string().nullable(),
});
export const DiscoveryProductSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  category: z.string().nullable(),
  /** Whole MKD denars, as stored. */
  price: z.number().int(),
});
/** A gallery entry: the photograph a salon uploaded, or — when it has
 *  only named the space so far — the colour tile the workspace editor
 *  shows in its place. One of the two is always present. */
export const DiscoveryGalleryPhotoSchema = z.object({
  id: z.string(),
  name: z.string(),
  img: z.string().nullable(),
  tone: z.string().nullable(),
});

/** The full salon page payload. Team and prices honor the salon's own
 *  marketplace switches; products are the sellable shelf (active, not
 *  own-use, priced). publishableKey/locations come from the live widget
 *  and are null for a listed-but-not-bookable salon. */
export const DiscoverySalonDetailSchema = z.object({
  slug: z.string(),
  name: z.string(),
  city: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  description: z.string(),
  pitch: z.string(),
  /** The salon's own pin — where the map puts it. Independent of
   *  whether it is bookable yet; null until someone drops one. */
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  categories: z.array(z.string()),
  gallery: z.array(DiscoveryGalleryPhotoSchema),
  showPrices: z.boolean(),
  team: z.array(DiscoveryTeamMemberSchema),
  products: z.array(DiscoveryProductSchema),
  bookable: z.boolean(),
  publishableKey: z.string().nullable(),
  locations: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      city: z.string().nullable(),
      address: z.string().nullable(),
      // The map obeys the pin; the address text above is what we print.
      lat: z.number().nullable(),
      lng: z.number().nullable(),
    }),
  ),
});

/** A service as a discovery result: the treatment, and the salon that
 *  offers it. Enough to choose one and go — the variants, modifiers and
 *  live times belong to the salon page, which is where the choosing
 *  turns into a booking.
 *
 *  Prices are null when the salon has cleared `marketplace.showPrices`.
 *  That is a published-or-not decision, so the door withholds the number
 *  rather than shipping it and trusting the app to hide it. */
export const DiscoveryServiceCardSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** HQ-taxonomy category name — the one the result was asked for. */
  category: z.string(),
  durationMin: z.number().int(),
  /** Whole MKD denars, as everywhere. Null when the salon hides prices. */
  price: MoneySchema.nullable(),
  /** The cheapest variant, when a service has several that differ —
   *  null when it has none, or when prices are hidden. */
  priceFrom: MoneySchema.nullable(),
  salon: z.object({
    slug: z.string(),
    name: z.string(),
    city: z.string().nullable(),
    /** First gallery photo (data URL), null when the salon has none. */
    photo: z.string().nullable(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    /** A live widget exists, so the booking doors answer for it. */
    bookable: z.boolean(),
    /** False when the salon publishes no prices, so the card can say so
     *  instead of showing a hole where a number should be. */
    showPrices: z.boolean(),
  }),
});

/** Every published service in one category, across every listed salon.
 *
 *  The order is deterministic and has nothing personal in it yet:
 *  bookable salons first (a result you can actually book leads), then
 *  cheapest first, then by name. Ranking on location and on what a
 *  person has booked before is the §5 search-architecture work and is
 *  deliberately absent rather than guessed at here. */
export const DiscoveryCategoryServicesSchema = z.object({
  category: DiscoveryCategorySchema,
  services: z.array(DiscoveryServiceCardSchema),
});

export type DiscoveryCategory = z.infer<typeof DiscoveryCategorySchema>;
export type DiscoveryServiceCard = z.infer<typeof DiscoveryServiceCardSchema>;
export type DiscoveryCategoryServices = z.infer<typeof DiscoveryCategoryServicesSchema>;
export type DiscoverySalonCard = z.infer<typeof DiscoverySalonCardSchema>;
export type DiscoverySalonDetail = z.infer<typeof DiscoverySalonDetailSchema>;
