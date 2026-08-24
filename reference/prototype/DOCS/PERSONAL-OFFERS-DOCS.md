# Personal Offers — Feature Documentation
**Velnes Business prototype · file version `70da8639abf596e901204ca472c77862` (19,579 lines) · 18 aug 2026**
**Companion to `CUSTOMER-INTELLIGENCE-DOCS.md` — read that first for the stats engine this feature is built on.**

This is the working document for maintaining and upgrading Personal
Offers. It covers the product rules, the domain model, every function
and DOM hook, the two entrances, the activity log, permissions, the
production path, and the recipes for likely changes.

---

## 0. The feature in one paragraph

Customer Intelligence detects an opportunity (overdue, booking
pattern, lapsed service) and recommends **one** action: create a
personal offer. The owner opens a drawer that Velnes has prefilled
with everything it knows — service, standard variant, employee,
location, preferred weekday and time band, a 7-day validity window —
**except the price**, which the owner must type. The saved offer is a
service-level promise to exactly one customer, listed under Marketing,
logged in the customer's Activity tab, and shaped so a future
notification system and the `priceFor()` redemption milestone plug in
without touching this feature.

```
custStats ─► custTrends ─► custSuggestions ─► action{personal_offer}
                                                    │
        toolbar "Actions ▾ → Create personal offer" ┤  (manual entrance)
                                                    ▼
                          personalOfferDraftFor(cid,intent,sid)
                                                    ▼
                              PANELS.personalOffer (GX drawer)
                                                    ▼
                                    savePersonalOffer()
                                     │                │
                          personalOffers[]      activityLog('offer_created')
                                     │                │
                     Marketing › Personal offers   Profile › Activity tab
                     (Cancel / Mark as redeemed)
```

---

## 1. Product rules (enforced structurally, not by policy)

1. **The owner prices; Velnes never discounts.** `specialPrice` starts
   empty in the draft and `savePersonalOffer()` refuses without it.
   There is no default, no suggestion, no percentage slider.
2. **One customer, forever.** `customerId` *is* the audience. There is
   no `publicOn` field, no group field, no phase model — an offer
   cannot become public because the shape cannot express it.
3. **No messaging.** The owner writes no copy anywhere. The future
   notification is standardized system communication built *from the
   offer row* by a delivery service that does not exist yet (§9).
4. **Preferences steer, never block.** `prefWeekday`/`prefBand` guide
   the prefill and future notification copy; they are not booking
   constraints.
5. **Validity is the client-visible promise.** Set at creation,
   default 7 days, owner-editable; `validUntil` travels on the offer
   and will be shown verbatim in the future customer app.
6. **A blocked customer gets no promise.** Blacklisted → creation
   refused with an honest toast (an unredeemable offer is a broken
   promise).
7. **Offers never compute their own numbers.** Prefill reads
   `custStats` through shared helpers; prices resolve through
   `svcChoice()` — the same doors as the rest of the app.

---

## 2. Where everything lives (search anchors)

| Piece | Search for |
|---|---|
| Domain array + seq | `const personalOffers=[];` (seq is `perOfferSeq` — **not** `poSeq`, that belongs to purchase orders) |
| Activity log | `const custActivity=[];` / `function activityLog(` |
| Shared prefill helpers | `function ciPreferredWeekday(` / `ciPreferredBand(` / `ciLastLocation(` |
| Price resolution | `function poNormalPrice(` |
| Status derivation | `function poStatus(` |
| Cancel / redeem | `function poCancel(` / `function poRedeem(` |
| Draft builder | `function personalOfferDraftFor(` |
| Gate + open | `function openPersonalOfferFor(` |
| Save | `function savePersonalOffer(` |
| Drawer sections | `function poSections(` |
| Panel registration | `personalOffer:()=>({title:'Personal offer'` |
| Panel name (headers test) | `personalOffer:'Customers / Personal offer'` |
| Input handling | `const pof=e.target.closest` (inside the **change** listener) |
| Actions dropdown | `function ciActions(` |
| Marketing block | `function mktPersonalOffers(` |
| Activity tab body | `activity:(()=>{` (inside `viewProfile` panels) |
| Suggestion actions | `action:{kind:'personal_offer'` (inside `custSuggestions`) |
| Click handlers | `if(d.cioffer)` / `if(d.ponew)` / `if(d.pocancel)` / `if(d.poredeem)` / `data-actmenu` |
| Permission key | `marketing.personal_offers` |
| Tests | `test-customerci.js` (162 checks; the PO blocks start at "Personal offer: de lade") |

