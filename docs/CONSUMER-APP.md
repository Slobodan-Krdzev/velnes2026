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

## Departures from the prototype

The prototype's stylesheet ships verbatim; deliberate changes asked for
during review live in `src/styles/overrides.css`, so the reference file
stays the thing the design is measured against. So far: the search card
has air above and below it (it used to ride up over the hero's own lead
line), and the category taxonomy is one sliding row rather than a grid.

The shelf loops. Rather than cloning state or fighting momentum
scrolling, the list is laid out three times and the scroll position is
stepped back a lap whenever it drifts into the copy on either side — so
it runs on for ever in both directions with no visible seam. A list of
three or fewer is left alone, since a loop that short is a jitter. The
same row serves every width: arrows on pointer devices, a swipe on
touch.

## What is real

Every value on screen comes from the platform through its own door. The
app has **no seed data and no fallbacks that invent content** — where a
subsystem does not exist yet, the surface is simply absent.

| Surface | Source |
|---|---|
| Category cards | `GET /public/discovery/categories` — the part of the HQ taxonomy something is published in, plus the card image and icon HQ uploads (null until HQ dresses a category) |
| Salon cards, results | `GET /public/discovery/salons` — only businesses with `settings.marketplace.listed` |
| Salon page | `GET /public/discovery/salons/:slug` — gallery, description, team (honoring `showTeam`), sellable products, live locations |
| Treatments, prices, durations | the existing `GET /public/services` (per location) |
| Open times | the existing `GET /public/availability` — the one availability engine, no second opinion |
| Open times for a visit | `POST /public/slots` — one answer for the whole visit, however many treatments |
| Booking (guest) | `POST /public/book` → `confirmChain()` → `confirmBooking()`, the same door the widget uses |
| Booking (signed in) | `POST /client/book` → the same `confirmBooking()`, plus the customer link and both notifications |
| My Velnes | `GET /client/me`, `/me/appointments`, `/me/notifications`, `/me/salons` |

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

## A visit is several treatments

People book "haircut then colour", so the salon page is multi-select:
tapping a treatment adds it to the visit, tapping again removes it, and
each one carries its own option (the variant picker appears per
treatment). The cart lists them with prices and the running total.

Rather than invent a new kind of appointment, a visit is what it looks
like on the salon's calendar: **real back-to-back appointments, one per
treatment, booked together in one transaction.** If the third treatment
cannot fit, the first two never happened — a test asserts exactly that.
Spacing follows the occupancy rule `bookingCheck` already enforces (an
appointment owns `[start − prep, start + treatment + reset]`), so the
next treatment starts the moment the previous one lets go.

`availableChainSlots` offers only start times where *every* treatment
fits with somebody free for each, so a time is never offered that only
half the visit can keep. Offer and booking share one `freeFor()` helper,
including the existing "skip anyone slower than the catalog quote" rule
— which is what keeps a later treatment's start time true.

Idempotency is per visit: keys are derived per leg (`key:1`, `key:2`),
and a retried visit answers with the visit it already made rather than
colliding with its own appointments.

## Client users — the fourth principal

A **client user** is platform-level: one person, one email, one password,
every salon. That is different from `customers`, which are per-tenant
rows a salon owns. The bridge between them is `client_customer_links`,
and the rule it encodes is: **registering makes you nobody's customer;
booking does.** The first booking at a salon creates (or adopts, if a
guest booking already left one with the same email or phone) that
salon's own `customers` row and links it — so the salon sees a real
customer in its workspace while the person keeps one account.

Tables: `client_users`, `client_customer_links`, `client_notifications`,
plus `appointments.client_user_id`
(`db/migrations/20260918140600_client_users.sql`).

