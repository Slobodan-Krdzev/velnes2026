# Handover addendum — Personal Offers (18 aug 2026, sessie 3)

Supplement to HANDOVER-18aug.md and HANDOVER-CI-18aug.md. Implements
the approved v2 proposal (`velnes-personal-offers-proposal-v2.md`)
with Alex's decisions A (validity at creation, default 7 days, visible
to the client on the offer), B (high-value & birthday suggestions
removed — no custom messages anywhere), C (manual "Mark as redeemed"
in Marketing as the bridge until `priceFor()` redemption).

## md5 chain

| Step | md5 | Lines |
|---|---|---|
| Baseline (glow-up delivery) | `a57124cde9157a81bfd2ba809a90bc0b` | 19,343 |
| P1: slot-offer person-path reverted, `openOfferFor` deleted | `1e7760c5c14e49a1140b5e68b76ab3be` | 19,302 |
| P2: suggestion rules + action contract | `a2130d44912cacfa2b26a9cc7a9610a1` | 19,285 |
| P3: PersonalOffer domain + activity log | `ba57e88727ea1c242fbf5d598da4d25b` | 19,435 |
| P4: drawer, handlers, toolbar, tab, marketing, permissions | `1adc275759a82665807ca0436d78ad90` | 19,556 |
| perOfferSeq rename | `25e1c7ba720004331c898299b65e389b` | 19,556 |
| **DELIVERED** (Actions dropdown + variant parity) | **`70da8639abf596e901204ca472c77862`** | **19,579** |

## What changed

**Removed (per decision B and the simplification):** the entire
person-path on slot-based offers (saveOffer/phase1/pill/ident reverted
to original; `AUDIENCE_V1` back to `['PUBLIC','CUSTOMER_GROUP']`),
`openOfferFor` deleted, the `hivalue` and `birthday` suggestion rules
deleted. The birthday **field** on the edit drawer and the seeded
birthdays stay — dormant customer data for a future birthday-offer
intent. Trends are untouched.

**Suggestion contract:** `action:null|{kind:'personal_offer',label,
intent:'comeback'|'pattern'|'winback',params:{sid?}}`. Overdue now
carries the comeback action and a richer text (favorite service +
preferred window composed from the trends). `data-cioffer` value is
now `{cid}|{intent}|{sid}`.

**PersonalOffer domain** (`personalOffers[]`, seq `perOfferSeq` — NOT
`poSeq`, see pitfalls): customerId/location/sid/variantId/empId,
`normalPrice` snapshot (via `poNormalPrice` → svcVariants/service
price), **`specialPrice` owner-typed**, derived `discountPct`,
validFrom/validUntil (default +7d), prefWeekday/prefBand (hints,
normalised on save — a half-filled band is dropped),
status `live|cancelled|redeemed` with **`expired` derived at read**
(`poStatus`), provenance (relatedSuggestionId, intent). No public
field exists — customerId *is* the audience.

**Doors:** `personalOfferDraftFor(cid,intent,sid)` (prefill: last
location, favorite/lapsed service, **standard variant via
`svcChoice()`** — the same one-door the calendar, till and booking
flow use, so variants and location prices can never diverge from a
normal appointment; preferred employee ≥60%, weekday/band via shared
`ciPreferredWeekday`/`ciPreferredBand`/`ciLastLocation`;
**specialPrice always empty**),
`openPersonalOfferFor` (permission gate + blacklist block),
`savePersonalOffer` (no price → refuse; inactive service → refuse;
end-before-start → refuse), `poCancel`, `poRedeem` (live only),
`personalOffersFor` (reserved for the priceFor milestone).

**Activity log:** `custActivity[]` append-only, `activityLog()` sole
writer, `custActivityFor()` newest-first. V1 events: offer_created /
offer_cancelled / offer_redeemed, each with actor+intent+sid+amount —
the schema the future "5 received, 4 opened, 3 booked" measurement
reads. **Activity tab** on the profile (full tab set), registered in
`PROFILE_TABS` and in `test-screens` (now 518 checks, 75 screens).

**Drawer** `PANELS.personalOffer` (registered in the panel-name map):
Customer & reason (read-only insight) / Offer (service, variant,
optional employee, read-only normal price, empty special price with
live % hint, ≥normal warning, overlapping-duplicate warning) /
Validity & preference (dates, weekday, hour-band selects). Inputs via
`data-pof` (guarded parallel of `data-offf`).

**Entrances:** suggestion buttons, AI-panel "Recommended actions"
(unchanged rendering, new attribute format), and the toolbar
**Actions** dropdown (`ciActions`, addPop pattern, `state.actMenu`)
holding **Book appointment** and **Create personal offer** (manual,
intent `manual`). Without `marketing.personal_offers` the dropdown
collapses back to the plain Book appointment button — a one-row menu
is a riddle (same reasoning as addPop).

**Marketing › Offers** gains a Personal offers block: customer,
service+employee, struck normal → special price with −%, validity,
status badge, and (gated, live-only) **Mark as redeemed** + Cancel.

**Permission:** new group `Marketing` with one key
`marketing.personal_offers`. Owner (auto, business), Manager
(locations). Front desk/employee/bookkeeping: none. Gating is double:
buttons hide *and* `openPersonalOfferFor`/`poCancel`/`poRedeem`
refuse via `denied()`.

## Tests
`test-customerci.js` rewritten where affected: **152/152**. Covers
the normalised contract (incl. birthday/hivalue silence), full drawer
flow (prefill per intent, empty-price refusal, save, provenance,
7-day default = client-visible validUntil), winback prefill,
duplicate warning, manual toolbar flow, blacklist block, marketing
list + redeem/cancel + derived expiry, activity tab (4 rows, newest
first, actor/meta on every row), and permission hide+refuse for e4.
Full regression green: screens **518**, offers 50, flightdeck 28,
roles 15, rolekits 75, pos 112, timing 122, splitshift 74,
hours-toggle 29, headers 28, responsive 70, calendar 68, editor 53,
exceptions 83.

## Pitfalls (add to the standing list)
7. **`poSeq` is taken** — the suppliers module (purchase orders)
   declares `let poSeq=43`. Personal offers use `perOfferSeq`.
   Before introducing any new top-level identifier, grep it first;
   jsdom fails the whole page load on a duplicate `let`.
8. The Marketing personal-offers Cancel button after a redeem targets
   the *next* live row — in tests, re-query buttons after every
   status change instead of assuming row order.
9. `data-pof` selects are handled in the **change** listener (like
   `data-offf`) — tests must dispatch `change`, not `input`.
10. Variants carry `label`, not `name` — always resolve variant
   choice/price through `svcChoice(sv,loc,vid)`; hand-rolled variant
   lookups drift from booking behaviour (bit the first drawer
   version: base service price instead of the standard variant's).

## Open items (updated)
- **Next milestone:** kassa + widget through `priceFor()` — the offer
  row carries everything it needs (`personalOffersFor` is the entry);
  on integration, automatic redemption replaces the manual button
  (retain as admin override per decision C). Overlap rule: lowest
  specialPrice wins.
- Future notification service subscribes to `offer_created`, builds
  standardized copy from the offer row, i18n by customer app-account
  language, checks `poStatus` at send time, writes the reserved
  events (offer_notification_sent/delivered, offer_opened,
  offer_booked). Compliance/consent check lives there.
- Dormant: customer `birthday` field (future birthday-offer intent).
- Carried over: herkomstbesluit (no Netlify deploy), dead
  `customerEditBody` cleanup.
