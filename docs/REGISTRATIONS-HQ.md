# Registrations & Revelapps HQ (Phase 8)

Every salon and every location on the platform passes Revelapps HQ —
no auto-approval, ever. This phase builds both sides of that gate.

## The registration machine

`registrations` is a **platform-level** table (no tenant): the status
machine `pending_review → under_review → changes_required →
resubmitted → active / declined`, the whole wizard draft retained as
jsonb, and an append-only `log`.

Doors:

| Door | Who | What |
| --- | --- | --- |
| `POST /registrations` | anonymous, rate-limited | the whole draft, validated by `RegistrationDraftSchema` |
| `GET /registrations/:id?token=` | the applicant | status + draft (never the password back out) |
| `POST /registrations/:id/resubmit?token=` | the applicant | new draft, only from `changes_required` |
| `POST /hq/registrations/:id/{approve,request-changes,decline}` | HQ reviewers | the three decisions |

The applicant's key back in is the **resubmit token**, matched by an
RLS policy (`resubmit_token = current_setting('app.reg_token')`) —
row-level, not an if-statement. Email verification and team
invitations mint their tokens now and wait for SMTP, honestly.

**Approval provisions the tenant world in one transaction**: the
business, the two standard roles (`standardRoles()` — a locked Owner
at the widest legal scopes and the basic Employee kit, see
FOUNDATIONS › Authorization), the owner account with the wizard's own
password (sign-in works the same minute), the legal entity
**verified** (the compound decision), the location, the wizard's
services and products, and one **live booking widget** on the
location. Idempotent: approving twice returns the same world.

**Approval publishes (2026-09-22).** Alex's rule replaces the
prototype's "approval does not publish anything": a salon HQ approves
is bookable on the consumer app the same minute. So activation now
inserts every wizard service `online`, gives the owner a skill row for
each of them (the owner delivers what they listed), creates the live
widget, and then walks the location `APPROVED → ACTIVE` through the
one lifecycle writer — the readiness gate is the same one an owner
passes, and the log names the HQ reviewer as actor. `locTransition`
accepts that claims-less, named-actor call as the one hand besides the
owner's allowed on the switch; a draft that somehow is not ready (no
wizard draft is: the schema demands a service) stays `APPROVED` with
the checklist saying why. Wizard colleagues arrive holding the
Employee role rather than none. HQ's own create-business door still
leaves its bare first location at `APPROVED`: it has no catalog to be
ready with. Pinned by `registrations.test.ts` (ACTIVE + online, the
lifecycle log row, the live widget, the search projection, the
consumer salon door answering `bookable: true`) and the register loop
in `e2e/platform.spec.ts`. The publishing itself is one idempotent
function, `publishSalon()`, and a salon approved before this rule
existed — APPROVED, services offline, no widget — is brought to the
same state by `pnpm --filter @velnes/api exec tsx
--env-file-if-exists=../../.env src/db/publish-salon.ts <slug>`, which
runs the very same function under the tenant and reports what it did.
The readiness gate's staff item now follows the booking door's rule
(a bookable member with no skill rows does everything), so the gate
can no longer refuse a salon the booking page would sell.

## Revelapps HQ (apps/hq)

Separate principals (`hq_users`: hq_super / hq_onboard / hq_support /
hq_tech / hq_audit), separate 8-hour tokens — the HQ and tenant claim
shapes reject each other by construction, so neither token opens the
other side's doors. Cross-tenant reads go through explicit `app.hq`
RLS policies (SELECT only); every write into a tenant's world still
runs through the tenant doors under `withTenant`.

The Customers pane is the prototype's intake table: the
**New locations** queue (SUBMITTED / UNDER_REVIEW / RESUBMITTED
across all tenants), the **New registrations** queue with
Verify & activate / Request changes (reason mandatory) / Decline,
and the businesses table. The location review card shows the legal
entity and flags a **compound review** when the entity is still
pending — approving verifies both in one decision, via
`locTransition` with an HQ actor (`HQ · <name>` in the lifecycle log
and audit trail). Platform log = cross-tenant `audit_log`.
Suppliers and HQ team tabs are honest empty states until their
phases. Intake decisions need hq_super or hq_onboard.

## The New-location wizard (workspace)

Settings › Locations › Add location — five steps (four from scratch):
start (scratch / snapshot copy), location details (a foreign country
flags the holiday-calendar + fiscal follow-ups), legal entity
(attach existing or create pending for the compound review), the copy
checklist, review & submit.

