# Handover addendum — Velnes Premium (20 aug 2026)

Implements the approved proposal (`velnes-premium-membership-proposal.md`)
with Alex's confirmations: hard sunset of salon memberships; "Advance
stage" demo control for timing; small active member seed; Velnes rules
read-only in the salon panel; all VIP terminology replaced by Velnes
Premium Member; minimal customer-side preview; Product Testing at basic
opportunity/matching/invitation level; **at-risk as a soft matching
signal, never a hard requirement**.

Built fresh on the clean restored chain. The quarantined foreign
implementation of this feature was **not** used, referenced, or diffed
against; quarantine folders untouched.

## md5 chain

| Step | md5 | Lines |
|---|---|---|
| Base (status-filter delivery) | `e5a61d2cafa1e544081584e581076355` | 19,613 |
| P1 sunset + Premium core | `f59b445f2aab3ad52e5132c299cab5ad` | 19,428 |
| P1b residuals + PREMIUM_MEMBERS audience + flightdeck/offer VIP swap | `5073fc23dafe421f3e2a92fb82e3ab40` | 19,423 |
| P1c preview-note wording | `b0f54f7fcd72f0810e0bf71d10d70a09` | 19,423 |
| P2 domain + panel + handlers + fd card | `dd51750ddb98709a211cde29133679e1` | 19,692 |
| P2b ternary paren fix | `931c7d6ca766b70646510be5e6be50b7` | 19,692 |
| P2c marketing-overview stat | `921f82810c66bc49c7a813adb0a43b55` | 19,692 |
| P3 edit-drawer section pill | `61ba37243aea6d0af2fd779236424b63` | 19,692 |
| **DELIVERED** (product-testing: description, image, targeted member) | **`09b92338d7561c90c67a10b7b36050ac`** | **19,733** |

## What was removed (hard sunset)

`membershipPlans`, `memberships`, `planById`, `membershipOf`,
`membershipBenefit`; the till's included-session consumption; the
membership branch in the pricing engine (`priceFor` options no longer
know the kind `membership`); profile tab *Memberships*; Marketing tab
*Memberships* (MRR, plans table, members table); `PANELS.membershipNew`,
the `planEdit` modal, `planPanelBody`, `membershipPanelBody`, their
handlers (`data-planedit/planflag/msnew/mscancel`) and registry entries
and panel-name entries; the `MEMBERSHIP_PLAN` phase audience; the
customerEdit membership section (now read-only Premium status); the
service editor's plan table (now an honest retired-note);
`AUDIENCE_V1` VIP-group early access. The customer group "VIP" itself
remains — it is an identity label, not a benefit.

## What was added

**Core** — `VELNES_HQ.premium` (enabled, `loyaltyMult:1.5`, rules
v2026-08.1: maxDiscount 50%, minLead 120, priority 60, escalation 30,
publicFallback on; audit-trail shape included); `isPremium(cid)` as the
single eligibility door (HQ kill-switch works); `premiumMembers()`;
seed c4 + c1 active, c6 expired.

**Loyalty ×1.5** — one line at the `finishSale` earn point, factor read
from HQ config, "· ×1.5 Velnes Premium" appended to the ledger reason.
Non-members unchanged (verified 45 vs 30 points on an 1800 sale).

**Matching** — `MATCH` constants + `memberScore(cid,slot)` →
`{score,why[]}`: service affinity (≥3 bookings), preferred employee
(≥60%), weekday, time band (shared CI helpers), **at-risk +15 as soft
signal** ("a nudge may bring them back"), reliability (no no-shows),
fatigue (−12 when offers received in last 14 days via `custActivity`).

**Opportunity loop** — `memberRecs[]` + `memberRecScan()` (one
deterministic recommendation from tomorrow's real gaps via
`offerDraftInit`, discount capped by HQ rules); `recApprove` →
`premiumOffers[]` staged window (1 best member / priorityMin → 2 member
group / escalationMin → 3 public if `publicFallback` → expired), driven
by the honestly-labelled **"Advance stage · demo"** button
(`pmoAdvance`); `recDecline`. Events via the existing `activityLog`:
`member_offer_sent`, `member_offer_escalated`, `public_fallback`,
`member_offer_expired`, `rec_declined`.

