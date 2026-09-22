# Phase 5 — Salon Workspace

**Pixel fidelity is structural.** The prototype's entire stylesheet
lives verbatim in `packages/ui/src/prototype.css` and every screen
emits the prototype's own markup (extracted from its `viewX()`
functions). New screens start from the prototype's markup — never
from approximation (see memory: pixel-fidelity-requirement).

**Trilingual.** English, Macedonian, Albanian via `@velnes/i18n`;
key completeness is compiler-enforced, `en.ts` is the source of
truth. UI language is a per-employee preference; booking refusals
carry structured codes + params so every client localizes the one
gate's sentences. Salon-authored content never translates.

**Architecture.** React Router 7 + TanStack Query; `@velnes/client`
holds the one API client (token rotation, zod parsing at the
boundary — runtime singletons are peer-deps only) and the session
provider. Permission-gated navigation via the shared `can()`
vocabulary; the screen hides, the server still decides.

**Screens.** Login (viewLogin) · Shell (icon rail, topbar, loc-scope
switcher, avatar/env menu) · Calendar (day/week grids, employee
colours, prep/reset bands, the booking drawer over availability +
line-quote) · Cash register (viewRegister: POS types, category tiles,
receipt, extras, payment modal → finishSale; invoices + refunds) ·
Catalog (viewCatalog: grouped tables, service editor with variants/
modifiers/per-location table, products with ledger stock edits) ·
Settings (locations lifecycle cards with the readiness checklist and
owner-only Activate, team & access, the roles permission matrix
constrained to scopeChoices, audit log) · Flightdeck (today's pulse +
the timing-suggestions stack).

