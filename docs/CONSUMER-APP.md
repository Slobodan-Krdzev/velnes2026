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
| Booking (guest) | `POST /public/book` → `confirmChain()` → `confirmBooking()`, the same door the widget uses — with the salon's own key, source `marketplace` |
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

**Requests, and mails with links (2026-09-22).** A salon that confirms
bookings by hand gets a request, not a booking: the confirmed screen
says "Request sent", My Velnes shows the appointment as "Awaiting the
salon", and nobody pays until the salon accepts (SCHEDULING › Booking
requests). Every Velnes-app booking now leaves a trace beyond the
calendar: guests ring the salon's bell too, and the customer is mailed
at every step — booked, requested, accepted (with the payment link),
declined (with the salon's note). Links are built on
`CONSUMER_APP_URL` (`.env.example`): a signed-in customer's goes to
their appointment page, a guest's to `/pay/<id>?t=<token>&s=<salon>`,
the token an HMAC of the appointment id under the API secret — a
capability for that one appointment's payment screen, since a guest
has no account to sign into.

**Pay later (2026-09-22).** Both links open the payment screen with
the appointment loaded. `/pay/:id` is the same `BookPay` as after Book
now, fed by the quote instead of route state: a guest's link carries
the token and the salon slug, a signed-in client's bare id goes
through their session. A link opened too early (the salon has not
accepted), too late (cancelled) or twice (already paid) says so
instead of showing a form. The client's appointment page (My Velnes ›
Appointments › one appointment) shows "Pay now · amount" while a
booked appointment is unpaid, and "Paid online" once it is —
`GET /client/me/appointments` now carries `paid`, read from the
appointment's own `paid` column, which the online payment sets.

**Phone and tablet chrome (2026-09-22).** Below 900px the top bar (the
mark, the business link) and the bottom tab bar are rendered once,
above the routes (`app/MobileChrome.tsx`), fixed, on every screen —
salon page, booking steps, payment, account, sign-in included; the
pages' own context bars (a salon's back-and-name, the results search,
the account title) sit under the top bar and stay sticky there, and
the salon's Book-now bar rides above the tab bar. The tab bar's
active tab follows the route; nothing is active on a salon page or a
booking step. Full-screen sheets (search, map, location prompt) still
cover the chrome. The pages no longer carry their own tab bars.

**Available now near you (2026-09-23).** The home page's "Available
near you" became "Available now near you": it asks the search door for
*now* alone (`POST /discovery/search` with `q: 'now'`, the same
now-mode the results page and the "Available now" chip use) and shows
the treatments whose `availableAt` — a start within the next half
hour, from the booking gate itself — is set, sorted by distance from
the viewer's position when one is known, else in the door's own
order with a line saying location would sort it. Each card's slot
button books that very start (`?service=&date=&time=`); an empty
answer says so instead of drawing a hole. The earlier cards read a
salon's *first* treatment and today's first slots, which was a claim
about the wrong treatment.

**Velnes Premium, explained (2026-09-22).** `/premium`
(`features/premium/Premium.tsx`) tells a customer what membership is
in their terms — the first window on last-minute offers, ×1.5 loyalty
at every salon, honest member prices, one membership everywhere — and
says plainly that joining is not open yet (nothing is drawn that does
nothing). Linked from the home footer's "Membership" and a card on My
Velnes' overview. The rules quoted are the platform's real ones
(`PREMIUM_RULES`, `PREMIUM_LOYALTY_MULT`, the offer phases); sign-up
and billing stay deferred. Related: the workspace flightdeck no longer
shows the members-first "fill capacity" hero to a salon with no
Premium members (it would have read "0 members get first access").

**Option groups (2026-09-22).** The salon page now shows a service's
option groups under it once it is in the visit — a "one choice" group
and a "stackable" one alike as tappable cards, each option with its
± price and ± minutes, required groups marked and turning amber until
answered. The chosen options add to the line's price and time on the
page, ride along in the slots request (so the day is offered for the
real duration) and in the booking (`modifierOptionIds`), so the
calendar block, the till line and the invoice carry them. Book now is
held while a required group is unanswered and says which one — the
door's `MISSING_REQUIRED` can no longer be hit from the app.