`copyLocationSetup` is the prototype's copy engine verbatim: a
one-time snapshot, never a link. The checklist decides what travels
(services & flags, prices incl. variant overrides, durations with
prep/reset, product configuration, hours, policies, payments);
**stock always starts at 0**; staff, customers, history and payment
credentials never travel; no source reference is stored, so syncing
later is impossible by construction. Whatever is not part of the copy
starts **off** — never a silent fallback to the business-wide
default.

## The registration wizard (workspace, public /register)

The prototype's eight steps, trilingual, validated per step. The
demo-map pin derives lat/lng until real geocoding lands. The resubmit
token is kept client-side (`velnes.reg`); a returning applicant sees
where the machine stands — including HQ's reason, with the whole
draft reopened for correction (only the password is re-entered; it
never travels back). AI-assisted onboarding waits for a real import
service.

## Tests

- `registrations.test.ts` — the anonymous door, the RLS token door,
  email-taken refusal, token-shape separation, the full machine,
  provisioning (new owner signs in, RLS isolation, starter services,
  verified entity), the compound location review with the HQ actor in
  the audit trail, and the cross-tenant platform views.
- `locations.create.test.ts` — snapshot copy semantics, stock at 0,
  owner-only access grants, everything-off from scratch, pending
  entity + submit in one act, permission gate.
- `apps/hq/src/App.test.tsx` — sign-in, intake table, decisions,
  reason-mandatory guard.
- `apps/workspace/src/pages/Register.test.tsx` — per-step validation
  and the whole draft POSTed.
- `e2e/platform.spec.ts` — the two full loops across three apps:
  register → HQ activate → owner signs into their own world;
  owner submits a copy location with a new entity → HQ approves the
  compound → owner activates behind the readiness gate.

## HQ chrome (2026-09-03)

The HQ app wears the prototype's own shell now, pixel for pixel: the
fixed icon sidebar (HQ_NAV — Customers, Categories, Suppliers, HQ
team, Search lab, Platform log; Categories is ours, the shelfkeeper
for the Velnes taxonomy and its request intake), the foot tile "Back
to the salon workspace" (VITE_WORKSPACE_URL, :5173 in dev), the
topbar with the fixed "Revelapps HQ" title, and the avatar menu
top-right (signed-in block, language rows, sign out) — `body.env-hq`
set like the prototype does. Suppliers, HQ team and Search lab stay
honest empty states (Search waits for §5).

The Categories tab's add-form became a top-right accent Add button
opening a small modal (name + item type, Enter books it); the note
copy now tells the truth about guarded delete. The HQ topbar carries
the same notices bell as the workspace (GET `/hq/notices`, unseen dot
via a per-browser seen timestamp), so HQ sees the platform notices it
writes.

Notices carry an audience now (migration 20260903200024: 'salons' |
'hq'; a tenant may insert only audience='hq' rows — it can ring HQ's
bell and nothing else). A salon's category request writes an
audience='hq' notice ("Category request: X · from <salon>") so HQ's
bell rings the moment the ask lands; approval keeps writing the
salons-audience notice. Both feeds filter by audience, and notice
rows are buttons: category notices land on the Categories tab (HQ)
or Catalog → Categories (workspace).

