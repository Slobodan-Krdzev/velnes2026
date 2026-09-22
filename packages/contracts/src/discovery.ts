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
  /** The salon's own id. Needed to favourite it, and no more sensitive
   *  than the service ids this surface already publishes. */
  id: z.uuid(),
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
 *  own-use, priced). `locations` are the salon's ACTIVE ones and
 *  `publishableKey` is the consumer key (`salon:<slug>`) the booking
 *  doors accept — null only when no location is open. No widget is
 *  involved: that is the salon's separate website product. */
export const DiscoverySalonDetailSchema = z.object({
  id: z.uuid(),
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
  /**
   * When this treatment can start within the next half hour — "HH:MM"
   * in the salon's own clock — or null. Computed only when the request
   * asked for *now* (the flag, or the word in the query); otherwise
   * always null, never a guess. Real availability from the same
   * `bookingCheck` gate the booking goes through: a salon's hours, its
   * team's hours, existing appointments, holds and rooms.
   */
  availableAt: z.string().nullable().default(null),
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

/**
 * What the viewer brings to a ranked request — §5, and §5's rule about
 * where a location may travel.
 *
 * This is a POST body and not a query string on purpose. A precise
 * location in a URL ends up in access logs, proxy logs and referrers;
 * in a body it does not. The coordinates are rounded to three decimals
 * (~110m) in the browser before they are sent — finer than ranking
 * needs, coarse enough that an exact position never leaves the device —
 * and they are used to order one response and then discarded. Nothing
 * here is stored against the account.
 */
/**
 * A price band — step 8 of docs/SEARCH.md.
 *
 * Bands are terciles across the admitted candidates for *this* query,
 * so "low" means low for what was asked for rather than low against
 * every treatment on the platform. The boundaries come back in the
 * response, because a band with no number attached is a guess.
 */
export const PriceBandSchema = z.enum(['low', 'mid', 'high']);
export type PriceBand = z.infer<typeof PriceBandSchema>;

/**
 * What the filters could offer, computed before any of them was
 * applied — so choosing one does not move the others underneath the
 * person choosing.
 */
export const SearchFacetsSchema = z.object({
  /** Categories present in the unfiltered answer, with how many
   *  treatments each carries. One entry means there is nothing to
   *  narrow and the control should not appear. */
  categories: z.array(
    z.object({ id: z.uuid(), name: z.string(), count: z.number().int() }),
  ),
  /** Tercile boundaries in whole denars. Null when too few treatments
   *  publish a price to divide them honestly. */
  price: z.object({ lowMax: z.number().int(), midMax: z.number().int() }).nullable(),
});
export type SearchFacets = z.infer<typeof SearchFacetsSchema>;

/**
 * "Most chosen" — step 9 of docs/SEARCH.md.
 *
 * The categories the platform books most, in order. Deliberately no
 * counts: the order is the whole of what a customer needs, and
 * publishing volumes would let one salon read another's trade out of a
 * public door.
 *
 * An empty list is a real and expected answer. Below the volume floor
 * the phrase means nothing, and the label is then absent rather than
 * decorative — which is the entire point of making it real.
 */
export const MostChosenSchema = z.object({
  categories: z.array(DiscoveryCategorySchema),
});
export type MostChosen = z.infer<typeof MostChosenSchema>;

export const DiscoveryViewerSchema = z.object({
  lat: z.number().min(-90).max(90).nullable().default(null),
  lng: z.number().min(-180).max(180).nullable().default(null),
  /**
   * When set, a hard admission filter: results further than this are
   * absent, not merely demoted. Unset means "Near me" only sorts — a
   * toggle that silently hides a salon 6km away is a bug report waiting
   * to happen.
   */
  radiusKm: z.number().positive().max(500).nullable().default(null),
  /** Hard admission, like the radius: a band the viewer chose removes
   *  what falls outside it rather than demoting it. */
  priceBand: PriceBandSchema.nullable().default(null),
  /**
   * "Available now": treatments that can start within the next half
   * hour come first, earliest first, and each carries `availableAt`.
   * Not admission — when nothing can start that soon the page says so
   * and the ordinary answer follows, so the person is never shown an
   * empty page for asking a reasonable question.
   */
  now: z.boolean().default(false),
});

/** The ranked form of a category's services. Same rows as the
 *  unpersonalised door, ordered by the ranker. */
export const DiscoveryRankedServicesSchema = z.object({
  category: DiscoveryCategorySchema,
  services: z.array(DiscoveryServiceCardSchema),
  /**
   * The config version the order came from, so a result set can always
   * be explained after the fact. The weights themselves never leave the
   * platform — a salon that could read them could game them.
   */
  rankVersion: z.number().int(),
  /**
   * Whether the viewer's own bookings were used. False for a signed-out
   * visitor, and false when a client has switched personalisation off —
   * so the app can say plainly why an order is what it is, rather than
   * leaving it mysterious.
   */
  personalised: z.boolean(),
  /** What the filters could offer for this category — step 8. */
  facets: SearchFacetsSchema,
  /** A distance limit dropped because keeping it would have left almost
   *  nothing. Reported, never silent. */
  widened: z.enum(['radius']).nullable(),
  /** Treatments a price band removed for publishing no price at all. A
   *  salon that hides its prices vanishing from a price filter looks
   *  like a missing salon unless the page says why. */
  hiddenUnpriced: z.number().int(),
  /** Whether *now* was asked for, and how many results can start within
   *  the next half hour. Zero with `nowRequested` is the page's cue to
   *  say so before showing what follows. */
  nowRequested: z.boolean(),
  availableNow: z.number().int(),
});

/**
 * What the customer might mean, while they are still typing.
 *
 * Three kinds in one list, because there is one search bar and the
 * customer never picks an entity type. The headings a client renders
 * over these are informational — they are not controls, not filters, and
 * not a mode.
 */
export const SearchSuggestionsSchema = z.object({
  salons: z.array(
    z.object({ id: z.uuid(), slug: z.string(), name: z.string(), city: z.string().nullable() }),
  ),
  services: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      salonName: z.string(),
      salonSlug: z.string(),
      categoryId: z.uuid().nullable(),
    }),
  ),
  categories: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      /** How many admitted salons sell something in it. The prototype's
       *  card says "N salons available"; this is that number, counted
       *  rather than guessed. */
      salonCount: z.number().int(),
    }),
  ),
  /** Echoed back so a client can discard a response that arrived late. */
  q: z.string(),
});