---

## 3. The domain model — `personalOffers[]`

This shape **is** the future `POST/GET /customers/:id/personal-offers`
payload. Change it here and you change the API spec.

```js
{
  id:'po1',                       // 'po' + perOfferSeq
  customerId:'c4',
  businessId:'biz-velnes', locationId:'loc-centar',
  sid:'s2', variantId:'vtwo'|null, empId:'e1'|null,   // employee optional
  normalPrice:2400,               // SNAPSHOT at creation, via svcChoice (see §5)
  specialPrice:1800,              // owner-typed, integer MKD
  discountPct:25,                 // derived at save, display only
  validFrom:'2026-08-18',
  validUntil:'2026-08-25',        // client-visible promise (rule 5)
  prefWeekday:4|null,             // wdIdx convention: 0=Monday
  prefBand:{from:14,to:17}|null,  // normalised at save: half-filled → null
  status:'live'|'cancelled'|'redeemed',   // 'expired' is DERIVED, never stored
  createdAt, createdBy,
  relatedSuggestionId:'pattern'|null,     // provenance for measurement
  intent:'comeback'|'pattern'|'winback'|'manual'
}
```

**Invariants:**
- `status` never contains `'expired'`. `poStatus(po)` derives it
  (`validUntil < TODAY` on a non-terminal row). There is no cron in
  the prototype; production may materialise it nightly and then also
  write the reserved `offer_expired` event.
- `normalPrice` is a creation-time snapshot — catalog drift during
  validity does not move it (same snapshot philosophy as slot offers).
- `prefBand` is stored only when complete and ordered
  (`from!=null && to!=null && to>from`); the save normalises.
- Provenance (`relatedSuggestionId`, `intent`) is never blank-able by
  the UI — it's what future response-rate intelligence groups by.

---

## 4. The action contract (how suggestions trigger offers)

`custSuggestions(cid)` entries carry one optional action:

```js
action: null | {
  kind:'personal_offer',                    // the only kind in V1
  label:'Create personal offer',
  intent:'comeback'|'pattern'|'winback',    // selects the prefill flavour
  params:{sid?}                             // what the intent needs
}
```

V1 rule → action mapping:

| Suggestion id | Fires when | intent | params |
|---|---|---|---|
| `overdue` | steady cadence + overdueDays | `comeback` | — |
| `pattern` | weekday or daypart trend | `pattern` | — |
| `winback` | lapsedServices non-empty | `winback` | `{sid}` |

High-value and birthday rules were **removed** (their only sensible
action was a message, and messaging is out of scope by product
decision). The customer `birthday` field remains on the edit drawer as
dormant data for a possible future `birthday` offer intent.

**Adding a new intent** = one row in the table above (a new rule or a
new action on an existing rule) + a branch in
`personalOfferDraftFor`'s prefill if it prefills differently + one
firing test and one silence test. `kind` stays `'personal_offer'`
unless a genuinely different *surface* must open — that is the only
reason to ever grow the kind enum.

Buttons render in **two places from the same data** — the Suggestions
card and the AI panel's "Recommended actions" — as
`data-cioffer="{cid}|{intent}|{sid}"`, visible only with the
permission (§8).

---

## 5. Prefill — intelligence decides everything except money

`personalOfferDraftFor(cid, intent, sid)`:

