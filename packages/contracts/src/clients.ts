import { z } from 'zod';
import { MoneySchema } from './catalog.js';
import { AVATAR_MAX_CHARS } from './auth.js';
import { ClockSchema } from './scheduling.js';

/** Client users: the ordinary people who book through the consumer
 *  app. The platform's fourth principal — one account, one email, every
 *  salon. A client token carries `cli`, which no employee, HQ or
 *  supplier token has, and lacks `ten`/`sup`, which theirs require: the
 *  four shapes reject each other by construction. */
export const ClientClaimsSchema = z.object({
  cli: z.literal(true),
  sub: z.uuid(), // client_users.id
  email: z.email(),
});
export type ClientClaims = z.infer<typeof ClientClaimsSchema>;

export const CLIENT_CODE_LENGTH = 6;
const PasswordSchema = z.string().min(8).max(200);
const EmailSchema = z.email().max(200);

export const ClientRegisterSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  first: z.string().min(1).max(60),
  last: z.string().max(60).default(''),
  phone: z.string().max(40).default(''),
  // ISO date; the prototype's calendar step is optional.
  dob: z.iso.date().nullable().default(null),
  lang: z.enum(['en', 'mk', 'sq']).default('en'),
});

export const ClientVerifySchema = z.object({
  email: EmailSchema,
  code: z.string().length(CLIENT_CODE_LENGTH),
});
export const ClientResendSchema = z.object({ email: EmailSchema });
export const ClientLoginSchema = z.object({ email: EmailSchema, password: z.string().min(1) });

export const ClientProfileSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  emailVerified: z.boolean(),
  first: z.string(),
  last: z.string(),
  phone: z.string().nullable(),
  dob: z.iso.date().nullable(),
  lang: z.enum(['en', 'mk', 'sq']),
  avatar: z.string().nullable(),
  since: z.iso.date(),
  /**
   * Whether search results are ordered using this client's own booking
   * history — §5, docs/SEARCH-RANKING.md. On by default; one switch in
   * My Velnes › General turns it off.
   *
   * It governs only the viewer's own data, used server-side for the
   * viewer's own eyes: no salon learns why it ranked where it did, and
   * no other client's behaviour is ever involved.
   */
  personalisedResults: z.boolean(),
  /**
   * Whether this person allowed Velnes to use their location. A
   * decision only — never a position: the app takes a fresh fix when it
   * needs one and forgets it. Null means never asked; the home page asks
   * once.
   */
  locationAllowed: z.boolean().nullable(),
});
export type ClientProfile = z.infer<typeof ClientProfileSchema>;

export const ClientSessionSchema = z.object({
  token: z.string(),
  profile: ClientProfileSchema,
});

/** Registration and resend answer the same way whether or not the
 *  address is already taken — the app must not become an email
 *  oracle. `pending` says a code is on its way, nothing more. */
export const ClientPendingSchema = z.object({ pending: z.literal(true) });

export const ClientProfilePatchSchema = z.object({
  first: z.string().min(1).max(60).optional(),
  last: z.string().max(60).optional(),
  phone: z.string().max(40).nullable().optional(),
  dob: z.iso.date().nullable().optional(),
  lang: z.enum(['en', 'mk', 'sq']).optional(),
  avatar: z.string().max(AVATAR_MAX_CHARS).nullable().optional(),
  personalisedResults: z.boolean().optional(),
  locationAllowed: z.boolean().nullable().optional(),
});

export const ClientPasswordSchema = z.object({
  current: z.string().min(1),
  next: PasswordSchema,
});

/** One appointment as the client sees it — across every salon they
 *  have visited, so the salon's name travels with it. */
export const ClientAppointmentSchema = z.object({
  id: z.uuid(),
  ref: z.string(),
  salonName: z.string(),
  salonSlug: z.string().nullable(),
  locationName: z.string(),
  locationAddress: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  serviceName: z.string(),
  employeeName: z.string().nullable(),
  date: z.iso.date(),
  time: ClockSchema,
  end: ClockSchema,
  durationMin: z.number().int(),
  price: z.number().int(),
  status: z.string(),
  /** Free cancellation window the salon set for that location. */
  cancelHours: z.number().int(),
});
export const ClientAppointmentsSchema = z.object({
  appointments: z.array(ClientAppointmentSchema),
});
export type ClientAppointment = z.infer<typeof ClientAppointmentSchema>;

export const ClientNotificationSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  refType: z.string().nullable(),
  refId: z.string().nullable(),
  read: z.boolean(),
  at: z.string(),
});
export const ClientNotificationsSchema = z.object({
  notifications: z.array(ClientNotificationSchema),
  unread: z.number().int(),
});

/** The signed-in booking: same fields as the public one minus the
 *  guest identity, which the session already answers. */