A decline answers the asker: migration 20260903210025 gives notices a
target tenant (null = broadcast; reads RLS-scoped so a salon sees
broadcasts and its own mail, never another salon's; HQ sees all).
Declining a category request — reason mandatory at the door — writes
an audience='salons' notice targeted at the requesting tenant, title
"Category request declined: X", body = the reason; the salon's bell
carries it and clicking lands on Catalog → Categories where the
request row shows the same reason.

## HQ team, Supplier Intelligence, the mail outbox (2026-09-03)

The two empty tabs are real now. **HQ team**: the people list with
role badges, super-only invite (modal), per-row role change and
removal — the last active hq_super can never be demoted, removed, or
remove themselves; invited members carry an unusable hash and the
login door refuses NOT_ACTIVE until the invite flow completes
(status check widened to include 'invited'). **Supplier
Intelligence**: GET `/hq/suppliers` reads the whole chain cross-
tenant (new hq_read policies on supplier_connections/purchase_orders/
purchase_order_lines, hq_write on suppliers) — products, connected +
pending salons, order count and value per supplier; super-only create
(starts unverified) and verify/unverify.

**The mail outbox** models SMTP honestly until the provider is
decided (likely Resend): every mail the platform would send goes
through `queueMail` into `mail_outbox`; the mock transport stamps
rows `mock_sent` and nothing leaves the building. Wired senders:
salon employee invites, customer email-verification on change, HQ
team invites. HQ sees the whole outbox on the team tab (GET
`/hq/outbox`); a real Resend adapter later flips queued → sent with
no schema change.

## Full prototype parity for the two tabs (2026-09-03, second pass)

**Suppliers** wears the prototype's hqSuppliers now: the Add+ pop
(Supplier / Brand kinds), the suppliers TABLE — supplier + contact,
type, brands carried, the Merchant column (legal entity + MID +
Active/Missing-config from the real payment_accounts rows, seeded
owner_id links), catalog counts with salons/orders underneath, and
Verified/Under-review status — plus the missing-config chip filter
and the "Brand, supplier and distributor" tri-minicard ("three
different things, on purpose"): migration 20260903240028 adds
platform `brands` + `supplier_brands` (seeded with the prototype's
four brands and BeautyPro/Aroma carriage), doors GET/POST
`/hq/brands`.

**HQ team** wears hqTeam: the Add+ pop (Team member / Role), the
role-kit card over a real `hq_roles` table — the prototype's six
standard roles (hq_super locked; hq_finance and hq_audit join the
vocabulary, the check constraint replaced by an FK) with
customer-access badges, per-role user-count popups listing the
people, View, and custom-role create-from-base / guarded delete
(GET/POST/DELETE `/hq/roles`) — and the People table (name, role
name, two-factor Required, last active honest '—'/Invite sent) with
the prototype's member edit panel (name, email, the
what-each-role-may-reach picker, remove inside). Honest omission:
the prototype's "Work as this role" switcher waits for the
customer-environment support surface.

## The customers dashboard takes the prototype's shape (2026-09-04)

**Customers** now wears hqCustomers in full: the toolbar (Businesses ·
n accounts, the signed-in badge, the Add button for hq_super/
hq_onboard), the four stat blocks and the complete accounts table —
plan, onboarding progress bar, last support access, Live/Invited/
Onboarding badge, and Open into the prototype's hqBusiness detail
page (onboarding checklist, integrations, commercial, support cards).
Everything on it is DERIVED, never stored: status comes from the
owner's invite state and location lifecycles, the six ONBOARD_STEPS
from whether the rows actually exist (locations past DRAFT, catalog
items, ≥2 employees, an active payment account, a widget), MRR from
`PLAN_PRICES` in contracts (Starter 49 / Business 139 MKD,
subscriptions only, 0 while invited), and sync errors from
`integration_events` (migration 20260904100030 gives HQ read-only
windows on services/products/widgets/integration_events). Open
tickets and last support access are honest zeros/nulls from the same
door until the support-ticket surface is built — the UI never guesses.
The Add button is the prototype's hqNewBiz panel behind POST
`/hq/businesses`: one transaction provisions business + Owner role +
invited owner (no credentials — the owner sets their own password) +
optional APPROVED first location, queues the `owner_invite` through
the outbox, writes the audit line, and refuses duplicate owner emails
(409) and non-onboarding roles (403). "Send reminder" on the detail
page queues a real `onboarding_reminder` mail. The seed now includes
the prototype's other three accounts (Vita Fizio mid-onboarding,
Lumen Beauty live without the widget, Spa Ohrid invited) built from
exactly the rows that derive those dashboard rows. Honest omissions:
"Open customer environment" stays a disabled door and per-step
"Offer help" is left out — both wait for support sessions.

## The team screen's Add flows take the prototype's shape (2026-09-04)

