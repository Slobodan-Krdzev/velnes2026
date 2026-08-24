# Customer Intelligence → Personal Offers — REVISED architecture (v2)
**Supersedes `velnes-customer-actions-proposal.md` · 18 aug 2026**
**Verdict: ready to implement after sign-off on 3 micro-decisions (§16).**
Base file: `a57124cde9157a81bfd2ba809a90bc0b` (19,343 lines).

Your simplification is the right call, and it makes the architecture
*better*, not just smaller: with messaging gone, the content-vs-
delivery problem disappears from V1 entirely — the offer row itself
becomes the only integration surface a future notification system
needs. Review of each decision, then the 16 answers.

---

## 1. What is removed from the previous proposal (§15.1)

Gone completely: `CustomerMessage` model + doors + statuses,
`PANELS.contactCustomer`, all templates (`msgTemplate`), the Contact
Customer toolbar button, `customers.message` permission, the
`marketingConsent` field, the language decision, the front-desk
decision, the `offer_message` kind, the Notify section on the offer
drawer, the message-related activity events, and both message API
endpoints. Nothing of it leaves a stub behind — the future
notification system hooks into the *offer event*, not into a dormant
message model (§12 below).

One consequence worth naming honestly: overdue, high-value and
birthday suggestions lose their would-have-been message buttons.
Overdue gets a **Create Personal Offer** button instead (that *is*
the comeback play now). High-value and birthday stay text-only in V1
— see micro-decision B.

## 2. Is `actions[]` still necessary? (§15.2)

**No — reverted.** With one action kind, an array is abstraction for
a hypothetical. The contract goes back to a single optional field,
keeping the two-part idea that made the array clean:

```js
action: null | {
  kind:'personal_offer',        // the only kind in V1
  label:'Create personal offer',
  intent:'comeback'|'pattern'|'winback',   // selects the prefill
  params:{sid?}                  // what the intent needs
}
```

`kind` stays a field (not implied) so a second kind later is additive,
not a migration. The shipped code's `kind:'offer'|'winback'` is
normalised to `kind:'personal_offer'` + `intent` — the existing
`data-cioffer="{cid}|{intent}|{sid}"` attribute and handler survive
with a rename of meaning only.

## 3. Final `PersonalOffer` model (§15.3)

```js
{
  id:'po1',
  customerId, businessId, locationId,
  sid, variantId:null, empId:null,          // employee optional
  normalPrice,                               // snapshot at creation (catalog may drift)
  specialPrice,                              // OWNER-TYPED, required, no default
  discountPct,                               // derived at save, display only
  validFrom, validUntil,                     // ISO dates
  prefWeekday:null|0..6,                     // wdIdx convention (0=Monday)
  prefBand:null|{from,to},                   // informational, never enforced (§14)
  status:'live'|'cancelled'|'redeemed',      // 'expired' is DERIVED at read
  createdAt, createdBy,
  relatedSuggestionId:null, intent:null      // provenance for future measurement
}
```

Stored as `personalOffers[]` + `poSeq`, one door family:
`personalOfferDraftFor(cid,intent,sid)`, `savePersonalOffer()`,
`personalOffersFor(cid)`, `poStatus(po)` (derives expired),
`poCancel(id)`, `poRedeem(id)`. Last-minute slot offers (`offers[]`)
untouched. Audience is implicit — `customerId` *is* the audience; no
`publicOn` field exists, so "never becomes public" is structural.

## 4. Final drawer — `PANELS.personalOffer` (§15.4)

GX drawer, three sections + save:

