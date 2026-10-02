import { z } from 'zod';
import { PublicReviewSummarySchema, RatingSummarySchema } from './reviews.js';
import { AmenityKeySchema, AmenityListSchema } from './amenities.js';
import { WeekHoursSchema } from './locations.js';
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
  /** Verified reviews: the salon's score and count, or null when there
   *  are none or the salon hides them — never a 0.0. */
  rating: RatingSummarySchema.nullable().default(null),
});
export const DiscoverySalonsSchema = z.object({
  salons: z.array(DiscoverySalonCardSchema),
});

/**
 * Why a salon is recommended — said on the card, never guessed by the
 * app (Alex, 2026-09-23). `booked`: the viewer has been there;
 * `favourite`: they saved it (or one of its pros); `category`: it does
 * what they book or favourite elsewhere; `nearby`: it is close.
 */
export const DiscoveryRecoReasonSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('booked') }),
  z.object({ kind: z.literal('favourite') }),
  z.object({ kind: z.literal('category'), category: z.string() }),
  z.object({ kind: z.literal('nearby'), km: z.number() }),
]);
export const DiscoveryRecommendedSchema = z.object({
  /** `history`: the viewer's bookings and favourites decided the order;
   *  `nearby`: their position did; `default`: neither was available. */
  how: z.enum(['history', 'nearby', 'default']),
  salons: z.array(DiscoverySalonCardSchema.extend({ reason: DiscoveryRecoReasonSchema.nullable() })),
});
export type DiscoveryRecommended = z.infer<typeof DiscoveryRecommendedSchema>;

/** How long a salon counts as new to Velnes — Alex, 2026-09-23. */
export const NEWEST_SALON_DAYS = 30;
/**
 * "Newest to Velnes": the open, listed salons that joined the platform
 * within the last `NEWEST_SALON_DAYS`, newest first. A salon joins when
 * its business is created — for a registered salon, the moment HQ
 * approves it.
 */
export const DiscoveryNewestSchema = z.object({
  days: z.number().int(),
  salons: z.array(DiscoverySalonCardSchema.extend({ joinedAt: z.string() })),
});
export type DiscoveryNewest = z.infer<typeof DiscoveryNewestSchema>;

export const DiscoveryTeamMemberSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: z.string(),
  avatar: z.string().nullable(),
  /** This professional's own verified ratings, or null when none. */
  rating: RatingSummarySchema.nullable().default(null),
});
export const DiscoveryProductSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  category: z.string().nullable(),
  /** Whole MKD denars, as stored on the product (the salon-wide price). */
  price: z.number().int(),
  /** Where it is actually sold, and for how much there (2026-10-01):
   *  the shelf of each live location that sells it. A location missing
   *  here does not sell it; the app offers products per location. */
  at: z.array(z.object({ locationId: z.uuid(), price: z.number().int() })).default([]),
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
  /** The salon's links, already normalised to URLs — null when unset. */
  socials: z.object({
    website: z.string().nullable(),
    instagram: z.string().nullable(),
    facebook: z.string().nullable(),
    tiktok: z.string().nullable(),
  }),
  showPrices: z.boolean(),
  team: z.array(DiscoveryTeamMemberSchema),
  products: z.array(DiscoveryProductSchema),
  bookable: z.boolean(),
  publishableKey: z.string().nullable(),
  /** The salon's verified-review summary, or null when there are none
   *  or the salon hides reviews (its marketplace setting). */
  reviews: PublicReviewSummarySchema.nullable().default(null),
  locations: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      city: z.string().nullable(),
      address: z.string().nullable(),
      // The map obeys the pin; the address text above is what we print.
      lat: z.number().nullable(),
      lng: z.number().nullable(),
      /** This location's facilities, in the vocabulary's order — the
       *  page shows the ones of the location it is showing. */
      amenities: AmenityListSchema,
      /** This location's week — weekday "0" (Mon) … "6" (Sun) → periods,
       *  null for a closed day — or null when none is set. The salon
       *  page prints it; booking reads the real availability door. */
      hours: WeekHoursSchema.nullable().default(null),
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
    /** The facilities at the location this card stands for, so a filter
     *  on amenities is a filter on keys. */
    amenities: AmenityListSchema.default([]),
    rating: RatingSummarySchema.nullable().default(null),
  }),
  /**
   * The place (Alex, 2026-09-29): a result is a treatment at ONE of the
   * salon's ACTIVE locations, so a salon with two locations is two
   * results where it offers the treatment at both — each with its own
   * pin, town, facilities and availability. `salon.lat/lng` are this
   * location's pin.
   */
  location: z.object({
    id: z.uuid(),
    name: z.string(),
    city: z.string().nullable(),
    address: z.string().nullable(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
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
  /** Who can take that start (2026-10-01) — so the card's link lands on
   *  the salon page with the professional chosen as well as the time. */
  availableEmployeeId: z.uuid().nullable().default(null),
  /**
   * The first free start on the day that was asked for (`when`), or —
   * for a party with no day — the first day within the horizon that
   * has one: the salon's own calendar date and "HH:MM" in its clock.
   * Present on every card when `when` or `party > 1` was asked, since
   * those are admission; null otherwise, never a guess.
   */
  availableOn: z.object({ date: z.string(), at: z.string() }).nullable().default(null),
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
  /** Every published price in the unfiltered answer, ascending, whole
   *  denars — the histogram behind the price-range control (Alex,
   *  2026-09-29). Empty when nothing is priced. */
  prices: z.array(z.number().int()).default([]),
  /** The amenities present across the unfiltered answer, with how many
   *  treatments each backs — only what can be narrowed is offered. */
  amenities: z.array(z.object({ key: AmenityKeySchema, count: z.number().int() })).default([]),
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

/**
 * "When" (Alex, 2026-09-30): a day the treatment must have a free start
 * on, hard admission. Relative words, not dates, so a shared link stays
 * true next week and the day is resolved in each salon's own clock
 * (`locations.tz`), the way *now* is. `weekend` is the coming Saturday
 * and Sunday — the rest of it, when it has already begun.
 */
export const WhenSchema = z.enum(['today', 'tomorrow', 'weekend']);
export type When = z.infer<typeof WhenSchema>;
/** How many people must be seen at the same time — "for two". One is
 *  the ordinary case. Bounded: a group is a different product. */
export const PARTY_MAX = 4;
export const PartySchema = z.number().int().min(1).max(PARTY_MAX);
/** How far ahead "for two" looks when no day was named. */
export const PARTY_HORIZON_DAYS = 7;

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
  /** A town the salon is in (`businesses.city`, matched case-insensitively).
   *  The "Where" of the phone's search sheet when it is not "Nearby" —
   *  hard admission like every filter, never widened. */
  city: z.string().trim().min(1).max(80).nullable().default(null),
  /** A price range in whole denars, inclusive, on the treatment's
   *  cheapest way in — hard admission; an unpriced treatment falls out
   *  and is counted in `hiddenUnpriced`, like a band. */
  priceMin: z.number().int().min(0).nullable().default(null),
  priceMax: z.number().int().min(0).nullable().default(null),
  /** Amenities the salon's location must all have — keys, never labels. */
  amenities: AmenityListSchema.default([]),
  /** A day with a free start, or nothing — see `WhenSchema`. Each
   *  admitted card then carries `availableOn`. */
  when: WhenSchema.nullable().default(null),
  /** "For two": only where `party` people can be treated at the same
   *  time — that many professionals free together, and rooms for them,
   *  through the same gate a booking goes through. With `when`, on that
   *  day; alone, within `PARTY_HORIZON_DAYS`. Each seat is still its
   *  own booking. */
  party: PartySchema.default(1),
});

/** The towns salons are actually in — the phone's "Where" list. Only
 *  admitted (listed, open) salons count, so a town is a promise there is
 *  something to book there. Most salons first, then by name. */
export const DiscoveryTownsSchema = z.object({
  towns: z.array(
    z.object({
      name: z.string(),
      salons: z.number().int(),
      /** Where the town is, as the centre of its salons' pins — so a
       *  list can keep the towns within reach of the viewer. Null when
       *  none of its salons has placed a pin. */
      lat: z.number().nullable(),
      lng: z.number().nullable(),
    }),
  ),
});
export type DiscoveryTowns = z.infer<typeof DiscoveryTownsSchema>;

/**
 * Discovery suggestions — what the phone's search sheet offers before
 * anybody types (Alex, 2026-09-29). Each one is a **search intent**, not
 * an entity: a kind, an honest reason, the thing it refers to, and the
 * filter payload it stands for — which maps one-to-one onto the sheet's
 * What / Where / When. The client renders the words from the kind, so a
 * suggestion localises without the server knowing a language.
 *
 * `reason` is the evidence, and the wording must not outrun it:
 * `favourite`/`visited`/`history` come only from the viewer's own
 * account (and only with personalisation on); `town`/`nearby` from the
 * town or position the request carried; `popular` from ninety days of
 * bookings; `inventory` merely from what is on offer.
 */
export const SuggestionKindSchema = z.enum([
  'salon_again', // a salon the viewer favourited or visited — a destination
  'category_again', // a category the viewer has booked before
  'category_now', // a category, available now, near the viewer
  'category_town', // a category on offer in the chosen town
  'category_near', // a category on offer around the viewer's position
  'category_popular', // a category the platform books most
  'category_offer', // a category on offer, with no more evidence than that
  'now_all', // anything that can start within the half hour
]);
export const SuggestionReasonSchema = z.enum(['favourite', 'visited', 'history', 'town', 'nearby', 'popular', 'inventory', 'now']);
export const SearchIntentSchema = z.object({
  /** A category's name — the sheet slugs it the way the shelf does. */
  category: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** A salon: the intent is a destination, not a filter. */
  salon: z.object({ slug: z.string(), name: z.string() }).nullable(),
  city: z.string().nullable(),
  nearby: z.boolean(),
  radiusKm: z.number().positive().nullable(),
  now: z.boolean(),
});
export const DiscoverySuggestionSchema = z.object({
  id: z.string(),
  kind: SuggestionKindSchema,
  reason: SuggestionReasonSchema,
  intent: SearchIntentSchema,
  /** How many salons back this suggestion where that is known (a town's
   *  or a radius's inventory) — null when it is not the point. */
  salons: z.number().int().nullable(),
});
export const DiscoverySuggestionsSchema = z.object({
  /** `history`: the viewer's own account shaped these; `context`: their
   *  town or position did; `default`: neither was available. */
  how: z.enum(['history', 'context', 'default']),
  suggestions: z.array(DiscoverySuggestionSchema),
});
export type DiscoverySuggestion = z.infer<typeof DiscoverySuggestionSchema>;
export type DiscoverySuggestions = z.infer<typeof DiscoverySuggestionsSchema>;
export type SearchIntent = z.infer<typeof SearchIntentSchema>;

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
  /** A salon with more than one ACTIVE location is one row per location
   *  (Alex, 2026-09-29), each naming its place; a one-location salon is
   *  one row with `location: null`. `id` is the salon's either way. */
  salons: z.array(
    z.object({
      id: z.uuid(),
      slug: z.string(),
      name: z.string(),
      city: z.string().nullable(),
      location: z.object({ id: z.uuid(), name: z.string(), address: z.string().nullable() }).nullable(),
    }),
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
  /** See `DiscoveryViewerSchema.city`. */
  city: z.string().trim().min(1).max(80).nullable().default(null),
  /** See `DiscoveryViewerSchema.priceMin` / `priceMax` / `amenities`. */
  priceMin: z.number().int().min(0).nullable().default(null),
  priceMax: z.number().int().min(0).nullable().default(null),
  amenities: AmenityListSchema.default([]),
  /** See `DiscoveryViewerSchema.when` / `party`. */
  when: WhenSchema.nullable().default(null),
  party: PartySchema.default(1),
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