| Draft field | Source |
|---|---|
| `locId` | `ciLastLocation(cid)` — last completed visit's location, fallback single/first location |
| `sid` | `sid` param (winback) else `custStats.favoriteService`, else '' |
| `variantId` | **`svcChoice(sv, locId, null).vid`** — the standard variant, exactly like a normal booking |
| `empId` | top employee only when ≥ `CI.MIN_EMP_PCT` (60%), else '' = "No preference" |
| `prefWeekday` | `ciPreferredWeekday(st)` — top weekday only when ≥ `CI.MIN_WD_PCT` (45%) |
| `prefBand` | `ciPreferredBand(st)` — best 3-hour band only when ≥ `CI.MIN_BAND_PCT` (50%) |
| `validFrom/Until` | today → today+7 (decision A: set at creation, owner edits) |
| `insight` | the triggering suggestion's text, or a stats one-liner for `manual`, or an honest "No booking history yet" |
| `specialPrice` | **`''` — always** |

**The variant rule (learned the hard way):** all variant and price
resolution goes through `svcChoice(sv, loc, vid)` — the same one-door
the calendar, till and booking flow use. Variants carry `label` (not
`name`); the standard variant is `std:true`; location price overrides
apply. `poNormalPrice(sid, vid, loc)` is a thin wrapper over
`svcChoice(...).price`. Never hand-roll a variant lookup here — the
first drawer version did, and priced variant services off the bare
service price. Switching service in the drawer re-selects **that**
service's standard variant.

Thresholds are the `CI` constants from the Customer Intelligence docs
— prefill and trends can never disagree because they read the same
gates.

---

## 6. UI surfaces

### 6.1 The two entrances
- **Suggestion / AI-panel buttons** (`data-cioffer`) → intent from the
  rule.
- **Toolbar Actions dropdown** (`ciActions(c)`, addPop pattern,
  `state.actMenu`): primary button "Actions ▾" with two menu rows —
  *Book appointment* (`data-panel="appointment"`, unchanged flow) and
  *Create personal offer* (`data-ponew="{cid}"`, intent `manual`).
  **Without `marketing.personal_offers` the dropdown collapses to the
  plain Book appointment button** — a one-row menu is a riddle (same
  reasoning the codebase applies at `addPop`).

Both entrances funnel into `openPersonalOfferFor(cid,intent,sid)`,
which gates (permission → `denied()`, blacklist → toast) and opens
the drawer with `state.edOpen={offer:true}`.

### 6.2 The drawer — `PANELS.personalOffer` → `poSections()`
Three GX sections:

1. **Customer & reason** — read-only `insight` note. Pill: customer
   name.
2. **Offer** (open by default) — Service select (active services) ·
   Variant select (real labels, "· standard" marker, location prices;
   disabled "No variants" input otherwise) · Employee select
   ("No preference" default) · Normal price (read-only) ·
   **Special price** (number, empty, required; live "Discount: N%"
   hint once typed). Inline warnings: special ≥ normal (warm card,
   non-blocking) and overlapping live duplicate on the same
   customer+service (warm card, non-blocking — a deliberately sweeter
   deal is allowed). Pill: `{service} · {special}` or "Pick a
   service", warn-toned until both exist.
3. **Validity & preference** — date inputs (from/until) · weekday
   select ("No preference" + 7 days) · time band as two hour selects
   (06:00–21:00, "—" = none).

Inputs use `data-pof="{field}"`, handled in the **change** listener
(parallel to `data-offf`, guarded by `state.poDraft`). Special cases
in the handler: `sid` change re-resolves the standard variant;
`bandFrom`/`bandTo` build `prefBand` incrementally (save normalises).

Save (`savePersonalOffer`) refuses, in order: no/inactive service, no
positive special price ("pricing is your decision"), end-before-start
validity. On success: push + `offer_created` event + toast + close.

### 6.3 Marketing › Offers › Personal offers (`mktPersonalOffers`)
Appended below the last-minute offers list. Per row: customer ·
service (+employee subline) · struck normal → **special** with −% ·
validity range · status badge (live=success, redeemed=accent,
cancelled=danger, expired=plain) · on **live** rows only and only with
the permission: **Mark as redeemed** (`data-poredeem`) and **Cancel**
(`data-pocancel`).

"Mark as redeemed" is decision C: the manual bridge that produces
redemption data before the `priceFor()` milestone. When automatic
redemption lands, this button becomes an administrative override (or
is removed).