The Add+ pop's two doors stop being modals and wear the prototype's
drawers. **Team member** is hqUser/hqUserEdit: Full name, Email (with
the invite/moving-sign-in hints), the Role select over the live role
kit, the "What each role may reach" card, the prototype's guard
toasts (name first, incomplete email — duplicates refuse server-side
with 409), "Send invite"/"Save changes" in the panel head with the
saved/unsaved status pill, and the guarded remove kept inside the
drawer. **Role** is roleKitNew/roleKitEdit over a real perms column:
migration 20260904110031 adds `hq_roles.perms` seeded with the
prototype's seedHqRolePerms matrix, GET `/hq/roles` serves it in the
prototype's role order, create copies ANY base role's permissions
(no longer std-only), and the create drawer honestly ends with "the
permissions appear once it exists". The edit drawer delivers on
that: the HQ_PERM_GROUPS (now platform vocabulary in
`@velnes/contracts`) render as scope selects (none/read/write) that
apply one move at a time through PATCH `/hq/roles/:id` — merged
server-side, unknown keys refused, the locked keyholder refused,
super-only — with name/description saves through the same door.
Honest omission: role changes are not yet audited — the platform log
writes need a tenantless audit lane first, the same gap every HQ
team/role door already has.

## Support tickets — salon and supplier reach Revelapps HQ (2026-09-04)

Support tickets are now real, replacing the dashboard's honest
`openTickets: 0` placeholder. A salon (workspace **Support** page) or a
supplier (portal **Support** tab) opens a thread to Revelapps HQ; the
ticket carries the conversation as a JSONB thread on one row
(`support_tickets`, migration 20260904200040). Exactly one of
`tenant_id`/`supplier_id` is set, and RLS gives each side only its own
while HQ (`app.hq`) reads them all. HQ's new **Tickets** tab lists every
thread across both origins, answers them (`POST /hq/tickets/:id/reply`,
which mails the opener at the email captured when the ticket was opened)
and moves the lifecycle (`PATCH /hq/tickets/:id`: open → in_progress →
resolved/closed). Every inbound ticket and reply also queues mail
through the outbox — the thread exists in the apps and over SMTP (mock
until the provider). The dashboard's open-ticket stat now counts real
open + in-progress tickets across the platform, and each salon row shows
its own count. Honest note: HQ role changes on tickets are not yet in
the audit trail — the same deferral as the rest of the HQ role kit.

## AI-onboarding — a standalone screen, Phase 1 (2026-09-06)

The prototype's AI-onboarding is its own screen, so ours is too: a
standalone `/onboarding` route in the workspace app with the prototype's
`.ob` design (badge, "One link. / A head start, ready.", the paste box
with the sparkle button, source → reading → ready). "Create your salon"
on the sign-in screen leads here; "Fill it in yourself" / "Step-by-step
registration" drop through to the classic wizard.

The owner pastes their salon's own link; `POST /registrations/import`
fetches it under strict SSRF guards —
http/https only, no credentials in the URL, the host resolved and every
address rejected if private/loopback/link-local/CGNAT/metadata, redirects
followed hop-by-hop with each host re-checked, an 8s timeout and a 2 MB
cap. It then reads the page's **structured data** — JSON-LD
(`LocalBusiness`/`HealthAndBeautyBusiness`/…), OpenGraph and `<title>`,
schema.org `PostalAddress`, `openingHoursSpecification` and
`makesOffer`/`hasOfferCatalog` — into a partial draft: salon name and
phone, legal name, street/city/zip, opening hours, and service names
matched to the starter templates. The reading screen shows honestly what
it did and did not find (business details ✓, treatments, opening hours),
and **Continue** hands that draft to the registration wizard pre-filled;
the owner reviews every step and nothing is submitted automatically.

This is the deterministic, honest slice — no model call and no scraping
of Instagram/Facebook/Fresha/Treatwell (login-walled, anti-bot, ToS).
Deferrals recorded for the later phases: an **LLM extraction** provider
for unstructured pages (behind the same swappable, honest-until-keyed
seam as the flightdeck), and **real third-party integrations** (Google
Places / Instagram Graph / booking-platform partner APIs), each with its
own auth and approval. The endpoint is anonymous but tightly rate-limited
(8 requests / 5 minutes) because it fetches a URL on the caller's behalf.

## AI-onboarding — Phase 2, the Claude extractor (2026-09-07)

The `LLM extraction` deferral above is now built. `/registrations/import`
still runs the deterministic parser as its baseline, then — when
`ONBOARDING_PROVIDER=claude` and an `ANTHROPIC_API_KEY` is set — hands the
page's visible text to the **Claude Messages API** and merges the two.
Where the parser found structured data it stays authoritative; the model
fills the gaps and, crucially, supplies **full services and products with
prices, durations and a category snapped to the HQ taxonomy** — the part
JSON-LD almost never carries. The wizard's Catalog step opens pre-filled
with real, editable rows instead of bare name hints.