export const ClientBookRequestSchema = z.object({
  key: z.string().min(8),
  slug: z.string().min(1),
  locationId: z.uuid(),
  serviceId: z.uuid(),
  date: z.iso.date(),
  time: ClockSchema,
  employeeId: z.union([z.uuid(), z.literal('any')]).default('any'),
  variantId: z.uuid().nullable().optional(),
  modifierOptionIds: z.array(z.uuid()).default([]),
  /** A visit of several treatments; serviceId names the first. */
  items: z
    .array(
      z.object({
        serviceId: z.uuid(),
        variantId: z.uuid().nullable().optional(),
        modifierOptionIds: z.array(z.uuid()).default([]),
      }),
    )
    .min(1)
    .max(8)
    .optional(),
});

/** The salons a client is a customer of — the bridge, from their side. */
export const ClientSalonLinkSchema = z.object({
  slug: z.string().nullable(),
  name: z.string(),
  visits: z.number().int(),
  since: z.iso.date(),
});
export const ClientSalonLinksSchema = z.object({ salons: z.array(ClientSalonLinkSchema) });

/**
 * A personal offer, from the customer's side.
 *
 * The salon's promise to *this* person for *one* treatment (Phase 9,
 * `personal_offers`), as they see it: which salon and location, what
 * it is, what they pay against what everyone pays, until when. Only
 * live ones travel — a redeemed or expired promise is history, and the
 * salon page keeps the history. Booking it needs nothing special: the
 * booking door already prices by customer and stamps the promise.
 */
export const ClientOfferSchema = z.object({
  id: z.uuid(),
  salon: z.object({ slug: z.string().nullable(), name: z.string() }),
  locationId: z.uuid(),
  locationName: z.string(),
  serviceId: z.uuid(),
  serviceName: z.string(),
  variantId: z.uuid().nullable(),
  variantLabel: z.string().nullable(),
  specialPrice: MoneySchema,
  normalPrice: MoneySchema,
  validUntil: z.iso.date(),
  /** The salon's own words, if it wrote any ("Welcome back!"). */
  intent: z.string(),
});
export const ClientOffersSchema = z.object({ offers: z.array(ClientOfferSchema) });

/** A card the account keeps — brand, last four, expiry, name. Never the
 *  number: the provider's token is the only thing that can charge it. */
export const ClientCardSchema = z.object({
  id: z.uuid(),
  brand: z.string(),
  last4: z.string(),
  expMonth: z.number().int(),
  expYear: z.number().int(),
  holder: z.string(),
  createdAt: z.iso.datetime(),
});
export type ClientCard = z.infer<typeof ClientCardSchema>;
export const ClientCardsSchema = z.object({ cards: z.array(ClientCardSchema) });
export type ClientOffer = z.infer<typeof ClientOfferSchema>;


/**
 * Favourites — Phase C, docs/FAVOURITES.md.
 *
 * The client's own list, across every salon. Three kinds, as the
 * prototype's section subtitle has it: salons, pros and services.
 *
 * Not to be confused with two things that already carry the word or the
 * idea. `favoriteService` in Customer Insights is *derived* — the
 * service a customer books most, computed per salon, chosen by nobody.
 * And "My salons" is `client_customer_links`: the salons you have
 * booked at, which is a relationship rather than a preference.
 */
export const FavouriteKindSchema = z.enum(['salon', 'service', 'pro']);

/** One favourite, resolved for display. Only targets that are public
 *  right now appear — see `ClientFavouritesSchema`. */
export const ClientFavouriteSchema = z.object({
  kind: FavouriteKindSchema,
  /** business / service / employee id, by kind. */
  id: z.uuid(),
  name: z.string(),
  /** The quiet second line: a city, a role, "at <salon>". */
  sub: z.string(),
  /** The salon this belongs to, so a row can link somewhere. */
  salonSlug: z.string(),
  salonName: z.string(),
  /** Card image as a CSS-ready data URL, or null. Pros carry none —
   *  the row draws initials, as the prototype does. */
  photo: z.string().nullable(),
  savedAt: z.string(),
});

/**
 * The whole list, grouped the way the section renders it.
 *
 * What is *not* here is as important as what is. A favourite whose
 * target has been unpublished — a service set to draft, a salon that
 * cleared its listing, a pro whose team is no longer shown — is kept in
 * the database and left out of this response. It is not gone, it is not
 * visible, and the person did not change their mind; if it comes back,
 * so does the row. `hidden` says how many are in that state, so the
 * section can be honest about it rather than silently short.
 */
export const ClientFavouritesSchema = z.object({
  salons: z.array(ClientFavouriteSchema),
  services: z.array(ClientFavouriteSchema),
  pros: z.array(ClientFavouriteSchema),
  /** Saved, but not available to show right now. */
  hidden: z.number().int(),
});

export type FavouriteKind = z.infer<typeof FavouriteKindSchema>;
export type ClientFavourite = z.infer<typeof ClientFavouriteSchema>;
export type ClientFavourites = z.infer<typeof ClientFavouritesSchema>;
