# Velnes Premium Membership — Opinion & Prototype Architecture Proposal
**For approval · 18 aug 2026 · nothing here is built**
Base file: `70da8639abf596e901204ca472c77862` (19,579 lines).
Source: `Velnes_Premium_Membership_Claude_Architecture_Brief_Final.docx` (read in full).

---

## Part I — My opinion

### 1. The concept is strong, and it lands on ground we already prepared

The brief's core loop — **Opportunity → Eligibility → Matching → Offer
→ Notification → Outcome → Better matching** — is not a new system for
this codebase. It is the unification of four things we built this
month, each already speaking the right language:

| Brief concept | Already exists as |
|---|---|
| "Velnes monitors availability, finds at-risk slots" | The flightdeck's fill engine — it already computes empty capacity, unsold value and builds the hero recommendation |
| "Owner approves, Velnes executes" | The flightdeck hero card ("Priority of today… [Send VIP offer]") — your screenshot from this morning *is* the §8 Approve/Decline card, one relabel away |
| "Member #1 (60 min) → member group → public SPECIAL OFFER" | **The offer phase machinery, verbatim.** `offers[].phases[]` with per-phase audience, start/end times, and `phaseAllows` resolving `SPECIFIC_CUSTOMERS` — the three-stage escalation is literally three phases. This is the single luckiest fit in the whole brief |
| "Score members by service/employee/time/location affinity, recency, reliability, fatigue" | `custStats(cid)` — favorite services, employee %, weekday/daypart, cadence, no-shows are all computed; **fatigue** is a read over `custActivity` (offers received recently). The matching engine's inputs exist to the decimal |
| "Record outcomes so matching improves" | `custActivity[]` — append-only, actor/intent/amount per event, with `offer_opened`/`offer_booked` already reserved as future event names |

So my headline opinion: **yes, swap it — the architecture cost is far
lower than the brief assumes**, because the brief describes the system
we were converging on anyway.

### 2. Three honest tensions to settle before anyone codes

**(a) You are deleting a salon revenue product, and it has roots.**
The current memberships are not decoration: `membershipPlans` carry
included sessions and discounts, `membershipBenefit()` is a **pricing
door** the till consults, checkout *consumes* included sessions
(`ms.used[sid]++`), and Marketing shows MRR. Swapping to a
Velnes-owned subscription removes recurring salon revenue and a
pricing mechanism. That may be exactly the strategy (platform owns the
relationship), but it must be a conscious decision, not a side effect
— and the removal touches the till, the pricing door, the edit drawer,
two tabs and the pos test suite. I propose a **hard sunset** (clean
removal, no dormant plan code) because two membership systems side by
side would confuse every surface; but see Decision A.

**(b) Most of the brief lives outside this prototype.** Subscriptions,
payments, push notifications, the customer app, the Revelapps HQ
Superadmin panel — none of these are salon-workspace surfaces. The
prototype's job is the **salon side + the domain shapes**: the
read-only rules panel, the recommendation card, member recognition
everywhere a customer appears, product testing creation, matching
(demonstrated with real numbers), and outcome logging. Everything
customer-side is represented by honest state, never simulated
delivery — the same demo-honesty rule as the flightdeck. HQ config is
a seeded read-only constant with an audit trail shape.

**(c) Time is the one thing the prototype doesn't have.** The 60→90
minute escalation needs a clock; the prototype has none (the standing
"no cron" rule — expiry is derived). Two honest options: derive stage
from real wall-clock time (works, but demos badly — you'd wait an
hour), or an explicit **"Advance stage" demo control** on the
recommendation card, labelled as demo machinery (flightdeck-style
honesty). I propose the demo control (Decision B).

### 3. How this relates to what we just shipped

**Personal Offers stay.** They are the *owner-initiated* commercial
object ("I decide Anna gets the facial at 1800"). Member last-minute
offers are *Velnes-initiated* slot rescue. Different actor, different
trigger, same family: both write `custActivity`, both respect the
one-customer audience idea. The Customer Intelligence page keeps its
suggestions; a member's profile simply gains the Premium badge and,
later, "member responds well to offers" once outcome data flows.