export const SearchSuggestRequestSchema = z.object({
  q: z.string().max(120),
});

/**
 * A submitted search.
 *
 * The same viewer context the ranked category door takes, plus the text.
 * A POST for the same reason: the position travels in a body, never a
 * URL. The query itself is in the URL, because a search is worth sharing
 * and a location is not.
 */
export const SearchRequestSchema = z.object({
  q: z.string().min(1).max(120),
  lat: z.number().min(-90).max(90).nullable().default(null),
  lng: z.number().min(-180).max(180).nullable().default(null),
  radiusKm: z.number().positive().max(500).nullable().default(null),
  priceBand: PriceBandSchema.nullable().default(null),
  /** Narrows a query that spanned several categories — "fizio" is four.
   *  Must be one the answer actually contains; anything else simply
   *  matches nothing, which is the honest result of asking for it. */
  categoryId: z.uuid().nullable().default(null),
  /** "Available now" — see `DiscoveryViewerSchema.now`. The word in the
   *  query ("massage now", "масажа сега", "masazh tani") means the same
   *  thing, so either sets it. */
  now: z.boolean().default(false),
});

/**
 * What a submitted search answers with.
 *
 * `directSalon` is set only when the strict rule fires — the whole
 * normalized query equals exactly one admitted salon's whole normalized
 * name, and is not also a category or treatment term. The client then
 * navigates there instead of rendering results; a typo must never be
 * able to do this.
 */
export const SearchResultsSchema = z.object({
  directSalon: z
    .object({ id: z.uuid(), slug: z.string(), name: z.string() })
    .nullable(),
  services: z.array(DiscoveryServiceCardSchema),
  /**
   * Salons the text matched but that were not certain enough to open
   * on their own — two salons sharing a name, or a partial name.
   *
   * Without these, typing a salon name that really exists and happens
   * to be shared, or typed short, answers with an empty page. Offering
   * the choices is what the strict rule refuses to guess at.
   */
  salons: z.array(
    z.object({ id: z.uuid(), slug: z.string(), name: z.string(), city: z.string().nullable() }),
  ),
  rankVersion: z.number().int(),
  personalised: z.boolean(),
  /** How the text was read: an intent, a named treatment, something it
   *  only resembled, or nothing we recognised. */
  how: z.enum(['salon', 'category', 'service', 'fuzzy', 'none']),
  /**
   * Several salons matched the name exactly, so no guess was made. The
   * page can say "which one did you mean" rather than "no results".
   */
  ambiguous: z.boolean(),
  /**
   * Set when the answer had to be broadened to fill the page, and it is
   * always said out loud: `category` when a named treatment's siblings
   * were included, `radius` when a distance limit was dropped. Never
   * pretend a widened answer was the narrow one.
   */
  widened: z.enum(['category', 'radius']).nullable(),
  /** What the filters could offer, before any was applied. */
  facets: SearchFacetsSchema,
  /** Treatments a price band removed for publishing no price at all. */
  hiddenUnpriced: z.number().int(),
  /** Whether *now* was asked for — by flag or by the word — and how
   *  many results can start within the next half hour. */
  nowRequested: z.boolean(),
  availableNow: z.number().int(),
  /** Echoed, so a late response can be discarded. */
  q: z.string(),
});

export type SearchResults = z.infer<typeof SearchResultsSchema>;
export type SearchSuggestions = z.infer<typeof SearchSuggestionsSchema>;

export type DiscoveryViewer = z.infer<typeof DiscoveryViewerSchema>;
export type DiscoveryRankedServices = z.infer<typeof DiscoveryRankedServicesSchema>;
export type DiscoveryCategory = z.infer<typeof DiscoveryCategorySchema>;
export type DiscoveryServiceCard = z.infer<typeof DiscoveryServiceCardSchema>;
export type DiscoveryCategoryServices = z.infer<typeof DiscoveryCategoryServicesSchema>;
export type DiscoverySalonCard = z.infer<typeof DiscoverySalonCardSchema>;
export type DiscoverySalonDetail = z.infer<typeof DiscoverySalonDetailSchema>;