One door, one swappable seam — the same shape as the insights provider
and `mailTransport`. No SDK dependency: a single guarded `fetch` to
`api.anthropic.com`, forced through a `salon_profile` tool whose category
fields are **enums of the live taxonomy**, so the model can only choose
existing categories and never coins a new global one (a stray value snaps
to the nearest allowed). Extraction runs automatically on every import;
with no key, or on any network/timeout/parse miss, `claudeExtract` returns
null and the endpoint degrades to the deterministic result — it never
fakes a read. Prices are **currency-converted to MKD**: the model reports
each price as shown plus the ISO currency it saw (€7 → 7 + EUR), and the
server converts with reference rates — the denar is pegged to the euro
(~61.5, so EUR is exact), regional/tourist currencies are approximate,
an unidentified currency is taken as already-MKD, and the owner reviews
every price before saving. Mixed-currency pages convert per line.

## AI onboarding reads deeper — price-list PDFs & sub-pages (2026-09-14)

Many salons show only category tiles on the homepage and keep the real
services (with prices) in a linked **price-list PDF** or a `/services`
sub-page — so the extractor was returning the category names as services.
Now `importSalon` follows same-host links: **price-list PDFs** (named
ones like `cenovnik.pdf` first, read with `unpdf`/pdf.js, line breaks
kept so each "service … price" row stays paired) and a few
**service/price sub-pages** (`htmlToText`), all under the same SSRF
guards, size-gated, best-effort. Their text is appended to the page text
(to a 30k-char budget) and handed to the model, which is told to extract
**individual services, never the category headings** that group them, and
that a bare number on a `.mk` price list is MKD. The model is capped at
40 services / 20 products so a long list can't blow past the output-token
limit (that truncation silently emptied the result before the cap).
Verified on afrodita-s.com.mk: 8 category "services" → **40 real services
with real MKD prices** across Skin care / Nails / Massage. Deferrals:
scanned (image-only) PDFs need OCR we do not do; the 40-service cap keeps
very long menus representative rather than exhaustive.

Booking platforms (Fresha etc.) render only the **first category tab** as
text and load the rest with JavaScript — so the extractor was seeing one
service. `extractStructuredServices` now reads the page's **structured
data**: schema.org JSON-LD `Service` entries (name + category) and the
embedded Next.js/JSON blob (name + `retailPrice`/`price`, as an object
`{value,currency}` or a number, + duration from `minInSeconds`), merged
into a compact list prepended to the model text. That turned a Sarajevo
spa's **1 service into 40**, with categories mapped and **BAM** (Bosnian
mark, EUR-pegged) prices converted to MKD. `BAM`/`HRK`/`RON` joined the
currency table (with `KM`/`kn`/`lei` symbol aliases). Deferral: this
reads the data the page already embeds — it does not drive the site's
JavaScript, so a platform that ships nothing structured still yields only
its server-rendered services.

The import now also brings in the salon's **photos**. `collectImages`
gathers candidates from the page — the social hero (`og:image`) first,
then JSON-LD images, then inline `<img>` — resolved to absolute URLs
with the obvious chrome (logos, icons, SVG, tracking pixels, data URLs)
dropped; `safeFetchImage` fetches each under the same SSRF guards, keeps
only real images, and encodes them as data URLs, size-gated to the
gallery's per-photo cap (`GALLERY_IMG_MAX_CHARS`) and capped at
`GALLERY_MAX_PHOTOS`. Photos are best-effort — an empty result never
blocks an import. This changed the registration draft's `gallery` from
bare names to real `{name, img}` data URLs that persist: on approval the
photos become the `businesses.gallery`, so a salon that registered with a
website arrives with its pictures already in place. The onboarding screen
counts them ("11 photos"), and the wizard's Gallery step opens with the
thumbnails, each removable. The model only ever sees the salon's own **public** page;
no Velnes data is sent. The import result gained `services`, `products`
and a `provider` tag ('rules' | 'claude'); the onboarding screen honestly
labels an AI read "Read by Claude". Guardrails: page text truncated to
14k chars, a 25s timeout, a single low-token call, all under the existing
8/5-min rate limit. Deferrals: no per-day spend cap beyond that rate
limit yet, and the **real third-party integrations** (Google Places /
Instagram / booking-platform APIs) remain the next slice.

## The registration wizard, redesigned (2026-09-06)