**Paying (2026-09-22).** After Book now the screen switches to the
payment section (`/book/pay`, `features/booking/pay.tsx`): the visit,
one field for the salon's own promo code or gift card (both may
apply; the discount is shown and charged), and three ways to pay —
Card and Pay at the venue in the app's styling, Apple Pay in Apple's
own black button. The full price is charged; deposits stay deferred.
A guest pays with the `payToken` the booking handed back (an HMAC
capability for that one appointment) through `POST /public/pay/quote`
and `POST /public/pay`; a signed-in client through `POST /client/pay/
quote` and `POST /client/pay` under their own session, which also
rings their bell. Both doors run `quotePayment` / `payAppointment`
(`modules/payments`): a request that the salon has not accepted yet is
refused (`NOT_PAYABLE`), a paid visit is never charged twice
(`ALREADY_PAID`), a bad code is named (`BAD_CODE`), the mock provider's
decline is `CARD_DECLINED`. A payment is a real sale in the till (TILL
› Online payment is a sale) — invoice, transaction, codes redeemed —
so the salon's calendar, till and reports all see it; pay at the venue
records the choice in the history and leaves the till to collect. The
salon's bell rings on payment and the customer gets a receipt mail.
The confirmed screen then says paid (card, invoice number) or booked
with payment at the salon. Pinned by `payments.test.ts`. The mock is
labelled on screen ("test mode") so nobody mistakes it for money.

**Saved cards (2026-09-22).** A signed-in client who ticks "Save this
card" while paying keeps it on the account: `client_payment_methods`
holds the brand, the last four digits, the expiry, the name and the
provider's token — never the number, which only ever crossed the wire
to the (mock) provider. Next time the pay screen offers the saved card
first ("Use Visa ••4242"), with a way to use another; `POST
/client/pay` charges a `savedCardId` through the token, refuses an
expired one, and saves a new card only when asked and only once (same
last four + expiry). My Velnes › Payment methods lists and forgets
them (`GET`/`DELETE /client/me/cards`). A guest never saves a card,
whatever the request says. Private to the client by RLS
(`app.client_id`), readable by HQ for support. Pinned by
`cards.test.ts`.

**No widget needed (2026-09-22).** That key is `salon:<slug>`
(`consumerKey()` in `@velnes/contracts`), not a widget's publishable
key. The public doors resolve it to a virtual row over the salon's
ACTIVE locations (`consumerRow()` in `public.routes.ts`): no domain
list, no widget attribution, source `marketplace`, and the widget's
own configuration door refuses it. Admission to discovery is the
ACTIVE location alone — Alex's rule: the website booking widget is a
separate product not every salon will have, so a salon HQ approved
with live services is on the Velnes app whether or not it ever buys
one. Pinned in `discovery.test.ts` (a widget set to draft changes
nothing), `suggest.test.ts`, and `registrations.test.ts` (a freshly
approved salon, no widget row at all, answers the services door).

A salon appears only if it publishes a marketplace listing, and the page
honors the switches the salon already owns (`showTeam`, `showPrices`).
Turning `listed` off removes it from results and 404s its page — tested.

## Offers for you

A salon's **personal offer** (Phase 9: one customer, one treatment, a
pinned price, a date) now reaches the customer: `GET /client/me/offers`
walks the client's salon links and returns, from each salon's own
context, the live offers for that salon's customer row — salon,
location, treatment, your price against the normal price, until when,
and the salon's own words. The profile overview shows them as
**Offers for you**, soonest to expire first, each with *Book at this
price*, which opens the salon page on that treatment at that location;
there the treatment shows *Your price*, and the visit total uses it,
so the quote is what the booking door charges — it already prices by
customer and stamps the promise on the appointment. Redeemed, expired
and cancelled offers stay the salon's history and are not shown.

## Three languages

The app speaks English, Macedonian and Albanian like every other
Velnes app — `c.*` keys in `@velnes/i18n`, English kept verbatim from
the prototype. The language follows the account when signed in
(`client_users.lang`), else the browser's last choice, else the
browser's own language; a pill in the header and the footer changes
it. Salon-authored words (treatment names, descriptions) never
translate, and neither do proper names (countries in the phone
picker, the social links). Refusals from the booking doors are said
in the app's language by code (`refusal.*`), English being the
fallback. Dates on the salon page and in the date picker use keyed
day and month names. Details in `docs/I18N.md`; the MK/SQ wording is
the assistant's and, as elsewhere, awaits a native read.

## Booking