### 6.4 Profile › Activity tab
`PROFILE_TABS` entry `['activity','Activity']` (full tab set only) +
registered in `test-screens` (screen #75, "Customers / Profile /
Activity"). Renders `custActivityFor(cid)`: timestamp · event label
with intent+service subline · reference id · amount. Empty state:
"No activity yet."

---

## 7. The activity log — `custActivity[]`

Append-only; `activityLog(cid, type, refType, refId, meta)` is the
**only writer**; `custActivityFor(cid)` reads newest-first.

```js
{id:'act1', customerId, ts:'2026-08-18 15:42', actor:'e1',
 type:'offer_created', refType:'offer', refId:'po1',
 meta:{intent:'pattern', sid:'s2', amount:1800}}
```

| Event | Written by | When |
|---|---|---|
| `offer_created` | `savePersonalOffer` | V1 |
| `offer_cancelled` | `poCancel` | V1 |
| `offer_redeemed` | `poRedeem` (manual button) | V1 |
| `offer_expired` | *(reserved — nightly job, production)* | future |
| `offer_notification_sent / delivered` | *(reserved — delivery service)* | future |
| `offer_opened`, `offer_booked` | *(reserved — customer app)* | future |
| `appointment_completed` | *(reserved)* | future |

`actor`/`intent`/`sid`/`amount` on every row from day one is what
makes the future measurement ("received 5, opened 4, booked 3 →
responds well to offers") a pure read: when the reserved events flow,
`custStats` gains a `response` block — same door, one more field —
and suggestions can start using outcomes. **Deliberately separate
from appointment history**: appointments are operational truth;
activity is the engagement narrative about the relationship.

---

## 8. Permissions

One key, one group:

```
Marketing › marketing.personal_offers — "Create personal offers with special pricing"
```

| Role | Scope |
|---|---|
| Owner | business (automatic — owner derives max scope of every key) |
| Manager | locations |
| Front desk / Employee / Bookkeeping | none |

Gating is **double** everywhere: buttons hide (Actions dropdown
collapses, suggestion/AI buttons vanish, Marketing row actions vanish)
*and* the doors refuse (`openPersonalOfferFor`, `poCancel`, `poRedeem`
→ `denied()`). Viewing insights remains `customers.view_business` —
seeing and acting are now separate rights. Deliberately **not**
reusing `pos.discount`: a till-moment discount ≠ a standing special
price.

---

## 9. Production path (.NET / MSSQL)

**API (mirrors the doors one-to-one):**
```
GET  /api/customers/{id}/personal-offers          → personalOffersFor
POST /api/customers/{id}/personal-offers          → savePersonalOffer
POST /api/personal-offers/{id}/cancel             → poCancel
POST /api/personal-offers/{id}/redeem             → poRedeem (until till integration)
GET  /api/personal-offers?status=live             → Marketing list
GET  /api/customers/{id}/activity?page=n          → custActivityFor (page like history)
```
Tables: `PersonalOffers` (normalPrice as snapshot column, not a
join), `CustomerActivity` (append-only, clustered customerId+ts).
Server derives `expired` exactly like `poStatus`, or materialises it
nightly + event.

**Future notification service** (does not touch this feature):
subscribes to `offer_created` → builds **standardized** copy from the
offer row itself (service, both prices, validUntil) → i18n by the
customer's app-account language (fallback: location default → mk) →
checks `poStatus` at send time (a cancelled offer is never announced)
→ enforces communication eligibility/consent → delivers → writes the
reserved events. The owner never writes copy; the email/push only
points at the server-side offer ("View Offer" → the future customer
app's *Offers for You*, which reads `PersonalOffers` by customerId).

**The `priceFor()` milestone** (the standing open item): extend the
pricing door with an optional `custId`; when given, check
`personalOffersFor(custId)` for a live offer matching sid(+variant)
with `validFrom ≤ date ≤ validUntil` → return `specialPrice`, flagged
as a personal-offer price. Till and widget both call the one door, so
redemption lights up in both at once. On checkout at that price:
status → `redeemed` + event automatically; the manual Marketing
button becomes an admin override. **Overlap rule: lowest specialPrice
wins**; the others stay live until expiry. Preferences remain hints —
the offer is valid any day inside the window.

---

## 10. Demo data & exact test numbers

No offers are seeded — the feature starts empty by design (the empty
state teaches the flow). The suggestions that produce offer buttons
come from the seeded Customer Intelligence history:

| Persona | Suggestions → intents | Prefill the tests assert |
|---|---|---|
| Marija c4 | `pattern`, `winback(s5)` | s2 + variant **vtwo** (std) + e1 + loc-centar + Friday + 14–17 + today→+7 |
| Katerina c1 | `overdue → comeback` | s4, no weekday/band claims |
| Ivana c2 / Elena c6 | none | manual flow works; prefill degrades honestly |

Known-good numbers used in assertions: s2 normal 2400 (=vtwo), special
1800 → 25%; `poNormalPrice('s2','vfull','loc-centar')` = 3300;
s8's standard variant is v45.

---

## 11. State, handlers, DOM hooks

| State | Meaning | Reset |
|---|---|---|
| `poDraft` | the open drawer's draft | null on save/close/blocked open |
| `actMenu` | Actions dropdown open | outside click, choosing an entry, `data-panel` open |

| Attribute | On | Does |
|---|---|---|
| `data-cioffer="{cid}\|{intent}\|{sid}"` | suggestion + AI buttons | `openPersonalOfferFor` |
| `data-actmenu` | toolbar Actions | toggle dropdown |
| `data-ponew="{cid}"` | dropdown row | manual open (closes menu) |
| `data-pof="{field}"` | drawer inputs | draft field (**change** listener) |
| `data-pocancel` / `data-poredeem` | Marketing rows | cancel / redeem |
| `data-porow`, `data-ciactrow` | markers | tests/styling only |

All click attributes are registered in the delegated-click selector
string — **a new `data-…` button must be added there or clicks
silently do nothing** (standing rule from the CI docs).

---

## 12. Recipes for likely upgrades

- **New offer intent** → §4 procedure. If it needs a different
  validity default, branch in `personalOfferDraftFor` (that's where
  decision-A logic would live if 7-days-flat ever changes).
- **Change default validity** → the `addDays(TODAY,7)` in
  `personalOfferDraftFor`, one test constant.
- **Automatic redemption** → §9 `priceFor()` sketch; then demote
  `poRedeem`'s button to an admin override (or delete it + its two
  tests).
- **Notification integration** → build the external service against
  §9; in this file only the reserved event names start being written
  by it — nothing else changes.
- **Response-aware suggestions** → once reserved events flow, add a
  `response` block to `custStats` (that *is* an API change — update
  the insights contract in the CI docs) and read it in
  `custSuggestions`.
- **New offer field** (e.g. a note) → model (§3) + drawer section +
  save + one test; if the future app should show it, flag it in the
  API sketch as client-visible.
- **New Marketing filter** (e.g. status filter on the list) → filter
  inside `mktPersonalOffers`; the single-dimension filter decision
  applies to the toolbar pill, not to in-block controls.

## 13. Pitfalls specific to this feature (from the handover)

1. **`poSeq` is taken** by purchase orders — this feature uses
   `perOfferSeq`. Grep before declaring any top-level identifier;
   jsdom fails the whole page on a duplicate `let`.
2. **Variants: `label`, not `name`; always `svcChoice`.** Hand-rolled
   lookups drift from booking behaviour.
3. **`data-pof` fires on `change`**, not `input` — tests must
   dispatch the right event.
4. In tests, **re-query Marketing row buttons after every status
   change** — cancel after redeem targets the next live row.
5. `'expired'` must never be written into `status` — everything that
   reads status must go through `poStatus()`.

## 14. Working discipline (unchanged)

md5sum + `wc -l` before every patch and after every delivery;
scripted uniqueness-asserted replacements; suites run with cwd
`/home/claude/velnes`; `test-customerci.js` (162) + full regression
before handover. Current chain: `HANDOVER-PO-18aug.md`. Superseded
proposals: `velnes-customer-actions-proposal.md` (v1, messaging —
rejected), `velnes-personal-offers-proposal-v2.md` (approved,
implemented with decisions A/B/C).