The classic wizard now sits on the same flower-pattern sand ground as
the AI-onboarding screen (shared `OB_PATTERN`), so the two front doors
feel like one product.

**The wizard, 2026-09-22.** Step 4 puts the address fields down the
left — street, number, city, postal code and a **country** with its flag
(North Macedonia, Albania, Kosovo; `loc.country`, ISO alpha-2, written
to `locations.country` and `businesses.country` at activation, with the
postal code to `locations.zip`) — and a squarer map beside them. Step 5
is two columns, services left and products right, each with its own
"add" form on top that folds away; a product now carries its **size in
ml**, **opening stock**, **sell price** and **cost** (`products.cost`,
`size_amount`/`size_unit`; the opening stock lands on the first
location's `location_catalog_products.stock` *and* as an `adjustment`
movement ref `registration`, so the stock room's history starts at the
truth). Step 6 adds the **salon card photo**: one gallery entry carries
`card: true`, the consumer app's `cardPhoto()` prefers it over the first
photograph, and the flag survives Settings › Company edits
(`GalleryPhotoSchema.card`).

**Categories from HQ.** The salon-type dropdown (step 2) and the
category a salon files each service under read **one list**: the
taxonomy HQ curates under Categories (`service_categories`, via the
public `/service-categories` door). Until 2026-09-22 the Type dropdown
read a second, separate list (`business_categories`, with its own HQ
section), and a category added in HQ never reached the wizard — Alex
chose one list. The HQ **Business categories** section is retired; the
table and its doors remain for the seeded types already stored on
businesses, and a draft naming a type that HQ has since renamed keeps
it selectable rather than silently changing it.

**A real map.** The Location step (step 4) drops the demo grid for a real
**OpenStreetMap** via Leaflet: click the map or drag the pin to the exact
spot, or press **Find address** to geocode the street + city through
Nominatim and drop the pin there — the lat/lng flow straight into the
draft. Tiles and geocoding are public OSM services, called from the
browser; the wizard stays anonymous. In headless tests the map init is
guarded so the address search still sets the pin.

## Services: the salon writes its own (2026-09-07)

The Services step stopped offering starter templates to tick. The salon
now **creates its own services** — name, duration and price — and picks a
**category from the Velnes taxonomy HQ curates** (the global
`service_categories`, read-open, listed for the anonymous wizard at
`GET /service-categories`). "Knee massage" is the salon's name; "Massage"
is the platform shelf it stands on. The draft's `services` became an
array of `{name, category, durationMin, price}` (RegServiceSchema), and
on approval each becomes a real service under its category (found on the
taxonomy, or created there if new). The old `REG_SERVICE_TEMPLATES` pick
list and the import's template-matching are gone; the website import
still surfaces the service names it read as hints, but the owner writes
the real services.

## Products in the wizard, and a lost-city fix (2026-09-07)

The renamed **Catalog** step (5) now also lets the salon add **products**
the same way services are added — name, a category from the global
`product_categories` taxonomy (`GET /product-categories`), and a price.
`RegistrationDraftSchema` gained `products: RegProduct[]` (optional;
services still required to advance). On approval each product becomes a
`products` master row plus a `location_catalog_products` row at the new
location (`stock: 0`, `pos: true`), so it is immediately sellable at the
till. The step chips are now navigable: a finished step (it and every
prior step validate) shows a **green-tinted chip with a ✓** and jumps
back to it on click; an unfinished step stays disabled.

While here we closed a data-loss bug: `approveRegistration` wrote the
`businesses` row with only id/name/country/since, so the **city** the
owner entered never reached the businesses list HQ reads — a salon
registered in Skopje showed a blank city. The insert now also sets
`city`, `phone`, and a unique booking **slug** derived from the salon
name. Deferral: product stock still starts at 0 — the wizard captures no
opening inventory, and there is no first purchase order.

## Optional legal details + confirm password (2026-09-14)

Tax number and VAT registration are no longer required at registration —
`RegistrationDraftSchema.legal.taxId` dropped its `min(1)`, and approval
stores an empty one as NULL. The flightdeck reminds the owner until they
are entered: `/flightdeck` now returns `legalPending: {taxId, vat}`
(computed from the tenant's default legal entity), and the deck shows a
persistent "Your tax number / VAT registration isn't set yet" note with a
Settings link, regardless of sales activity. Registration step 1 also
gained a **Confirm password** field — a wizard-only value (never sent to
the API) validated to match before advancing.