Selection happens on the salon page (location → treatment → option →
professional → day → time); identity is collected in two steps, then the
booking goes through `POST /public/book`. It creates or links a
per-tenant `customers` row exactly as the booking page does today, and
lands in the salon's calendar as source `marketplace` — no widget is
involved.

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

**"Now".** The search bar understands the word in all three languages
("massage now", "масажа сега", "masazh tani") and there is an
**Available now** chip beside Near me on every results page; both ask
the same thing of the same door. Results that can start within the
next 30 minutes come first, soonest first, each carrying the door's
`availableAt` ("Available now · starts 10:30"); when none can, the
page says *Nothing can start within the next 30 minutes* and shows
what follows rather than an empty page. The old "Available today at
…" line on result cards is gone: it read the salon's first treatment,
not the one on the card. See `docs/SEARCH.md` §10.

**A blank day says why, when it can.** The whole-visit door
(`chainAvailability`, behind `POST /public/slots`) returns
`reason: 'NOBODY_AT_PACE'` when "any professional" was asked and
everyone who does the treatment is measured slower than the catalog
quotes it — the existing rule that skips anyone slower than the offer
left nobody to check. The salon page then says so and opens the
professional picker, instead of "try another date" (which would have
been every date). Seen first on the demo salon: at Centar the only
bookable physiotherapist runs 51 min on a 45-min catalog line. The
proper fix is the salon's — approve the workspace's timing suggestion so
the catalog tells the truth; the app's job is to say what is going on.

**Nothing in the past is offered.** Both slot doors (`availableSlots`
for one treatment, `availableChainSlots` for a visit) cut the day at
"now" in the *salon's* clock (`locations.tz`, default Europe/Skopje):
a day already over has no slots, a future day is untouched, and today
loses what has passed. A past slot is not marked busy — nobody holds it
— it is simply left out. This is the offer side only: `bookingCheck`
still says nothing about the past, because the front desk records
walk-ins after the fact and shares that gate. The slot grid itself
stays inside the platform's `08:00–19:00` day (`DAY_START`/`DAY_END`,
shared with the workspace calendar); a salon's own opening hours narrow
it, never widen it — widening is an open scheduling question (§below).

On the salon page **Today leaves the day row once it has nothing
left**: when the device clock is past the platform's last slot
(18:30), or when the slot door — which knows the salon's clock and the
visit's length — answers an empty list for today. The row then starts
at Tomorrow. The time is the person's to pick: nothing is
pre-selected, "Book now" waits for a tap, and the stepper ticks
**Treatment** once something is in the visit and **Date & time** once
a time is chosen (a check in place of the number — the prototype only
darkened the circle).

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

Two different things, deliberately kept apart (Alex, 2026-09-21):