**Settings parity (2026-08-26).** The full 13-section prototype nav
with `SEC_PERM` gating and group-header hiding. Pure-choice config
lives in one `businesses.settings` jsonb document behind GET/PATCH
`/business-settings` (zod defaults fill unsaved sections; each
section keeps the prototype's permission split); the business card
(name/address/phone/description/gallery-as-data-URLs + read-only
HQ-managed legal block + `timing_enabled`) sits behind GET/PATCH
`/business`. Opening hours edits the location's real week + cancel
window through audited PATCH `/locations/:id` — the same truth
`scheduleFor` reads — with the Phase-3 exceptions/holidays doors for
the Exceptions tab. Schedules & services persists per-employee
roleTitle/week/skills through the extended employee PATCH. Honest
deferrals: General's tz/currency/week-start render read-only (per-
location / fixed for MK); the online-booking deposit and per-location
online toggles wait for payments and a real door; the form builder
and commission stay disabled. Settings › Company carries the salon's social
links (2026-09-22: website, Instagram, Facebook, TikTok —
`businesses.socials`, typed as handles or URLs; the public salon door
normalises them to links and the consumer salon page shows one icon
per network). Settings › Locations › New location carries the
registration wizard's map from 2026-09-22, so the pin is dropped at
creation (`LocationCreateSchema.lat/lng`) rather than found later
under the location's own settings. Marketplace › "Categories you appear
under" (2026-09-22) is read-only truth, not a pick-list: `GET
/business/categories` names the HQ categories of the salon's active,
online services — discovery's own predicate — so Settings can never
claim a placement the shelf does not make; the prototype's five
hard-coded physio chips are gone.

**Preview access (2026-09-02).** The prototype's startPreview, made
honest: POST `/auth/preview` (users.manage, never yourself) issues a
genuine access token for the target employee — roles, scopes and data
all follow on the server, and the start is audited ("Preview access").
The client keeps the owner's token aside, swaps in the borrowed one,
and silently re-issues it (`renew: true`, not re-audited) when a
mid-preview refresh restores the owner's. The black previewbar pins to
the bottom with Exit; exit returns to Settings → Team & access. `/auth/me`
now carries `roleName` so the bar names the role without a roles
listing the previewed user may not be allowed to fetch.

**Phone inputs (2026-09-02).** Every editable phone field system-wide
(employee panel, new customer, company card, new-location wizard,
salon registration, booking flow) is one shared `PhoneInput` in
`@velnes/ui`: a flag + dial-prefix picker (searchable, country names
localized via `Intl.DisplayNames`, home market pinned first) beside
the national number. The value in and out stays one plain "+389 …"
string — contracts, storage and seeds unchanged. A pasted full
number re-picks the flag; an emptied number emits '' so optional
fields stay null. Tested from the workspace suite (`@velnes/ui`
carries no runner).

**Gallery limits (2026-09-02).** The public gallery's numbers live in
`@velnes/contracts` (`GALLERY_MAX_PHOTOS` 12, `GALLERY_IMG_MAX_CHARS`
600k data-URL chars ≈ 0.45 MB, `GALLERY_MAX_EDGE_PX` 1600): any picked
photo is downscaled client-side (`fileToResizedDataURL` in
`@velnes/ui`, JPEG on white) before it becomes a data URL, the PATCH
contract refuses an oversized photo as the backstop, and the API's
body limit is 10 MiB so a full legal gallery fits (the PATCH replaces
all photos at once). The note under the upload tile states the numbers
in all three languages. Reads stay permissive so an older, larger
photo still renders.

**Locations parity (2026-09-02).** Settings › Locations now carries
the prototype's whole setLocations(): four stats (locations, users,
customers — `/customers` now returns the true `total` alongside the
capped page — and the master catalog), rows with the Copy setup /
Settings actions and the "Not assigned to you" badge, and the
central-vs-local card. The Settings panel edits the location card
through a widened PATCH `/locations/:id` (name, address, city, phone,
tz, rooms, online + the existing hours/cancel/invPrefix), audited as
"Location changed". Copy setup is a new door — POST
`/locations/:id/copy-setup` — that overwrites the chosen parts
(services+prices+durations, products+minimums, hours, payments,
policy, online flag) at an existing target while target stock always
survives (stock is a transaction, never a copy); audited as "Setup
copied". Suspend/Reactivate live in the Settings panel (not on the
row); the panel's week editor runs the prototype's `pad` dense mode
so it fits the panel's width. Honest deferral: the panel shows no
per-location payments checkboxes — location payments have no PATCH
door yet.

**Roles parity (2026-09-02).** Settings › Roles & permissions carries
the prototype's whole setRoles(): role cards with the mark, Standard/
Custom/Locked badges, user counts, Duplicate (POST `/roles` with the
same perms, audited "Role created"), Edit/View, and Remove — a new
DELETE `/roles/:id` door that refuses standard/locked roles and roles
with people still on them, audited "Role removed". Edit/View and
create open the prototype's right-hand panel (roleEdit/roleNew): a
new role names itself and copies a standard role's permissions —
the scope rows appear only once the role exists. The permission
matrix card is live: group tabs, one column per role, locked roles as
scope tags, every other cell a scope select writing through the same
PUT `/roles/:id` door with `scopeChoices` constraining the ladder.
Scope values display their names (No access/Own/…) in all three
languages, and so do the permission labels and group names
(`perm.*`/`permgroup.*` keys); the technical key
(`appointments.view_own`) deliberately stays untranslated.
`pos.discount` is enforced at the sale door: POST `/sales` refuses a
sale carrying any line or cart discount when the caller's role says
none, and the till hides its discount controls without the right —
the seeded Front desk and Employee roles cannot discount, the
owner/manager roles can.

**Permission enforcement (2026-09-02).** Every permission now guards
its door(s) server-side; `authz.matrix.test.ts` walks a bare role
through each and asserts the named refusal. Appointments: create/
edit/cancel each on its own key; the list needs view_location, or
view_own alone returns exactly the caller's rows (the prototype's
"no calendar of anyone else"). Customers: list and every per-customer
read need the view ladder — view_assigned alone is limited to
customers the employee has actually served (via appointments), and
`total` follows the same scope. Catalog reads (resolved catalog,
line-quote, price) accept catalog.view OR pos.checkout OR
appointments.create — the till and booking drawer sell from the same
list. Marketing reads and writes: marketing.personal_offers. Audit:
users.manage or roles.manage. Timing recompute/approve/dismiss:
catalog.edit (a duration is a catalog value). Exceptions/holidays
writes: locations.manage. Supplier reads and writes: suppliers.manage.
Already enforced before: pos.* (checkout/discount/refund/invoices),
catalog.edit, inventory.adjust/transfer, users/roles/locations.manage,
widget.manage + integrations.manage, reports own-vs-wide, and
payments.manage (it gates the sales section of the settings document
server-side). The last three keys got their doors the same day:
customers.export — GET `/customers/export` returns the CSV in the
body (the one client stays the path), audited "Customer data
exported", with an Export button on the Customers page;
inventory.view — GET `/stock/movements` lists the ledger (stock
numbers on the till still ride the catalog read; the history does
not), with a per-product Ledger modal on the Catalog page;
cash_drawer.close — POST `/till/drawer-close` computes the day's
expected cash from the Cash invoices and records counted vs expected
as "Cash drawer closed", with a Close-drawer modal on the Invoices
page. All 32 permissions now govern a real door.

**Categories (2026-09-03, Alex's decision).** Categories are the
Velnes taxonomy: RevelappsHQ defines them, salons pick from the list.
The `service_categories`/`product_categories` tables went platform-
global (migration 20260903120020: duplicates collapsed onto one row
per name, tenant_id dropped, reads open to every RLS context, writes
only under app.hq; the base shelves seeded — Assessment, Manual
therapy, Rehab, Recovery, Massage, Haircuts, Skin care, Nails,
Wellness + the product ones). A salon naming an unknown category on a
service/product write is refused 422 ("Pick a Velnes category"), and
auto-create on first use is gone; the salon Categories tab is
read-only ("set by Velnes") and the service/product panels use a
strict select fed by GET `/categories` (global list + per-tenant item
counts). HQ manages the taxonomy in its app (Categories tab) over
GET/POST `/hq/categories` and PATCH `/hq/categories/:type/:id` —
rename follows every salon's items because items reference the id;
there is deliberately no delete. Registration approval resolves
template categories from the global rows instead of creating
per-tenant ones. So "Knee massage" is the salon's name; "Massage" is
the platform shelf it stands on — and the booking page groups by the
same shelf, ready for §5 cross-salon search. Also fixed a Thursday-afternoon seed flake: c5's upcoming
appointment moves to next week so the "no label without proof" case
never gains a done visit mid-week.

**Service performers (2026-09-03).** The service panel carries "Who
performs this service": Every worker (default), or a checklist of
active employees. It writes `performerIds` (null = everyone, array =
exactly these, omitted = untouched) onto the same employee_skills
truth the booking gate already enforces, keeping the prototype rule
that no skill rows means "does everything": every-worker adds the
service to each explicit list; a named list adds/removes rows, and
excluding a do-everything employee materialises their implicit set
minus this service — the only honest way to exclude them. The
employee panel's services checklist remains the other side of the
same coin.

**Input & till polish (2026-09-03).** `NumInput` in `@velnes/ui`: a
number input whose zero renders as an empty field (placeholder 0) and
whose focus selects the value, so typing replaces instead of landing
behind a stuck 0 — swapped in across the catalog panels, suppliers
order/receive counts, marketing offer percents and the settings
number fields; `defaultValue` cells got select-on-focus. The
appointment contract gained `paid` (an invoice-line read, not a
stored flag): the till hides paid appointments ("never collected
twice") and invalidates its queries after a sale; the till/invoice
modals carry the prototype's 720px max-width the shared #modal
element had inline.

**Drawer location (2026-09-03).** The booking drawer asks where: a
required Location select at the top, preset from the calendar
header's scope (first assigned location under "All locations").
Switching it swaps the catalog, restarts the service rows on the new
location's defaults, and the per-row employee options only list
people who work there — anyone else would just bounce off the gate.

**Drawer customer type-ahead (2026-09-03).** The drawer's customer
field is a type-ahead over the customer file (name or phone, top 8);
picking sets the id, and a typed name that matches nobody is a NEW
customer — the hint says so, optional phone and email fields appear
(the email softly validated client-side so the zod 400 never
surfaces), and the booking door registers them (group "New") in the
same act it books.
An exact-name match silently reuses the existing profile instead of
minting a duplicate, and the door's phone/email matching still
deduplicates walk-ins the public flow already knows.

**Customer contact editing (2026-09-03).** The profile card's email
and phone rows are click-to-edit (customers.edit): pencil → inline
input (flag phone input for the number), Enter/Save writes through
PATCH `/customers/:id`, both changes land in the customer's activity
log as `contact_changed` (from → to), and the toast confirms. A
changed email drops to unverified — migration 20260903160021 adds
`customers.email_verified_at` (null = confirmation pending, standing
addresses grandfathered); the card shows an "Unconfirmed" badge and
the save toasts that the customer must confirm the new address again.
Honest deferral: nothing sends and no verify door exists yet — SMTP
is undecided; the pending state is modelled, never faked.

**Product photos (2026-09-03).** Products carry a small photo
(migration 20260903170022, `products.img` data URL — the file is the
storage, like the gallery). The product panel has a photo picker:
any picture is shrunk client-side (`fileToResizedDataURL`, 512 px)
under a 200k-char contract cap the write door enforces; omitting the
field on inline row edits leaves the photo untouched. It shows on the
catalog rows (the `pthumb`) and the till's product tiles, exactly
where the prototype's product art sat.

**Category requests (2026-09-03).** A salon can ASK for a new shelf:
migration 20260903190023 adds `category_requests` (tenant rows with a
pending→approved/declined lifecycle; tenant + hq RLS) and
`platform_notices` (HQ-written, world-readable). Salon doors: GET/POST
`/category-requests` (catalog.edit to ask; refuses an existing shelf
and a duplicate pending ask) and GET `/notices`. The request modal
opens from the Categories tab ("Request a category") and from the
service panel's category hint; the Categories tab lists the salon's
own requests with status badges and the decline reason. HQ's
Categories tab gains the request intake (its queue with a pending
badge IS the notification, like registrations), Approve — creates the
shelf idempotently, flips the request, writes a platform notice "New
Velnes category: X" — and Decline-with-reason; category Delete exists
too, FK-refereed in its own transaction (409 while any salon's items
stand on the shelf). Salons hear about new shelves through a bell in
the topbar reading `/notices` (unseen dot via a per-browser seen
timestamp — presentation, not business truth).

**E2E.** Four Playwright journeys run in CI against the migrated +
seeded stack: flightdeck, calendar booking, till sale → invoice →
audit, and the trilingual chrome flip.

**Reports (2026-08-31).** One computed door — GET `/reports?from&to`
— reads the same tables the till and calendar write and returns the
whole document: totals with previous-period deltas, revenue per day,
and the six panes (locations, booking sources with the marketplace
fee, services, products with live stock, employees with utilisation
against their own week, VAT reconciling to invoice revenue). Scope
follows the permission: location/business-wide readers see all,
`reports.view_own` sees exactly their own rows. The screen is the
prototype's viewReports with a period filter and a real CSV download
per pane. The seed carries ten deterministic weeks of history
(appointment + paid invoice pairs, sources rotated, six no-shows)
kept away from the customers whose exact figures the suites assert.

## Support — the salon's door to Revelapps (2026-09-04)

A **Support** entry joins the sidebar foot (open to any employee, no
permission gate). It lists the salon's tickets and opens new ones to
Revelapps HQ (`POST /support/tickets`), with a thread view and reply
box (`/support/tickets/:id/reply`). Tickets are scoped to the tenant by
RLS; each open and reply also queues mail to HQ through the outbox
(mock until the provider). HQ answers from its own Tickets queue and
its reply appears back in the thread. See REGISTRATIONS-HQ.md for the
HQ side and the shared `support_tickets` model.

## The flightdeck, rebuilt to the prototype — with a real insights engine (2026-09-05)

The salon home now matches the prototype's `viewFlightdeck` class-for-class
(markup + `prototype.css` verbatim): the greeting, the four-stat pulse,
the priority-of-today hero, the opportunities, and the "stock that needs
a decision" side card above the fold; "today at a glance", "retail and
upsell per person" and the Kumo strip below it. One door composes it all
— `GET /flightdeck` (`flightdeck.service.ts`) — so the UI computes
nothing. Every number is derived from live data: capacity from the
scheduling engine's open gaps vs. booked appointments, revenue and
average spend and new-customers from invoices and customers, low stock
from `location_catalog_products`, the member-offer hero from real open
capacity and the Velnes Premium member count. With "All locations"
selected the flightdeck shows the **primary** operating location (the one
with the most appointments), not the first by name, so the stock and
capacity read from where the salon actually runs.

The opportunities and the Kumo insight come from a **swappable insights
provider** (`insights.provider.ts`) — the same honest-emptiness pattern
as `mailTransport`. `INSIGHT_PROVIDER` defaults to **`rules`**: quiet
regulars (last visit > 60 days), slow products (stock but no recent
sale), and the team's upsell floor are all derived from the salon's own
data, deterministically, no external call. A `claude` provider is
**prepared but inert** — it builds the prompt from the same *aggregated*
signals (counts and sums only, never customer rows) and would ask the
Claude Messages API for ranked opportunities and a Kumo insight, but with
no `ANTHROPIC_API_KEY` it returns null and the caller falls back to rules
rather than fake an answer. Turning the model on is one env flip plus a
key and a privacy sign-off; the flightdeck contract does not change.
Deferred: the Velnes-specific timing-suggestions stack rides along in the
"good to know" fold when present; opportunity copy is server-side English
until the provider becomes the model.

## Getting-started for a fresh salon (2026-09-07)

A newly approved salon lands on an empty flightdeck. `/flightdeck` now
carries an `onboarding` block computed from live data: one step each for
services, products, team, opening hours and a connected supplier — each
reporting `done` and a `count` from the tenant's own rows, plus the
tenant's active `locationCount`. `show` is true only while the salon has
**no sales history yet** (no invoices, no appointments, nothing booked
today), so an established salon never sees it. The flightdeck renders the
block as a checklist card above the pulse: done steps carry a green ✓,
open ones a **Set up** button that deep-links to catalog/settings/
suppliers. A one-time, per-device nudge (localStorage `velnes.fdSeen.<id>`)
adds an "add another location" suggestion the very first time an owner
reaches the deck while on a single location. The UI supplies all copy per
step key; the server reports only the facts. Deferred: the checklist does
not gate anything and there is no server-side "dismissed" state — it
simply retires once real sales activity appears.

For this to reach a brand-new salon at all, the `/flightdeck` route's
"All locations" fallback had to widen: it prefers the busiest location,
then the first **ACTIVE** one, and finally **any** location. A
freshly-approved salon has no ACTIVE location yet — its only location is
still `APPROVED` until the owner activates it — so the old ACTIVE-only
fallback returned 404 and the page rendered blank. The checklist is
precisely the pre-activation guide, so it must resolve that APPROVED
location.

## The logo is the flightdeck door (2026-09-07)

The sidebar's flightdeck tile is gone. The **Velnes logo at the top of
the sidebar** is now the flightdeck link across every workspace screen —
a clickable `.applogo` button that navigates to `/` and carries the
active state while the deck is showing. The `NAV` list dropped its `/`
entry; the shell keeps the flightdeck's page title and the deck route
itself unchanged. A deliberate deviation from the prototype (which had a
home tile and a static logo), at Alex's request.

## Support: layout swap + WhatsApp click-to-chat (2026-09-12)

The support screen flipped: the **new-ticket form is the left pane's
default** (the salon lands ready to write to HQ) and the **tickets
listing sits on the right** (340px) with the "New ticket" button;
selecting a ticket swaps its thread into the left pane. WhatsApp support
lives in the shell, only on the Support screen (like the reference): a
**"Chat on WhatsApp" pill floats bottom-left** and opens a **popup pinned
bottom-right**
— a QR of the `wa.me` deep link, a scan-with-your-phone instruction, and a
green **Open WhatsApp** button, the link pre-filled with a message. The QR
is generated client-side (`qrcode`, bundled, no network). Both the icon
and the popup render **only when `VITE_SUPPORT_WHATSAPP` is set**
(international format, digits extracted for wa.me) — no number, nothing
shows, nothing faked. Set it in `apps/workspace/.env` (see `.env.example`).
The popup footer is honest — "the conversation continues in WhatsApp".
Deferral: this is a one-way hand-off into WhatsApp, not an in-app thread — a true two-way WhatsApp
chat needs the WhatsApp Business Platform (Meta Cloud API or a BSP), a
registered number, webhooks and message templates, the same undecided
integration class as SMTP; it stays on the backlog until Alex picks a
provider.

## Settings › Team › Sign-in link (2026-09-23)

Each team member's row has **Sign-in link**: a panel that first explains
how the employee app sign-in works — open the link on the phone, choose
a password once, then tap your name at the app's address — and mints
the member's personal link on demand, shown as a URL to copy and a QR to
scan. Minting again revokes the previous link; a link works once and
for seven days. The same link rides in the invite mail. Details and the
doors live in `docs/EMPLOYEE-APP.md`.
