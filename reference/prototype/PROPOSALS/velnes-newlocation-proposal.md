# Proposal — New location lifecycle (create · verify · activate) · 23 aug 2026

**Status: awaiting Alex's approval. No code has been changed.**
Base build: `9fdf10b399523e28ceb971fc347aa104` (21,139 lines).
Core rule (Alex, verbatim intent): **the Salon Workspace creates and
prepares. Revelapps HQ strictly verifies every new location. The owner
activates it only after approval.**

Alex's five decisions of 23 aug are folded in throughout: compound
review for new legal entities (§C), DRAFT visibility split (§E),
search cold-start with limits (§F), Request Changes for registrations
too (§D), auto-grant for owner-level users only (§E).

## What exists / what doesn't (verified against the base build)

- **An ungated `PANELS.location` "Add location" panel exists today**
  (Settings › Business): creates `status:'setup'`, `online:false`,
  all-inactive catalog, zero stock, creator-only access. No HQ, no
  legal entity, no lifecycle. It becomes the *entry point* to the new
  wizard and loses its direct-create power — one door.
- Employees already carry `locs:[…]`; calendar, booking and the timing
  guard already filter on it. Multi-location staff needs **no schema
  work** — copy simply never touches `e.locs`.
- Per-location setup already lives behind doors:
  `locationCatalog[loc]` via `svcAt`/`svcChoice`/`svcVariants`,
  products via `prodAt`/`setStock`, hours via `scheduleFor`, payments
  on the location record. The copy engine is a read of these, not a
  new model.
- Legal entities point at locations (`le.locs`), carry `status`,
  `fiscalProfileId`, and a paymentAccount. The pending/incomplete
  state is already real (Aroma Nordic — load-bearing seed, untouched).
- HQ intake exists: `registrations` → `pending_review` card in
  `hqCustomers()` → binary activate/decline. It gains the richer
  lifecycle in this milestone (§D).
- Search market: `platformSalons` with `newUntil` window, chain dedup
  by `biz` (Grand Chain pair), quality floor — a second location of
  one business is a case the engine already handles.

## A. The lifecycle — one field, one transition door

New per-location field `lifecycle`:
`DRAFT → SUBMITTED → UNDER_REVIEW → CHANGES_REQUIRED → RESUBMITTED →
APPROVED → ACTIVE`, extensible to `SUSPENDED` and `CLOSED` (states
defined and rendered, transition surfaces deferred; note recorded:
suspension blocks *new* liveness, never cancels existing appointments
— that cleanup is its own future flow).

- One function `locTransition(id, to, actor, reason)` validates the
  edge, stamps who/when/why, writes `logAudit`. No screen writes the
  field directly.
- Seed migration: `status:'open'` → `ACTIVE`;
  `status:'setup'` → `DRAFT`. The legacy `status` and `online` fields
  keep working for existing suites; `online` becomes derived-only for
  new code paths.

**`locLive(id)`** — the single liveness predicate
(`lifecycle==='ACTIVE'`), enforced **inside the existing doors**, not
per screen: `availableSlots`, booking intake, `priceFor` consumers,
`routeCheckout`, widget rendering, search-market admission, and the
Personal-Offers / Premium last-minute generators. A non-ACTIVE
location cannot leak to a customer through any current or future
surface, because the surfaces all pass through these doors.

## B. The wizard — registration's spine, minus account, plus copy

Entry: Settings › Locations › **Add new location** (the old panel's
button, repointed). Same draft-object pattern as `state.reg`
(path-writes, per-step validation, fields survive navigation, map-pin
and catalog-search light paths reused verbatim).

1. **Start** — *Start from scratch* or *Copy setup from…* (pick a
   source location). Scratch mirrors today's empty seed.