- **The decision is remembered; the position never is.** On the first
  visit to the home page a Velnes dialog (the prototype's `.gps-modal`)
  asks once — *Allow location access* / *Not now* — before the browser's
  own prompt, so the bare allow/block arrives with its reason already
  given. The answer is kept in `localStorage`
  (`velnes.geo.decision`) and, for a signed-in customer, on the account
  (`client_users.location_allowed`, `PATCH /client/me
  {locationAllowed}` — `20260921160000_client_location_consent.sql`).
  Three states: `NULL` never asked, `true` allowed, `false` refused.
  Signing in reconciles the two: the account's answer wins on a new
  device; a device that decided while signed out pushes its answer up.
- **Allowed means: a fresh, precise fix on every entry to the home
  page.** Nothing about where anyone stood is written anywhere — not
  `localStorage`, not the server. The earlier keys that cached a
  position (`velnes.geo.on`, `velnes.geo.last`) are wiped on sight.
  While the app is open the fix is *followed* with `watchPosition`
  (someone looking for a salon is often walking to one) and forgotten
  when it closes. The ask is two-step — high accuracy for 8 s, then a
  low-accuracy ask that will take a fix up to five minutes old — because
  a desktop indoors often cannot answer the first.
- **Refused means "Near me" is disabled, with a sentence beside it:**
  *Enable the button for better results — turn location on in My
  Velnes › General* (or, signed out, the home-page prompt). The switch
  under **My Velnes › General › Location** is the in-app way back; it
  calls the same `decide()` and so saves to the account too. A refusal
  is never retried against the browser. If the *browser* is what is
  blocking (site permission denied), the sentence says so and points at
  the address-bar site settings instead, since no in-app switch can
  undo that.

**Production.** Browsers expose geolocation only on a secure origin —
https or `localhost`. The consumer app is served over https by Caddy
(`Caddyfile`, automatic TLS), so nothing else is needed; if it were
ever opened over plain http, the provider reports `unsupported` and
"Near me" says "needs a secure (https) connection" instead of
pretending to ask. No `Permissions-Policy` header is set anywhere.

**What the doors receive.** Where a request carries `lat`/`lng`
(`POST /search`, `?km=` radius filtering) the API ranks by distance and
**stores nothing from it** — the consent column holds a boolean, and
`PATCH /me` strips coordinates from its body and has no column to put
them in (tested).

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
salon actually offers something in — filtered on exactly the predicate
the services doors admit by, because if the two ever drifted a card
would open onto an empty page. Admission is three hard rules: the salon
publishes a listing, has a location on lifecycle `ACTIVE`, and is
bookable. A treatment nobody can book does not compete for position on a
surface whose whole purpose is booking. The taxonomy row is untouched and
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
- **Favourites.** Built (Phase C, `docs/FAVOURITES.md`): salons,
  services and professionals on the client's own account, private from
  salons, and feeding the ranking affinity signal. What is still absent
  is the demo seed — `seed-demo.ts` creates no consumer account, so a
  fresh development database starts with the section empty.
- **Billing, Loyalty and Premium.** The prototype's other account
  sections are absent from the menu rather than shown empty: loyalty
  ledgers and premium are per-tenant mirrors today, and nothing backs a
  consumer-side view of them.
- **Reviews and ratings.** No tables exist, so every star, review count
  and "top rated" badge from the prototype is omitted rather than
  invented.
- ~~**Distance and "near me".**~~ **Done in Phase B.** Results are
  ordered by distance from the viewer's rounded position, and a radius
  can already be sent as a hard filter (nothing sends one yet — that is
  Search, `docs/SEARCH.md`).
- **Offers.** `last_minute_offers` / `personal_offers` are per-customer
  promises a salon makes; surfacing them to a linked client is a real
  next step, not yet built.
- **Seeded salons have no pins.** The four salons that registered
  through the wizard have real coordinates; the demo-seed salons
  (velnes-fizio and friends) never had any, so they show an address and
  no map until someone drops a pin in the workspace.
- **Search.** The search field still filters the categories and salons
  already loaded, in the browser. It is no longer *blocked* — §5 is
  settled and Phase B shipped — it is simply not built. The plan is
  `docs/SEARCH.md`; a complete earlier design also exists in
  `reference/prototype/`.
- **Personalised results.** Live as of Phase B: results are ordered by
  where the viewer is and, for a signed-in client who has not switched it
  off, by what they have booked before. `docs/SEARCH-RANKING.md` has the
  rules. Favourites joined that ordering in Phase C. Still absent, and
  honestly so: real availability (the component only knows whether a
  salon takes online bookings at all, so the app must not claim
  "available today" on its strength), reviews behind `quality`, and
  exposure decay.
- **i18n.** The app ships English copy; `@velnes/i18n` is wired into the
  other five apps and this one still needs its copy pass.
- **Currency.** Everything is MKD, taken from the API — the prototype's
  €/MKD split was a known seam, not a spec.

## Registration: the calendar, and auto-verify while there is no mail

The date of birth uses **the prototype's own calendar** — `.cal`,
`.cal-hd`, `.cal-nav`, `.cal-dw`, `.cal-g`, month and year selects
between two arrows, Monday-first, years 2026 back to 1930, opening on
1995. `reference/client-prototype` always had it; the port had dropped a
bare `<input type="date">` in its place, which hands the field to
whatever the browser feels like drawing. It talks ISO to the contract
and shows "13 Jan 1995" to the person. One addition: a Clear, because
the field is optional and the prototype gave no way to un-pick a date.

**Registration auto-verifies while the mail transport is the mock one**
— Alex's call, 2026-09-21, for testing. Nothing is bypassed: the code is
still generated server-side and queued, and the real `verify-email` door
still runs. The app simply reads the code back out of the outbox it was
queued into (`GET /client/dev/last-code`, a route that is only
registered when `env.mailTransport === 'mock'`) and submits it.

The safety argument is that route's existence, not a flag anybody has to
remember: configure a real SMTP transport and it is never registered,
the fetch 404s, and step 6 asks the person for the code exactly as it
does today. Auto-verification cannot follow the app into production
because in production the door it depends on is not there.