**Product testing (basic)** — `testOps[]`, `tpCreate` (salon-configured:
product, **description, image URL**, optional service, spots, and an
optional **targeted member**; remaining invitations by product/service
affinity up to `qty×2`), `tpRespond` accept/decline (demo buttons; last
accept fills the test and expires open invites). Events
`test_invited/accepted/declined`. The member dropdown lists **own
Velnes Premium customers first, then `VELNES_PLATFORM_MEMBERS`** —
seeded members of other salons (name + home salon only), making the
brief's §3 point structural: the membership pool is platform-owned and
larger than any one salon's customer file. A picked member is
guaranteed top of the invite list (`picked:true`, badge in the UI);
platform members carry their home salon and can accept/decline like
any invitee, but have no local profile, stats, or activity surface.

**Surfaces** — Marketing › **Velnes Premium** (`mktPremium`): stats,
read-only rules card (`data-premrules`, version + accepted-at note),
recommendation rows (`data-recrow`) with why-details and the minimal
member preview (`data-recpreview`), member-offers table with stage
labels, product-testing block with inline form
(`state.tpName/tpSid/tpQty` via `data-set`), recent outcomes. Profile:
**Velnes Premium** tab (status card; expired members see their expired
card), identity badge, edit-drawer read-only section. Flightdeck:
additive recommendation hero (`data-fdrec`) with Approve/Decline —
renders *above* the capacity hero; "Send member offer" replaces "Send
VIP offer"; phase 1 of manual offers now `PREMIUM_MEMBERS`
(`phaseAllows` branch), drawer audience field read-only "Velnes Premium
members".

**Permissions** — acting (approve/decline/advance/test-create) gated by
the existing `marketing.personal_offers`; doors `denied()` without it.
Viewing rides the marketing screen's existing gate.

## Tests

New `test-velnespremium.js` — **63/63** (named deliberately unlike the
quarantined `test-premium.js`). Updated for intentional changes:
test-offers (member audience, membership-pricing groups retired,
flightdeck probes scoped to `.fd-hero:not([data-fdrec])`) **46/46**;
test-screens (marketing tab premium; overlays 78→77 after panel
removals… net with personalOffer: **516/516**, 75 screens);
test-flightdeck (order check allows the optional rec hero) **28/28**;
test-editor **53/53**; test-headers (Add-membership case removed)
**27/27**; test-rolekits (customers filter menu updated to the
two-dimension design from the status-filter feature — see note below)
**74/74**. Full green elsewhere: customerci 183, pos 112, timing 122,
splitshift 74, exceptions 83, hours 29, apptedit 29, calendar 68,
roles 15, responsive 70, ranking 36, ownuse 47, datepick 42, empcolor
42, onboarding 68, scrollbar 12, settings-scroll 43.

**Process note (honest):** the rolekits failures were latent from the
status-filter delivery (its regression ran screens/responsive/pos but
not rolekits). Caught and fixed here. Lesson recorded: any change to a
shared component (filterPop) triggers the suites that encode its design
decisions, not just the screen-level ones.

## Pitfalls (append to the standing list)
11. `test-rolekits` encodes UI *design decisions* (filter menu shape),
    not just permissions — run it when touching shared chrome.
12. The flightdeck may now render **two** `.fd-hero` cards; tests must
    scope with `:not([data-fdrec])` when probing the capacity hero.
13. `saleCustomer` resolves the customer via appointment lines — till
    tests must put a real appointment id in the basket, not a service id.

## Open items (updated)
- Booking-gate/`priceFor()` enforcement of the staged member price:
  V1 shows the lifecycle; enforcement joins the standing priceFor
  milestone (member offers carry sid/price/stage; personal offers
  unchanged).
- Real clock replaces `pmoAdvance` in production; button becomes an
  admin override or is removed.
- Future notification service subscribes to `member_offer_sent` /
  `test_invited` (same event-hook pattern as personal offers).
- Herkomstbesluit + environment investigation remain open; quarantine
  folders (`velnes-quarantine/`, `outputs/QUARANTINE-19aug/`) untouched.
- Carried over: dead `customerEditBody` cleanup.