2. **Location basics** — name, address + map pin, phone, timezone,
   rooms, invoice prefix (auto-suggested, editable). If the country
   differs from any existing location: surface plainly that the
   holiday calendar needs a `HOLIDAY_CALENDARS` row and that no
   fiscal profile exists until the fiscalization milestone — no
   silent Macedonia defaults.
3. **Legal entity** — *Use existing* (radio over the business's
   entities, showing verification status) or *Create new* (the
   registration wizard's company step, reused). Attach = push the
   location id into the chosen entity's `locs` on submit — the
   mapping direction the model already uses.
4. **Copy checklist** (only when copying) — per Alex's include list:
   services/catalog + categories, prices, duration/setup/reset
   timing config, working-hours templates, roles/permission
   configuration, booking/cancellation policies, branding/location
   settings, other reusable operational config (payment methods,
   rounding, tip). Each item a checkbox, all on by default.
5. **Review & submit** — sections with Edit links; submit runs
   `locTransition(DRAFT→SUBMITTED)`.

**The copy engine — snapshot, never a link.** One function
`copyLocationSetup(srcId, dstId, checklist)` executed once at
creation: deep-copies the `locationCatalog` box (incl. variant
overrides), product config **with stock forced to 0**, hours template,
`cancel`/payments/branding fields. Explicitly never copied:
appointments, customer history, transactions, invoices, analytics,
Personal Offers, Customer-Intelligence data, payment credentials,
`e.locs` staff assignments, schedule exceptions (date-bound), reviews.
No back-reference to the source is stored — nothing can sync later by
accident.

## C. HQ side — one intake table, second queue, compound review

`hqCustomers()` gains a **New locations** card next to New
registrations: same table pattern, rows from
locations in `SUBMITTED|RESUBMITTED|UNDER_REVIEW`. Opening a row =
the review card: location details, map pin, submitting business
(already-verified badge), legal-entity panel, submission info.

**Compound review (Alex §1 — YES):** when the submission created a new
legal entity, the review card shows both halves and the decision
covers both — Approve marks the location APPROVED *and* the entity
`verified` in one act; the two remain separate domain objects
internally. With an existing verified entity, that panel is a
one-line confirmation. A location can never sit APPROVED on an
unverified seller.

**Actions:** *Approve* → APPROVED (owner notified, not yet public) ·
*Request changes* → CHANGES_REQUIRED with a **mandatory reason**,
shown verbatim to the owner, who edits and resubmits → RESUBMITTED.
Permanent rejection exists but is the exception, per Alex §5 of the
decision doc.

## D. Registrations upgraded to the same pattern (Alex §4 — now)

`registrations` adopts the identical
`SUBMITTED → UNDER_REVIEW → CHANGES_REQUIRED → RESUBMITTED → APPROVED`
shape: the HQ card's Decline button becomes *Request changes* +
*Decline (exceptional)*; the registration status screen (the wizard's
post-submit view) renders HQ's reason and offers Edit-and-resubmit
through the existing wizard with the draft restored. `pending_review`
maps to `SUBMITTED`. Same transition-door principle: one
`regTransition` function, audited. This keeps one verification
architecture, not two.

## E. Access, scope, and what a DRAFT location may touch

- **Auto-grant (Alex §5):** on creation, the new id is pushed to the
  creator *and every `access:'owner'` user* (account-level). Managers,
  staff, desk: nothing — explicit assignment via the existing
  per-employee locations screen. The "all locations" display label
  keeps computing honestly against the new denominator.
- **DRAFT visibility (Alex §2):** included, with a lifecycle badge, in
  configuration contexts — Settings/locations, catalog per-location
  view, hours, roles/user location assignment, and **stock-transfer
  destination** (pre-opening provisioning is legitimate prep).
  Excluded from operational and customer contexts — till location
  picker, calendar scope, comparison dashboards, widget location
  pickers, and everything behind `locLive`.

## F. Search admission — activation is the door (Alex §3)

- Nothing about a location reaches the market before ACTIVE.
- On activation: admitted with a **temporary controlled discovery
  boost** — the existing `newUntil` window mechanics, capped by the
  same exposure-decay and quality-floor rules as any salon (the
  boost can never outrank the floor).
- **Brand inheritance, bounded:** business-level reputation signals
  (verified badge, brand rating context) may inform ranking;
  location-specific performance metrics (`catQuality`, completion,
  local momentum) start fresh and are earned. Chain dedup applies
  from day one — the Grand Chain case, now real.

## G. Activation — the owner's deliberate act (Alex §6)

APPROVED renders an owner-side status card: "Verified by Revelapps HQ
— activate when you're ready", with a readiness checklist. **Amended
per Alex (23 aug): activation has a minimum readiness gate**, checked
by one function `locReadiness(id)` returning pass/fail per item:

- legal entity attached **and verified**;
- valid location configuration (name + address + city);
- working hours present;
- at least one active, online-bookable service at this location;
- at least one active, bookable employee assigned to this location
  whose skills cover at least one such service.

All five must pass before Activate enables; each failing item renders
as a task with a jump-link to fix it. Optional content (gallery,
photos, descriptions) is shown in the same checklist as informational
and **never blocks**. **Activation permission (amendment 2):** the
Activate action is available only to `access:'owner'` (account-level)
users — extensible later to a role explicitly granted a
location-activation permission. Managers, staff and desk users see
the status and the checklist but no Activate button, and the
transition door refuses them regardless of UI. **Activate** runs
`locTransition(APPROVED→ACTIVE)`; only then do the doors open.
Nothing auto-activates.

## H. Explicitly out of scope

Payment-provider/fiscalization wiring (fills `providerRef`
/`fiscalProfileId` later, per the standing open item) · SMTP
notifications (states render in-app; mail joins the reserved seats) ·
SUSPENDED/CLOSED transition surfaces · supplier locations · linked
/syncing setups between locations (snapshot only, by decision) ·
cross-location appointment cleanup on suspension.

## I. Tests — `test-newlocation.js` (~55 checks) + touched suites

New suite: lifecycle edges (legal and illegal transitions, audit
entries) · wizard step validation + draft survival · copy engine
(catalog/variant/product-config copied, stock 0, forbidden list
verifiably absent, no source back-reference) · compound review both
paths · Request-changes round trip (reason shown, resubmit) ·
`locLive` enforcement at every door (search absence, no
availableSlots, checkout refused, widget absence, offers/Premium
skip a DRAFT location) · auto-grant matrix (owner yes, staff no) ·
**readiness gate** (each of the five requirements individually
blocks; gallery absence does not; Activate disabled until all pass)
· **activation permission** (owner can, manager/staff/desk cannot —
both the button's absence and the transition door's refusal) ·
activation flips exactly the doors and nothing else.
Touched: **test-registration** (new lifecycle states — extended, not
rewritten) · **test-screens** (new wizard route + HQ queue + status
card registered) · **test-merchant** (entity attach on `le.locs`) ·
**test-search** (admission on ACTIVE, boost capped by floor).
Pitfall discipline: new `data-…` attributes into the delegated-click
registries; suites nulling `state.sale` where the till is reopened;
`money()` NBSP normalization; scoped absence checks to `#view`.

## Sizing

Comparable to the registration milestone (that one landed in six
scripted patches, ~300 lines net). Estimate: 6–8 uniqueness-asserted
patches with intermediate hashes as checkpoints — lifecycle+doors ·
wizard · copy engine · HQ queue+compound review · registration
upgrade · access/scope · search admission · suite.

## Definition of done

All existing suites green untouched-or-intentionally-updated ·
new suite green · the old ungated panel demonstrably gone as a
direct-create path · a full walkthrough (create-with-copy + new
entity → request changes → resubmit → approve → activate → appears
in search with capped boost) reproducible from the demo seed ·
outputs copied and hash-verified, then re-verified at next block
start per the standing rule.