**The VIP group loses its early-access job.** Today the flightdeck
offer's phase 1 targets the VIP *customer group*. Under the brief,
early access belongs to *Premium members* (a paid status, not an owner
label). The group system stays for what it is (who someone is to you),
but the offer flow's phase-1 audience changes meaning. This is a real
product change to the existing offer feature — flagged, not smuggled.

---

## Part II — The swap map (every existing touchpoint)

| Surface | Today | After the swap |
|---|---|---|
| **Flightdeck hero** (homescreen) | "Fill tomorrow's capacity → Send VIP offer" | **The §8 recommendation card**: "Velnes found a member opportunity — Facial tomorrow 15:00 · Maria · rec. −35% · 8 suitable members · 60-min priority · [Approve] [Decline]". Approve = create the escalating offer; Decline = recorded outcome. VIP wording goes |
| **Marketing › Memberships tab** | Salon plans, MRR, member rows, `membershipNew/Edit` drawers | Becomes **Marketing › Velnes Premium**: member count block · **read-only rules card** (versioned, "accepted at registration" note, per §7/§29) · pending recommendations list (same Approve/Decline) · escalation status of live member offers · Product Testing block · outcomes summary |
| **Profile › Memberships tab** | Plan rows + usage | **Velnes Premium status**: Active/none, since, renews, the three benefits, this member's opportunity history (from `custActivity`) |
| **Profile identity badge** | `activePlan.name` (e.g. "Rehab monthly") | **"Velnes Premium"** accent badge when active |
| **Edit drawer › Group & membership section** | Read-only plan table + "membershipBenefit decides the price" note | Read-only Premium status ("managed by Velnes — the salon cannot grant or revoke it"), group select unchanged |
| **Till / pricing** | `membershipBenefit()` can make a service included or discounted; checkout consumes sessions | **Removed** (Decision A). Premium touches money at exactly one point: the loyalty earn line |
| **Loyalty earn (checkout)** | `earned = round(total × loyalty.points/earnPer)` | `× (isPremium(cust) ? HQ.premium.loyaltyMult : 1)` — one line, plus an honest "×1.5 Velnes Premium" note on the receipt/toast. The multiplier is read from config, never hard-coded (§20 of the brief) |
| **Customer list** | Group badge | + small Premium marker on member rows |
| **Customer Intelligence** | Suggestions, personal offers | Unchanged in V1; member badge visible; matching engine *reads* custStats (below) |
| **Offers (slot-based)** | Phase 1 = VIP group early access | Phase 1/2 = member escalation when created from a recommendation; the manual flightdeck flow keeps group targeting until you retire it (Decision E) |
| **test-screens / suites** | memberships tab enumerated; pos suite exercises membership pricing | Both updated in the same patches (standing pitfall) |

---

## Part III — Prototype domain model

### 1. Global config (the HQ shape, seeded read-only)

```js
const VELNES_HQ={premium:{
  enabled:true, loyaltyMult:1.5,
  rules:{version:'2026-08.1', acceptedAt:'2026-05-02',   // at owner registration
    maxDiscountPct:50, minLeadMin:120, priorityMin:60, escalationMin:30,
    publicFallback:true,
    eligibleServices:'all', excludedEmployees:[], eligibleLocations:'all'},
  audit:[{at:'2026-05-02',by:'HQ',field:'loyaltyMult',from:null,to:1.5}]
}};
```
Salon workspace renders this **read-only** (the brief is emphatic:
rules = Velnes; operation = owner Approve/Decline). The audit array
exists so the production shape (§20 Superadmin) is already drawn.

### 2. Member status (replaces `memberships[]` for premium purposes)

On the customer: `velnesPremium:{status:'active'|'expired'|'cancelled'|null,
since, renews}` + `isPremium(cid)` as the **eligibility door** — the
one function every other domain asks (§34 Q3). Seed: 2–3 members
(proposal: Marija active, Katerina active, one expired to show the
lifecycle honestly — Decision C).

