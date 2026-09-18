# Consumer app (`apps/consumer`)

The public face of Velnes: the app ordinary people use to browse
categories, find salons, and book an appointment. It is the sixth app in
the workspace (dev `:5178`, preview `:4178`, vhost `velnes.mk`).

Its design spec is `reference/client-prototype/` — the handover package
Alex supplied (single-file prototype + 5 subsystem docs), imported
verbatim and read-only, SHA-256 verified against the handover's own
manifest (`a5a1c74…f8d94a`). The prototype's stylesheet lives at
`apps/consumer/src/styles/prototype.css` exactly as delivered, with only
the three inline base64 photographs lifted out to `public/photos/` so
the bundle stays small. Screen markup is spliced from the prototype's
own DOM, not retyped: same class names, same structure, same inline
styles, per the pixel-fidelity rule.

## What is real

Every value on screen comes from the platform through its own door. The
app has **no seed data and no fallbacks that invent content** — where a
subsystem does not exist yet, the surface is simply absent.

| Surface | Source |
|---|---|
| Category cards | `GET /public/discovery/categories` — the HQ taxonomy plus the card image and icon HQ uploads (null until HQ dresses a category) |
| Salon cards, results | `GET /public/discovery/salons` — only businesses with `settings.marketplace.listed` |
| Salon page | `GET /public/discovery/salons/:slug` — gallery, description, team (honoring `showTeam`), sellable products, live locations |
| Treatments, prices, durations | the existing `GET /public/services` (per location) |
| Open times | the existing `GET /public/availability` — the one availability engine, no second opinion |
| Booking | the existing `POST /public/book` → `confirmBooking()`, the same door the widget uses |

### The discovery doors (new)

`services/api/src/public/discovery.routes.ts`, contracts in
`packages/contracts/src/discovery.ts`, tests in `discovery.test.ts`.
They are registered **inside the existing public plugin scope**, so they
inherit its rate limit and never touch the authenticated API. Reads run
under `app.public` (the same RLS mode the widget's slug lookup uses),
then drop into `withTenant` for anything tenant-scoped. They are
key-free: a consumer browsing many salons has no publishable key, so the
salon page hands back the salon's own key for the booking doors rather
than letting the app invent one.

A salon appears only if it publishes a marketplace listing, and the page
honors the switches the salon already owns (`showTeam`, `showPrices`).
Turning `listed` off removes it from results and 404s its page — tested.

## Booking

Selection happens on the salon page (location → treatment → option →
professional → day → time); identity is collected in two steps, then the
booking goes through `POST /public/book`. It creates or links a
per-tenant `customers` row exactly as the booking page does today, and
lands in the salon's calendar attributed to its widget.

Two decisions worth recording:

- **The quote must equal the charge.** The first end-to-end booking
  exposed a mismatch: the UI showed a service's `priceFrom` (the
  cheapest variant) while the door charged the base price. The app now
  quotes `variant ?? service.price` — what `confirmBooking` will
  actually charge — and shows a real **variant picker** when a service
  has options, so the chosen option drives price, duration, and the
  availability query alike. "from X" now appears only on teaser cards,
  where it means the cheapest way in.
- **Locations are first-class.** The prototype had one salon with one
  address. Real salons have several, with different catalogs, teams and
  opening hours, so the salon page has a location picker and changing it
  resets the selection. Without it the app silently showed only the
  first location — and, for the demo tenant, a location where the only
  physiotherapist's measured pace exceeds the catalog duration, so the
  engine (correctly) offers nothing.

## Honest deferrals

These are absent rather than faked, and each needs a platform decision
before it can be real:

- **Consumer accounts.** There is no platform-level person table and no
  fourth token shape yet; customers exist only per tenant. So there is
  no login, no "My Velnes" account area, no favourites, no loyalty, no
  Premium, and no appointment history — the whole account layer of the
  prototype is unbuilt. Guest booking is the only path, matching what
  the booking page already does.
- **Email verification.** `queueMail()` + `mail_outbox` exist with a
  mock transport; the prototype's verification-code step is not shown
  because nothing sends yet. The guest flow collects an email and
  attaches it to the booking, unverified — honest about what it is.
- **Notifications.** No consumer notification feed exists;
  `supplier_notifications` is the shape to copy when one is decided.
- **Reviews and ratings.** No tables exist, so every star, review count
  and "top rated" badge from the prototype is omitted rather than
  invented.
- **Maps and distance.** `locations` has no lat/lng (coordinates are
  captured during registration and dropped on approval), so the map
  panels keep the prototype's decorative artwork with real salon names
  as pins, and "Get directions" hands off to Google Maps with the real
  address. A live map with real pins needs `locations.lat/lng` plus a
  backfill from `registrations.draft`, and a provider decision
  (Leaflet + OpenStreetMap needs no key; Google Maps needs one).
- **Offers.** `last_minute_offers` / `personal_offers` are per-customer
  and need an identified consumer, so the prototype's offer rails are
  omitted.
- **Search.** The search field filters the categories and salons already
  loaded. Real search/discovery is still blocked on the §5 answers.
- **i18n.** The app ships English copy; `@velnes/i18n` is wired into the
  other five apps and this one still needs its copy pass.
- **Currency.** Everything is MKD, taken from the API — the prototype's
  €/MKD split was a known seam, not a spec.