**The token.** `ClientClaims` carries `cli`, which no employee, HQ or
supplier token has, and lacks the `ten`/`sup` claims theirs require: the
four shapes reject each other by construction, and a test asserts a
client token 401s on a staff door. RLS gains `app.client_id` (the
client's own row, links, notifications and appointments) and the narrow
`app.auth = 'client_login'` pre-session mode, matching the pattern the
other three logins already use.

**A client context deliberately cannot read salon tables.** So "my
appointments" reads the client's own rows under their context, then
fills in the labels (salon, location, service, professional) under each
salon's own context — no join across a boundary the database is right to
refuse.

**Email verification is real**, even though delivery is not. Registration
generates a six-digit code, queues it through `queueMail()` into
`mail_outbox` (mock transport: stamped `mock_sent`, nothing leaves), and
an unverified account cannot sign in. Swapping in a provider changes the
transport, not the flow. Registration and resend answer identically
whether or not the address already has an account — the app must never
become an oracle for who is registered.

## Notifications, both ways

One event, two bells, written inside the same transaction as the change:

- **To the client** (`client_notifications`): booking confirmed,
  appointment cancelled, password changed, welcome.
- **To the salon** (`platform_notices`, `audience: 'salons'` — the bell
  the workspace already shows): a new booking from Velnes, a client
  cancellation. This needed one new policy: a tenant context could ring
  HQ but not its own feed.

A client cancelling from My Velnes writes to the salon's calendar, its
`appointment_history` (`source: 'client'`, with the client's name) and
its bell — the salon learns it the same way it learns anything else.

## The salon's own photos

The gallery a salon builds under Settings › Company is what the salon
page shows: a browsable frame in the prototype's `.gal` / `.m-gal`
markup with arrows, clickable dots, a live counter, and a full-size
view (arrow keys move, Escape closes).

A gallery entry is **either a photograph or a colour tile**. The
workspace editor has always allowed naming a space before uploading a
photo of it — the seeded demo salons are exactly that, four named rooms
with tones and no images — so the consumer app renders the tile with its
name rather than substituting a stock photograph of somebody else's
salon. Only entries that are neither are dropped, and dropped
individually: a single malformed entry used to take the whole gallery
down with it, which is why the demo salon appeared to have no photos at
all.

Card images (home, results) use the first real photograph a salon has;
a salon with none falls back to the prototype's decorative image, which
is the one place the app still shows a picture that is not the salon's
own.

## Maps

Real OpenStreetMap through Leaflet — the same setup the registration
wizard already uses. **The pin is the truth on the map; the address text
is the truth in print.** They are separate columns and may disagree,
which is exactly the situation today: pins come from what the owner
placed during registration (`locations.lat/lng`, backfilled from
`registrations.draft` by `20260918120500_location_geo.sql`), while the
printed address is the salon's own text. Approval now keeps the pin
instead of discarding it, and `PATCH /locations/:id` accepts one so a
salon can correct a wrong pin from the workspace.

Maps appear on the salon page, in category results (every matching salon
pinned, the best match in brand colour; the mobile "Map" button opens
the full-screen sheet), on the booking confirmation, and on an
appointment in My Velnes. **There is no decorative map anywhere** — a
category with nothing to pin still gets the real map, with a line saying
so over it, because a drawing of streets that are not streets is worse
than an empty city.

### Where the person is

"Near me" asks the browser for a location **once**. The answer is
remembered (`localStorage`) and then *followed* with `watchPosition`:
somebody looking for a salon is often walking to one, so the dot, the
distances and the framing stay current as they move. A return visit
picks the watch back up with no second prompt — and the Permissions API
is consulted too, so a grant from an earlier visit counts. Revoking
permission in the browser turns it off cleanly rather than leaving a
stale fix on screen.

**None of it leaves the browser.** The coordinates are never sent to the
API: centring and distance are computed locally. A first visit watches
nothing and prompts for nothing until the button is pressed.

With a position known, the map centres on the person (city zoom, results
around them) and re-centres only when they walk off the edge — never
while they are panning a map they are reading. Result cards then show a
real distance ("380 m from you"), measured great-circle from the salon's
own pin, and the salon page says how far it is. Ordering is untouched:
distance is shown, not yet ranked, because ranking is part of the
blocked discovery work.

**Every location now has coordinates.** Salons that registered through
the wizard have the pin their owner placed. The rest — the demo-seed
salons, which never registered — were given **placeholder pins** at
Alex's request (`20260919090700_location_geo_placeholders.sql`): each
salon's own city centre with a small spread so pins do not stack, and
Skopje as the fallback when the city is unknown. These are dummy
coordinates, not surveyed addresses; any salon can correct its own from
Settings › Locations.

**New registrations capture a precise pin.** The wizard's map gained a
"Use my current location" button (device geolocation, high accuracy),
the pin was already required in the wizard, and it is now required at
the door too — `RegistrationDraftSchema` refuses a draft without one, so
no path can create a salon that the map cannot find.

**A salon can move its own pin.** Settings › Locations carries the same
Leaflet picker (one component, two places: the registration wizard and
the location panel), so a wrong or placeholder pin is fixed where every
other location detail is edited, and saving sends it through the
existing `PATCH /locations/:id` under `locations.manage`.

## A category opens onto treatments

A category card used to open onto a list of salons that happened to
offer something in that category. It now opens onto the treatments
themselves: `GET /public/discovery/categories/:id/services` returns every
active, online service published under one category across every
marketplace-listed salon, and each row carries the salon it belongs to —
name, city, pin, whether it is bookable. You choose the treatment, and
the salon comes with it, rather than choosing a salon and hunting for the
treatment inside it. Clicking a result opens the salon page with that
service already in the cart, through the `?service=<id>` link the page
has always understood.

**The shelf only carries categories with something behind them.** A
category card is a promise that there is a result on the other side, so
`GET /public/discovery/categories` now returns only the categories a
listed salon has an active, online service in — filtered on exactly the
predicate the services door lists by, because if the two ever drifted a
card would open onto an empty page. The taxonomy row is untouched and
the registration wizard still offers the whole of it through its own
door (`/registrations/service-categories`), so a category nobody serves
yet stays choosable by a salon while staying off the shelf. A test walks
every card on the shelf and asserts its door returns something.

Prices are withheld rather than hidden. A salon that clears
`marketplace.showPrices` has its numbers nulled at the door and the card
carries `showPrices: false`, so the app never receives a price it is
merely trusted not to draw. A service with variants that undercut its
master price says "from".

**The order is deliberate, and deliberately impersonal.** Bookable
salons lead, then the cheaper treatment, then alphabetically — stable
enough that a test asserts the same request twice returns the same
order. Ranking by where somebody is standing and what they have booked
before is the §5 search-architecture work (exposure decay, chain dedup,
quality floor, consent modes, and the HQ Search lab that tunes them).
That ranking belongs behind this one door when it is decided; it is
absent here rather than guessed at, so nothing has to be un-built when
§5 lands. The map beside the results draws one pin per salon, not one
per treatment.

## Honest deferrals

These are absent rather than faked, and each needs a platform decision
before it can be real:

- **SMTP delivery.** The verification flow is real; the transport is
  not. `env.mailTransport = 'mock'` stamps outbox rows `mock_sent` and
  nothing leaves the building. A provider decision (Resend was the
  guess) turns it on without touching the flow. Until then a dev-only
  door, `GET /client/dev/last-code`, reads the code back out of the
  outbox — it exists only while the transport is mock.
- **Password reset.** There is no "forgot password" door yet; it needs
  the same mail decision.
- **Phone verification.** Phones are collected and shown to the salon
  but never verified — SMS has no provider either.
- **Favourites, Billing, Loyalty and Premium.** The prototype's other
  account sections are absent from the menu rather than shown empty:
  loyalty ledgers and premium are per-tenant mirrors today, and nothing
  backs a consumer-side view of them.
- **Reviews and ratings.** No tables exist, so every star, review count
  and "top rated" badge from the prototype is omitted rather than
  invented.
- **Distance and "near me".** Pins exist now, but there is no geo search
  or distance sort — that is part of the blocked discovery work.
- **Offers.** `last_minute_offers` / `personal_offers` are per-customer
  promises a salon makes; surfacing them to a linked client is a real
  next step, not yet built.
- **Seeded salons have no pins.** The four salons that registered
  through the wizard have real coordinates; the demo-seed salons
  (velnes-fizio and friends) never had any, so they show an address and
  no map until someone drops a pin in the workspace.
- **Search.** The search field filters the categories and salons already
  loaded. Real search/discovery is still blocked on the §5 answers.
- **Personalised results.** Live as of Phase B: results are ordered by
  where the viewer is and, for a signed-in client who has not switched it
  off, by what they have booked before. `docs/SEARCH-RANKING.md` has the
  rules. Still absent from that ordering, and honestly so: favourites
  (not persisted — see above), real availability (the component only
  knows whether a salon takes online bookings at all, so the app must not
  claim "available today" on its strength), reviews, and exposure decay. Two of its
  inputs do not exist yet either: favourites are not persisted anywhere
  (the heart on a card is component state), and there is no geo search
  or distance sort. The cross-salon half is ready: `withClient` already
  reads a client's appointments across every tenant.
- **i18n.** The app ships English copy; `@velnes/i18n` is wired into the
  other five apps and this one still needs its copy pass.
- **Currency.** Everything is MKD, taken from the API — the prototype's
  €/MKD split was a known seam, not a spec.