### 3. Recommendations — `memberRecs[]`

```js
{id:'rec1', locationId, date, start, end, sid, empId,
 normalPrice, recPct, recPrice,                 // Velnes-recommended, within rules.maxDiscountPct
 candidates:[{cid, score, why:[...] }],          // ranked at creation
 status:'pending'|'approved'|'declined'|'expired',
 offerId:null,                                   // set on approve
 createdAt, decidedAt, decidedBy}
```
Generated by `memberRecScan()` — reuses the flightdeck's gap logic;
"at-risk" V1 = tomorrow's open slots on services/times that history
sells slowly (the CI aggregates give us sell-through by hour/weekday
across seeded history: transparent weighted rules, no AI, per §32).

### 4. Matching — `memberScore(cid, slot)`

Weighted, transparent, every weight in one `MATCH` constant
(TIMING/CI discipline):
service affinity (custStats.services) + employee affinity + daypart +
weekday + recency (cadence vs since-last) + reliability (noShows,
completed count) − fatigue (offers in `custActivity` last 14 days).
Returns `{score, why[]}` — the `why` renders on the recommendation
card ("frequently books facials · usually afternoons · booked Maria
before"), which is §10's suitability explanation, honest and testable.

### 5. Offer execution — reuse `offers[]` phases (the key decision)

On **Approve**:
```js
phases:[
 {ph1: audience:'SPECIFIC_CUSTOMERS', customerIds:[best], minutes:priorityMin},
 {ph2: audience:'SPECIFIC_CUSTOMERS', customerIds:[next N], minutes:escalationMin},
 {ph3: audience:'PUBLIC'}   // only when rules.publicFallback
]
```
`phaseAllows` already resolves all of this — **zero changes to the
booking gate**. Stage advancement: derived from phase times +
the demo "Advance stage" control (Decision B). "Booked ⇒ all
invitations invalid" is automatic: a booked slot leaves the capacity
snapshot, exactly how slot offers already behave.

### 6. Product Testing — `testOps[]`

```js
{id, product(pid or free text), sids:[...], qty, from, until, locationId,
 invited:[{cid, score, status:'invited'|'accepted'|'declined'|'expired'}],
 status:'open'|'filled'|'cancelled'|'done'}
```
Salon-created via a small GX drawer (this one **is** salon-configured,
per §29); Velnes matches via the same `memberScore` with a
product-affinity term (products bought — custStats has it); accept
decrements qty; last-slot race = whoever accepts first, the rest flip
to expired with an honest line. Events: `test_invited`, `test_accepted`,
`test_declined`, `test_completed` → `custActivity`.

### 7. Loyalty integration

One read (`isPremium`) × one config value (`HQ.premium.loyaltyMult`)
at the single existing earn line, plus receipt annotation. Points
stay owned by the loyalty object; premium owns only eligibility —
exactly the brief's separation (§27). Enabling/disabling the bonus =
`HQ.premium.enabled`, no code change.

### 8. Events (extending the reserved vocabulary)

`rec_created`, `rec_approved`, `rec_declined`, `member_offer_sent`,
`member_offer_expired`, `member_offer_escalated`,
`member_offer_accepted`, `public_fallback`, `test_*` — all through the
existing `activityLog`, all carrying score/intent/amount so §31's
learning questions become pure reads later.

### 9. What the prototype will NOT pretend
No subscription/payment flow (status is seeded state), no push/email,
no customer app (the §30 member area is out of scope; at most a small
"what Anna sees" preview card — Decision F), no editable HQ panel, no
real clock. Every one of these gets an honest label where the seam
shows.

---

## Part IV — Production architecture (the brief's §34, condensed)

The full .NET answer deserves its own document once the prototype
shapes are approved — the prototype *is* the spec draft. The
load-bearing answers now:

1. **Eligibility is a service with one question** (`IsPremium(customerId)
   → {active, until}`), cached with subscription-event invalidation;
   every other domain calls it, none stores it.
2. **Rules are versioned rows** (`PremiumRules(version, effectiveFrom,
   json)`); owner acceptance is a row (`ownerId, rulesVersion,
   acceptedAt`) written at registration; the salon panel renders the
   active version read-only. Changing rules = new version + re-display,
   never mutation.
3. **The offer lifecycle is a state machine** (draft→member_priority→
   escalated→public→booked|expired) driven by a scheduler; **race
   prevention is an atomic claim on the appointment row**
   (`UPDATE … WHERE status='open'` / rowversion) — the first booking
   wins, all open invitations flip in the same transaction.
4. **The multiplier is HQ config** with audit columns and
   `effectiveFrom`; loyalty reads it at award time; finalized
   transactions are never recalculated; cancellation reverses the
   awarded (multiplied) points by stored amount, not by re-derivation.
5. **Benefit abstraction**: last-minute and product testing share the
   Opportunity shape (opportunity→matching→invitation→outcome); the
   1.5× stays a lightweight cross-domain rule, NOT an Opportunity —
   forcing always-on eligibility into an invitation model would
   deform both (§34 Q5: my clear recommendation).
6. **Birthday benefits later** = one new opportunity type + one new
   matching term; nothing structural (the dormant `birthday` field we
   kept is the first ingredient).

**Ambiguities the brief itself must settle before production** (its
own closing question): who funds the discount (salon margin vs Velnes
subsidy); subscription price & billing provider; whether a declined
recommendation may resurface for the same slot; group size in stage 2;
whether product testing can be paid; SMS consent regime per market.

---

## Part V — Decisions I need, then the build plan

**A. Salon plans: hard sunset?** My proposal: yes — remove
`membershipPlans`/`membershipBenefit`/included-session consumption
entirely (with the pos/till tests rewritten same patch). Alternative:
freeze read-only for one release. Two live membership systems is the
one outcome I advise against.
**B. Time simulation:** "Advance stage" demo control on the
recommendation/offer card (honestly labelled), rather than wall-clock.
**C. Member seed:** Marija + Katerina active, Elena expired
(lifecycle demo). 
**D. Rules card values:** the numbers in §III.1 above (50% max, 120-min
lead, 60/30 windows, public fallback on) — confirm or adjust.
**E. VIP early access:** manual flightdeck offers keep the VIP-group
phase for now, or switch phase 1 to members everywhere immediately?
My proposal: switch everywhere — one story, and the VIP group keeps
its identity role only.
**F. Customer-side preview:** none in V1 (my proposal), or one small
read-only "what the member sees" card on the recommendation.
**G. Product testing depth:** full flow as §III.6, or defer to phase 2
and ship membership+last-minute first? My proposal: include it — it's
small (one drawer, one list, reuse of matching) and it's the benefit
that makes membership feel like more than discounts, which is the
brief's stated soul.

### Build order (after A–G)
1. Sunset old memberships (data, doors, till path, drawers, tabs,
   tests) — the destructive step first, in isolation, fully green
   before anything new.
2. `VELNES_HQ` + `velnesPremium` seed + `isPremium` + badges +
   profile/edit-drawer status surfaces.
3. Loyalty multiplier (one line + receipt note + tests).
4. `memberScore` + `MATCH` constants + tests against seeded history
   (exact-number assertions, CI-style).
5. `memberRecs` + scan + Marketing › Velnes Premium panel (rules card,
   recommendations, Approve/Decline) + flightdeck hero variant.
6. Approve→offer with member phases + escalation states + demo
   control + booking-invalidation test.
7. Product testing (drawer, matching, accept/race, events).
8. Activity events throughout + profile status tab.
9. Docs (VELNES-PREMIUM-DOCS.md), handover addendum, full regression.

**Estimated footprint:** ~700–900 lines net (after ~250 removed),
~80–100 new test checks, two screens changed, no new screens beyond
tab renames (registrations updated same-patch). md5 discipline
throughout, as always.
