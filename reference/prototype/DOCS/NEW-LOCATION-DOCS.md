# New-location lifecycle — create · verify · activate (23–24 aug 2026)

Delivered against build `0b399333830e329735e225299062a3a3` (21,575 lines).
Proposal: `PROPOSALS/velnes-newlocation-proposal.md` (approved by Alex,
23 aug, with two amendments: hard readiness gate + owner-only
activation). Suite: `tests/test-newlocation.js` (80 checks).

## The core rule

**The Salon Workspace creates and prepares. Revelapps HQ strictly
verifies every new location — no exceptions, no auto-approval. The
owner activates it only after approval, behind the readiness gate.**

## Lifecycle

`DRAFT → SUBMITTED → UNDER_REVIEW → CHANGES_REQUIRED → RESUBMITTED →
APPROVED → ACTIVE`, extensible to `SUSPENDED`/`CLOSED` (states exist;
transition surfaces deferred; suspension will block new liveness, never
cancel existing appointments).

- One transition door: `locTransition(id, to, actor, reason)` —
  validates the edge against `LOC_EDGES`, writes `lifecycleLog` and
  `logAudit`. No screen writes `lifecycle` directly.
- `locLive(id)` is the single liveness predicate, enforced inside the
  existing doors: `availableSlots`, `startBooking` (site and widget),
  `finishSale`, personal-offer creation, the Premium generator, and
  market admission. A non-ACTIVE location cannot leak to a customer
  through any surface that uses the doors.
- Seed migration: `status:'open'` → ACTIVE, `status:'setup'` → DRAFT.

## The wizard (route `newloc`)

Settings › Locations › Add location — the old direct-create panel now
only opens the wizard; no location can be created outside the
lifecycle. Five steps: Start (scratch or copy + source) · Location
basics (foreign country triggers the holiday-calendar/fiscal warning,
nothing defaults silently) · Legal entity (attach existing, or create
new → entity lands `pending` with an `incomplete` payment account) ·
Copy checklist (only when copying) · Review & submit (Save as draft,
or Submit for verification).

## The copy engine — snapshot, never a link

`copyLocationSetup(srcId, dstId, checklist)` runs once at creation.
Copyable: services/catalog flags, prices (incl. variant prices),
durations + prep/reset, product configuration (stock always 0),
working-hours template, cancellation policy, payment methods.
Never copied: staff assignments, customers, appointments, history,
invoices, analytics, Personal Offers, intelligence data, payment
credentials. No back-reference to the source is stored.
**Unticked categories seed as scratch (inactive)** — they never fall
through to global defaults (bug found and fixed by the suite: products
would otherwise arrive silently active).

## HQ side

`hq/customers` gains a **New locations** queue above registrations.
Opening a row moves SUBMITTED/RESUBMITTED → UNDER_REVIEW. The review
card shows location, map data, legal entity and payment account.
**Compound review:** if the submission created a new legal entity,
approving the location verifies the entity in the same decision — one
submission, one outcome; internally they stay separate objects.
Actions: Approve (→ APPROVED, nothing public yet) · Request changes
(mandatory reason, → CHANGES_REQUIRED; owner sees the reason verbatim,
corrects, resubmits).

## Registrations speak the same language

Salon registrations now support Request changes → `changes_required`
(reason stored) → owner reopens the wizard with the full draft
restored (`row.draft`) → Resubmit → `resubmitted` → back in the queue
for approve/decline. Decline remains for the exceptional case.

## Readiness gate + activation (Alex's amendments)

APPROVED renders the activation checklist on Settings › Locations.
Five hard requirements via `locReadiness(id)`:
1. verified legal entity attached;
2. location details complete (name, address, city);
3. working hours set;
4. at least one active, online-bookable service;
5. at least one active, bookable employee assigned whose skills cover
   such a service.
Gallery/photos are informational and never block. The Activate button
is rendered only for `access:'owner'` users **and** the transition
door refuses non-owners regardless of UI. Auto-grant on creation:
owner-level users receive the new location automatically; managers,
staff and desk remain explicitly assigned (employees already carry
`locs:[]`, so multi-location staff needs no schema work).

## Search admission

Activation admits the location once (idempotent) to `platformSalons`:
45-day `newUntil` window under the existing exposure/decay rules and
quality floor; brand verification inherited and brand rating carried
as context (`ratingInherited:true`); location performance
(`catQuality` baseline 0.5, momentum 0) starts fresh and is earned.
Chain dedup applies from day one. Admission is audited and
search-logged (`location_admitted`).

## Edge cases carried in the design

Foreign-country locations flag the holiday-calendar row and missing
fiscal profile in the wizard; widgets never auto-include a new
location (explicit `locs` lists, and widget rendering passes through
`locLive`); DRAFT locations are visible in configuration contexts and
excluded from live/customer surfaces via the doors; stock transfers
into a DRAFT location remain possible (pre-opening provisioning).

## Out of scope (unchanged open items)

SMTP; payment-provider + fiscalization wiring (new entities get
`incomplete` payment accounts and `fiscalProfileId:null` honestly);
SUSPENDED/CLOSED surfaces; linked/syncing setups between locations.