1. **Customer & reason** — read-only: name, and the Velnes insight
   line (the suggestion's `text`+`why` when launched from one;
   a stats summary line when manual: "98 visits · usually every
   2 weeks · favorite: Manual therapy, spine").
2. **Offer** — Service (select), Variant (when the service has them),
   Employee (optional, "No preference" default), Normal price
   (read-only, resolved through the pricing door for the chosen
   location/variant), **Special price (empty, required)**, derived
   % rendered live beside it. Warn ≥ normal, block ≤ 0.
3. **Validity & preference** — Valid from (today) / until, preferred
   weekday + time-band chips, all prefilled, all clearable.

Save = **Create Personal Offer** → validate → push → `offer_created`
activity event → toast → drawer closes to the profile. No message
editor, no channel UI, no language UI — nothing to remove later.

## 5. How suggestions trigger offers (§15.5)

Rule → action mapping (V1):

| Suggestion | action |
|---|---|
| overdue | personal_offer · intent `comeback` |
| pattern (weekday/daypart) | personal_offer · intent `pattern` |
| winback (lapsed) | personal_offer · intent `winback` · params `{sid}` |
| high-value | none (text) — decision B |
| birthday | none (text) — decision B |

The suggestion card and the AI panel's "Recommended actions" both read
the same field, as today — zero extra wiring. Suggestion texts get the
brief's richer form ("…and is currently 17 days overdue. Favorite
service: X. Preferred time: Friday afternoon.") by composing from the
already-computed trends — no new rules needed.

## 6. Intelligence prefill (§15.6)

The stat-reading logic currently inside `openOfferFor` is extracted
into shared helpers used by both offer flows:
`ciPreferredWeekday(st)`, `ciPreferredBand(st)`, `ciLastLocation(cid)`.

`personalOfferDraftFor(cid,intent,sid)` prefills:
- location ← last visit's; service ← `sid` (winback) or
  favoriteService; variant ← the service's standard;
- employee ← top employee **only when** the ≥`MIN_EMP_PCT` rule fires,
  else "No preference";
- prefWeekday / prefBand ← the trend rules (only when they fire —
  never guessed);
- validFrom ← today; validUntil ← intent-dependent (decision A);
- normalPrice ← pricing door; **specialPrice ← empty, always** —
  prefill decides everything except money, structurally.

## 7. Manual creation (§15.7)

Toolbar button **Create Personal Offer** on the profile (next to Edit
details), permission-gated, present regardless of suggestions. Opens
the same drawer via `personalOfferDraftFor(cid,'manual')` — identical
prefill minus the suggestion line. One drawer, two entrances, no
duplicated logic.

## 8. Activity model — offer-focused (§15.8)

As proposed, pruned to offers:

```js
custActivity[] : {id, customerId, ts, actor:'e1'|'system'|'customer',
                  type, refType:'offer', refId, meta:{intent?, sid?, amount?}}
activityLog(...)          // the only writer
custActivityFor(cid)      // newest first
```

**V1 writers:** `offer_created`, `offer_cancelled`, `offer_redeemed`
(see decision C). **Displayed but derived, not stored:** expired
(computed from `validUntil` — no cron in the prototype; production may
materialise it nightly and then write `offer_expired`).
**Reserved, schema-ready, no writers:** `offer_notification_sent /
delivered`, `offer_opened`, `offer_booked`, `appointment_completed`.

`actor` + `intent` + `sid` on every event from day one is what makes
your §10 future ("received 5, opened 4, booked 3 → responds well to
offers") a pure read later: when those events exist, `custStats` gains
a `response` block and suggestions can start using it — same door, one
more field.

**UI:** Activity tab on the profile (full-permission), registered in
`PROFILE_TABS` **and** `test-screens` in the same patch (the standing
pitfall). Appointment history untouched.

## 9. Permissions (§15.9)

Exactly one new key, in one new group:

```js
['Marketing',[
  ['marketing.personal_offers','Create personal offers with special pricing'],
]]
```

- View insights: unchanged (`customers.view_business`).
- Create/cancel/redeem personal offers: `marketing.personal_offers`.
  Role kits: owner + manager yes; front desk, employee, bookkeeping
  no (bookkeeping keeps read via reports/marketing list).
- Buttons hide without it; the drawer also refuses via `denied()`
  (screen hides, gate decides).
- `customers.message` is not created. Deliberately *not* reusing
  `pos.discount` (a till-moment discount ≠ a standing special price).

## 10. Marketing screen (§15.10)

A **Personal offers** block on the Marketing screen: customer ·
service · normal→special price · validity · status badge
(live/expired/cancelled/redeemed) · row actions Cancel and
Mark as redeemed (decision C). Last-minute offers list unchanged.

## 11. Backend/API (§15.11)

```
GET  /api/customers/{id}/personal-offers
POST /api/customers/{id}/personal-offers        → savePersonalOffer
POST /api/personal-offers/{id}/cancel
POST /api/personal-offers/{id}/redeem           (until till integration replaces it)
GET  /api/customers/{id}/activity?page=n        → custActivityFor, paged like history
GET  /api/personal-offers?status=live           (Marketing list)
```

All message endpoints from v1 of the proposal: dropped. MSSQL:
`PersonalOffers`, `CustomerActivity` (append-only, clustered
customerId+ts). Prices in minor units per existing conventions;
`normalPrice` snapshot column, not a join.

## 12. Future notification plug-in (§15.12)

The integration surface is **the event, not a message row**:

```
savePersonalOffer → activity: offer_created
                        │  (future) notification service subscribes
                        ▼
        builds STANDARDIZED copy from the PersonalOffer row itself
        (service, prices, validUntil) + customer language (§13)
                        ▼
        Email / Velnes app notification → writes
        offer_notification_sent / delivered / offer_opened events
```

Customer Intelligence and the drawer change by zero lines when this
arrives. The owner never writes copy — exactly your §6. The "View
Offer" target is the server-side `PersonalOffer` read by the future
customer app's "Offers for You" (§12 of your brief) — the offer is
never serialized into the notification.

## 13. Language / i18n (§15.13)

Owned entirely by the future notification service: templates keyed by
`customer.language`, a field that will live on the customer's *app
account* (it doesn't exist yet because the account doesn't). Fallback
chain `customer.language → location default → mk`. Nothing in CI, no
owner-facing language UI anywhere — your §7, adopted as stated.

## 14. Future redemption via `priceFor()` (§15.14)

This slots into the standing open item ("kassa + widget through
priceFor()") cleanly because the offer row already carries everything
the pricing door needs:

```
priceFor(locId, sid, variantId, date, custId?) →
  when custId given: check personalOffersFor(custId) for a LIVE offer
  matching sid(+variant) with validFrom ≤ date ≤ validUntil
  → return specialPrice (flagged as personal-offer price)
```

Till and widget both call the one door, so redemption lights up in
both at once. On checkout of such a price: status → `redeemed` +
`offer_redeemed` event (replacing the manual button of decision C).
`prefWeekday`/`prefBand` are **hints, never constraints** — the offer
is valid any day inside the window; the preference only steered the
prefill and the future notification copy. Overlap rule when two live
offers match: the lowest specialPrice wins, others stay live until
expiry (documented for the .NET team).

## 15. Edge cases (§15.15) — pruned and updated

1. **Blacklisted customer** → offer creation blocked with an honest
   line ("booking is blocked — unblock first"); a promise they cannot
   redeem is a broken promise.
2. **Duplicate live offer**, same customer+service, overlapping
   validity → warn in drawer, allow deliberate override.
3. **Special price ≥ normal** → warn (surcharge is odd but legal);
   **≤ 0** → block.
4. **Catalog price drift** during validity → `normalPrice` is a
   snapshot; drawer/list show both when they diverge.
5. **Expiry without a clock** → derived status (`poStatus`), stored
   status only for explicit acts.
6. **No-history customer** → manual flow fully works; prefill
   degrades to location = single/first location, no
   weekday/band/employee, service unselected.
7. **Service or employee deactivated** mid-validity → offer stays
   valid; drawer refuses *creating* new offers on inactive services.
8. **Customer books normally** during offer validity → offer simply
   stays live until expiry (no auto-cancel in V1; the future booking
   integration decides).
9. **Consent** → per your §8: no consent system in V1; the future
   delivery service enforces communication eligibility before
   sending. Noted as a compliance checkpoint for the notification
   milestone (the *offer* itself is not a communication).
10. **Cancelled offer with a queued future notification** →
    non-issue in V1 (no notifications); the future service must check
    `poStatus` at send time — one line in its spec.

## 16. The three micro-decisions, then build (§15.16 / verdict)

Everything above is fully specified. Sign off on:

**A. Comeback validity default.** I propose: `validUntil = today +
max(7, medianGapDays)` for intent `comeback` (an overdue customer
gets a window long enough to land inside their own rhythm); flat
7 days for `pattern`, `winback`, `manual`. Alternative: flat 7 for
all.

**B. High-value & birthday.** I propose both stay **text-only** in
V1: discounting your best spender is commercially backwards, and a
birthday *offer* (vs. the removed birthday *message*) is a real
product idea but a new intent — cheap to add later
(`intent:'birthday'`, one template-less prefill), noisy to decide
now.

**C. Manual "Mark as redeemed".** Your §10 lists `offer_redeemed` in
V1 while §14-OUT excludes till integration. I propose the bridge: a
manual **Mark as redeemed** row action on the Marketing list (owner
applied the price at the till by hand, then records it). It's the
only way the redemption events — and your "booked 3 of 5" future —
have data before the `priceFor()` milestone. Alternative: drop
`offer_redeemed` from V1 entirely.

### V1 implementation plan (after A–C)

1. Action contract normalisation (`kind:'personal_offer'` + intent) +
   handler rename — existing tests updated same patch.
2. Shared prefill helpers extracted from `openOfferFor` (regression:
   flightdeck + offers suites).
3. `personalOffers` model + doors + `poStatus` derivation.
4. Drawer + save + validation + both entrances (suggestion + toolbar).
5. Marketing "Personal offers" block + cancel/redeem actions.
6. `custActivity` + doors + Activity tab (+ `PROFILE_TABS` +
   `test-screens` registrations).
7. Permission group/key + role kits + gating (hide **and** deny).
8. Tests: ~55–65 new checks (contract normalisation; prefill per
   intent incl. degradation for c6; empty-price rule — save blocked
   until typed; validity validation; duplicate warn; blacklist block;
   status derivation incl. expired; cancel/redeem events; activity
   ordering + tab; permission hide + bounce for e4; Marketing list;
   AI panel still shows the offer actions). Full regression after.
9. md5 discipline throughout; handover addendum + docs update
   (CUSTOMER-INTELLIGENCE-DOCS.md gains a Personal Offers chapter,
   the v1 proposal is marked superseded).

**Estimated footprint:** ~450–550 lines in `index.html`, one new test
file section, no changes to `custStats`, no changes to last-minute
offers, no new screens (one new tab, two registrations).
