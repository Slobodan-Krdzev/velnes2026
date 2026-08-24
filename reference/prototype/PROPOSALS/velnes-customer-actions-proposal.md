# Customer Intelligence → Customer Actions, Messaging & Personal Offers
**Architecture & product proposal · for approval · 18 aug 2026**
**Nothing in this document is built. Approval gates implementation.**
Base file: `a57124cde9157a81bfd2ba809a90bc0b` (19,343 lines).

The chain the brief asks for — Understand → Suggest → Create Action →
Send → Measure — maps onto what exists like this: Understand and
Suggest are done (`custStats` → `custTrends`/`custSuggestions`);
Create Action is half-done (the offer bridge exists, messaging does
not); Send and Measure do not exist and, per the brief, V1 builds
their *shape*, not their delivery.

---

## 0. What the inspection found (§20.1)

Facts that shape every decision below:

1. **The suggestion action model is single-action.**
   `custSuggestions()` returns `action:null|{kind:'offer'|'winback',
   label,sid}` — one button per suggestion. The brief's §14 needs
   *two* buttons on the overdue card, so this is the first thing to
   change.
2. **The current personal offer is slot-based.** `openOfferFor()`
   reuses the flightdeck machinery: a snapshot of *today's actual
   calendar gaps* on one date, percentage discount, phase model.
   The brief's §8 offer (a service at an absolute special price,
   valid 18–25 Aug, preferred Friday 14:00–17:00) is a **different
   commercial object**: multi-day, service-level, owner-priced. The
   slot machinery cannot express it without breaking its own core
   idea ("the gaps of today are not gaps tomorrow — an offer is a
   snapshot"). Consequence in §5 below.
3. **There is no message, notification, or activity concept anywhere**
   in the file. Greenfield — good: we get to draw the
   content-vs-delivery line correctly from day one.
4. **Permissions have no engagement keys.** The permission groups are
   Appointments / Customers / Till / Catalog / Reports /
   Administration. Marketing as a nav item is gated by
   `customers.view_business` — i.e. today, *seeing* business data and
   *acting commercially* are the same right. The brief correctly
   questions that (§15).
5. **Customers carry no marketing consent and no channel data
   beyond email/phone.** The "Consent · Given" stat on the profile is
   treatment/intake consent, hardcoded. Sending marketing email to a
   customer is a different legal act — this is the biggest edge case
   the brief missed (§18 below).
6. **Profile tabs are address-bearing.** `state.profileTab` is part of
   the hash (`#customers/c4/appointments`) and `test-screens`
   enumerates profile screens — a new Activity tab must be registered
   there in the same patch (the documented phantom-screen pitfall).
7. **Booking-gate enforcement of a service-level personal price is the
   existing open item** "kassa + widget through `priceFor()`". This
   proposal deliberately does not smuggle that in; see §5.4.

---

## 1. The extended action contract (§20.2–3)

### From `action` to `actions[]`

`custSuggestions()` entries change from a single optional `action` to
an array (empty = text-only suggestion):

```js
{
  id:'overdue', text:'…', why:'…',
  actions:[
    {kind:'message', label:'Create message',        intent:'comeback'},
    {kind:'offer',   label:'Create personal offer', intent:'comeback'}
  ]
}
```

### The contract — two fields do all the work

```js
action = {
  kind,     // WHICH SURFACE OPENS — the only dispatch enum
  label,    // button text
  intent,   // WHY — which template/prefill logic runs
  params    // optional data the intent needs, e.g. {sid:'s5'}
}
```

- **`kind`** stays tiny by design: `'message' | 'offer' |
  'offer_message'`. It answers one question — which drawer opens.
  Adding an action *type* means adding a dispatch branch, so this
  enum must stay small.
- **`intent`** is open vocabulary, not an enum: `'comeback'`,
  `'winback'`, `'thankyou'`, `'birthday'`, `'pattern'`, later
  anything. It selects the message template and the offer prefill.
  Adding an intent means adding a template — no dispatch change.

This is how we avoid the brief's over-engineering worry: the
`message / personal_offer / winback_offer / thank_you /
birthday_message / reminder` list collapses into 3 kinds × N intents.
A `winback_offer` is `kind:'offer', intent:'winback',
params:{sid}`. A `birthday_message` is `kind:'message',
intent:'birthday'`.

### Rule migration (V1 set)

| Suggestion | actions[] |
|---|---|
| overdue | message(comeback) + offer(comeback) |
| pattern (weekday/daypart) | offer(pattern) — optionally offer_message |
| winback (lapsed service) | offer(winback,{sid}) + message(winback,{sid}) |
| high-value | message(thankyou) |
| birthday | message(birthday) |

Note the product upgrade hidden here: overdue, high-value and birthday
were text-only ("no button without a real action behind it"). A
*message draft* is now a real action — the rule is honored, the
buttons appear.

One handler change: `data-cioffer` is generalised to
`data-ciact="{cid}|{kind}|{intent}|{sid?}"` dispatching to
`openOfferFor` / `openContactFor` / both. The AI panel's "Recommended
actions" inherits all of this for free (same source, §5 of the
existing docs).

---

## 2. CustomerMessage — the communication object (§20.4, 12, 15–16 of brief)

### Model (prototype array `customerMessages[]`, production table)

```js
{
  id:'msg1',
  customerId:'c4',
  businessId:'biz-velnes', locationId:'loc-centar',   // sender identity
  createdBy:'e1',
  channel:'EMAIL'|'VELNES_NOTIFICATION',
  subject:'…',        // EMAIL only
  title:'…',          // VELNES_NOTIFICATION only
  body:'…',
  status:'DRAFT'|'QUEUED'|'SENT'|'FAILED'|'CANCELLED',
  createdAt, queuedAt, sentAt:null, failedAt:null, error:null,
  relatedOfferId:null,        // link to a personal offer
  relatedSuggestionId:null,   // 'overdue' | 'winback-s5' | null (manual)
  intent:'comeback'|…|null
}
```

### The content/delivery line

`Customer Intelligence` writes messages up to **QUEUED** and never
further. A future `EmailDeliveryAdapter` / notification service is the
only thing that moves QUEUED → SENT/FAILED (with retries, timestamps,
errors — all fields already present). In the prototype, "Send" sets
QUEUED and the UI says so honestly, flightdeck-style:
*"Queued — delivery arrives with the SMTP / customer-app services."*
Nothing pretends to have been sent. When adapters exist, CI code does
not change; the adapter changes QUEUED rows.

One door family: `msgCreate(draft)`, `msgQueue(id)`, `msgCancel(id)`,
`msgFor(cid)`. Screens never touch the array.

### Templates (§20.12)

`msgTemplate(intent, cid, channel)` → `{subject, title, body}` —
deterministic, composed from `custStats` (same discipline as
`aiAnalysis`, and the future AI-copy seam is identical: swap the
inside, keep the signature). V1 set:

- **comeback** — "Hi {first}, it's been a little while since your
  last visit — you usually see us about every {N} weeks. We'd love to
  welcome you back."
- **winback** — names the lapsed service.
- **thankyou** — no numbers in the customer-facing text (we don't
  tell a customer we track their spend); warm and specific.
- **birthday** — greeting + soft invitation.
- **offer_notify** — "You have a personal offer waiting: {service} at
  {price}, valid until {date}." Points *at* the offer; never contains
  the offer as the only record of it (brief §10).

Every template is fully editable before queueing. **No automatic
sending exists anywhere in V1** (product rule 1).

---

## 3. Contact Customer — the manual flow (§20.10)

New toolbar button on the profile (next to Edit details), independent
of any suggestion. Opens `PANELS.contactCustomer` — a GX drawer, same
pattern as every other drawer:

- **Channel** section: Email / Velnes notification toggle. Email
  disabled with a hint when the customer has no email address. A
  quiet line notes the delivery honesty ("messages queue until the
  delivery services exist").
- **Message** section: Subject+Body (email) or Title+Body
  (notification). When opened from a suggestion (`data-ciact`), the
  template is prefilled and an ident line says why ("From suggestion:
  usually returns every 5 weeks, now 17 days overdue"). Opened
  manually, fields start empty with a template picker
  (Comeback / Thank you / Birthday / Blank).
- **Save** = "Queue message" → `msgCreate` + `msgQueue` + activity
  event + toast. Draft-saving (close without queueing) keeps status
  DRAFT.

---

## 4. Personal Offer — the commercial object (§20.5–6)

### 4.1 The honest architectural decision

**Two offer objects, one family, clearly separated:**

- **Last-minute offer** (exists, unchanged): slot-snapshot of one
  day's real gaps, percentage phases, flightdeck-born. The current
  `openOfferFor()` — the "fill her Friday slots" flow — stays as-is.
- **Personal offer** (new): `personalOffers[]` — a *service-level
  promise to one customer over a validity window*:

```js
{
  id:'po1',
  customerId:'c4',
  businessId, locationId,
  sid:'s5', variantId:null, empId:null,       // employee optional (§8)
  normalPrice:2500,                            // snapshot at creation
  specialPrice:1800,                           // OWNER-TYPED, required
  discountPct:28,                              // derived, display only
  validFrom:'2026-08-18', validUntil:'2026-08-25',
  prefWeekday:4, prefBand:{from:14,to:17},     // optional, from stats
  audience:'SPECIFIC_CUSTOMERS', customerIds:['c4'],  // same vocabulary
  publicOn:false,                              // structurally absent from UI
  status:'live',                               // live | expired | redeemed | cancelled
  createdAt, createdBy,
  relatedSuggestionId, intent
}
```

Why not force this into the slot model: a week-long offer on "Premium
Facial, Fridays preferred" is a *promise*, not a snapshot — the slots
it will be redeemed against don't exist yet. Stretching the snapshot
model to cover it would quietly break the flightdeck's core honesty
("the numbers come from the live calendar"). Two small objects that
each tell the truth beat one object that lies twice.

What they share: the audience vocabulary (`SPECIFIC_CUSTOMERS` +
`customerIds`, resolved by the same `phaseAllows`-style check), the
money/date helpers, the Marketing screen (personal offers get their
own list block there), and the drawer conventions.

### 4.2 The drawer — `PANELS.personalOffer`

GX sections:

1. **Customer & context** (read-only ident): name, why (suggestion
   text when launched from one), last visit, cadence.
2. **Offer**: service (select, prefilled with favorite/lapsed),
   variant, employee (optional, prefilled with preferred employee when
   the ≥60% rule fires), normal price (read-only, from catalog via
   the pricing door), **special price (required, owner-typed, no
   default)** — deliberately empty so a discount is always a
   conscious act (product rules 3–4). Derived % shown live beside it.
3. **Validity & preference**: valid from (today) / until (default
   +7d), preferred weekday + time band chips prefilled from stats,
   clearable.
4. **Notify** (the offer_message bridge): checkboxes Email / Velnes
   notification, editable prefilled `offer_notify` template.
   Publishing with a channel checked creates the linked
   CustomerMessage(s) (QUEUED, `relatedOfferId` set). Unchecked =
   offer exists silently (owner may tell the customer in person —
   also a channel).

Save = `savePersonalOffer()`: validates specialPrice (0 < special <
normal → warn if ≥ normal, block if ≤ 0), validity order, then push +
activity events + optional messages.

### 4.3 Prefill — CI does the thinking (§20.5, brief §9)

`personalOfferDraftFor(cid, intent, sid)` reads `custStats` exactly
like `openOfferFor` does today — the weekday/band/last-location logic
gets **extracted into shared helpers** (`ciPreferredWeekday(st)`,
`ciPreferredBand(st)`, `ciLastLocation(cid)`) so both flows use one
implementation:

- location ← last visit's; service ← `sid` (winback) or
  favoriteService; employee ← top employee if ≥ MIN_EMP_PCT;
  weekday/band ← the trend rules; validity ← today + max(7, median
  gap) days for comeback intent (an overdue customer gets a window
  long enough to land in their rhythm).
- Prefill decides **everything except money**. Special price starts
  empty. Always. (Product rules 3–4 are enforced structurally, not by
  policy text.)

### 4.4 What V1 deliberately does NOT do

The booking gate and till do **not** yet honour `specialPrice` — that
is the standing "kassa + widget through `priceFor()`" open item, and
gluing it on here would half-build it. V1: the offer exists, is
listed, is linked, is measurable; redemption is manual (owner applies
the price at the till — `pos.discount` exists). The `priceFor()`
integration is called out as the explicit next milestone, and the
personal-offer object already carries everything it needs
(sid/variant/customer/validity/price).

---

## 5. Offer ↔ Message relationship (§20.7)

Exactly the brief's rule, made structural:

- The offer is a row in `personalOffers[]`; the message is a row in
  `customerMessages[]` with `relatedOfferId`.
- Message failure never touches the offer. "Resend notification" =
  new message row, same `relatedOfferId` — no duplicate offer
  possible because resend flows never call `savePersonalOffer`.
- The offer body is never serialized into a message; the template
  *describes* it and (in the future customer app) links to it. The
  server-side offer is the single source (brief §11 — the future
  "Offers for You" screen reads `personalOffers` by customerId;
  nothing about it requires redesign here).

---

## 6. Activity — the event log (§20.8)

New append-only array + one door:

```js
custActivity[] : { id, customerId, ts:'ISO datetime', actor:'e1'|'system'|'customer',
                   type, refType:'offer'|'message'|'appointment'|'suggestion',
                   refId, meta:{channel?, intent?, amount?} }

activityLog(cid, type, refType, refId, meta)   // the only writer
custActivityFor(cid)                            // newest first
```

V1 event vocabulary (written by our own flows):
`offer_created`, `offer_cancelled`, `message_drafted`,
`message_queued`, `message_cancelled`. Reserved for the future
(schema-ready, nobody writes them yet): `message_sent`,
`message_failed`, `message_opened`, `offer_opened`, `offer_booked`,
`offer_expired`, `offer_redeemed`, `appointment_completed`.

**Why a separate log and not the appointment history:** appointments
are operational truth with their own lifecycle; activity is the
engagement narrative *about* the relationship. Mixing them would force
every appointment consumer to filter engagement noise. They meet only
in the UI timeline (below) and, later, in `custStats`.

**Future intelligence (§20.17, brief §13)** is why `actor`, `channel`
and `intent` are on every event from day one: "accepted 3 of the last
4 facial offers" = count(offer_booked, intent-service=facial) /
count(offer_created); "opens notifications but not email" =
opened-rate per channel. When those events exist, `custStats` gains a
`response:{byChannel, byIntent}` block — same door, one more field,
and suggestions can start choosing channels. Nothing else changes.

### UI: the Activity tab

New profile tab **Activity** (full-permission only), rendered from
`custActivityFor`: date · icon · sentence · reference chip (opens the
offer/message detail). Registered in `PROFILE_TABS` **and** in
`test-screens`' enumeration in the same patch (pitfall #1 of the
handover). Appointment history stays untouched in its own tab.

---

## 7. UI changes summary (§20.9–11)

- **Suggestions card + AI "Recommended actions"**: multiple buttons
  per suggestion via `actions[]` (both surfaces read the same data —
  zero extra wiring).
- **Toolbar** gains **Contact customer** and **Create personal
  offer** (manual, suggestion-independent — brief §14), both
  permission-gated (§8).
- **New drawers**: `contactCustomer`, `personalOffer` (both GX,
  registered in the panel-name test).
- **New tab**: Activity (+ its two registrations).
- **Marketing screen**: a "Personal offers" list block (customer,
  service, price, validity, status, linked-message chip).
- The existing charts/trends/AI layout is untouched.

---

## 8. Permissions (§20.13)

Finding: today `customers.view_business` = seeing *and* acting. The
brief is right to split it. Proposal — **one new group, two new
keys**, nothing more:

```
['Customer engagement',[
  ['customers.message','Draft and queue customer messages'],
  ['marketing.personal_offers','Create personal offers with special pricing'],
]]
```

- **View** insights: unchanged, `customers.view_business`.
- **Message**: `customers.message`. Front desk plausibly gets this
  (they already talk to customers all day) — decision per role kit,
  default: owner+manager yes, front desk yes, employee no.
- **Personal offers**: `marketing.personal_offers` — the money key.
  Owner+manager only by default. Deliberately *not* reusing
  `pos.discount` (till-moment discount ≠ standing special price).
- Buttons hide without the key; the drawers also refuse via the
  standard `denied()` path (screen hides, gate decides — the house
  rule).
- Bookkeeping (`r_finance`) keeps read access to offer lists via
  reports; no engagement keys.

Two keys is the floor that satisfies the brief's "special pricing is
sensitive" without inventing a permission per button.

---

## 9. Backend/API direction (§20.14–16)

Mirrors the doors one-to-one (same discipline as the insights spec):

```
GET  /api/customers/{id}/messages            → msgFor
POST /api/customers/{id}/messages            → msgCreate   (status DRAFT|QUEUED)
POST /api/messages/{id}/queue|cancel         → msgQueue / msgCancel
POST /api/messages/{id}/send                 → RESERVED — adapter-era only

GET  /api/customers/{id}/personal-offers
POST /api/customers/{id}/personal-offers     → savePersonalOffer
POST /api/personal-offers/{id}/cancel

GET  /api/customers/{id}/activity?page=n     → custActivityFor (paged like history)
```

SMTP-readiness (brief §17) is satisfied by the model, not by code:
queued/sent/failed/error/timestamps/sender-identity fields exist from
row one; the adapter is a worker that selects QUEUED and writes
outcomes + activity events. Notification-readiness (brief §18)
identical, plus the reserved `opened` event. **CI never learns how
delivery works — it only reads outcomes from the activity log.**

MSSQL sketch: `CustomerMessages`, `PersonalOffers`,
`CustomerActivity` (append-only, clustered on customerId+ts), all
carrying businessId/locationId per existing conventions.

---

## 10. Edge cases the brief missed (§20.18)

1. **Marketing consent.** Intake consent ≠ permission to email
   marketing. Proposal: `marketingConsent:true|false|null` on the
   customer (edit drawer, next to birthday); `null`/false disables
   channels in both drawers with an honest hint. Legally load-bearing
   in the EU; near-free now, painful later.
2. **Message language.** Templates are English; the customer base is
   Macedonian. V1: template picker offers MK/EN variants per intent
   (decision needed from Alex: which languages, and is it a per-
   customer field?).
3. **Blacklisted customer.** Messages allowed (a comeback message may
   be exactly right); personal offer blocked with an honest line
   ("booking is blocked — unblock first") — an offer they cannot
   redeem is a broken promise.
4. **No email on file** → email channel disabled with "add an email
   address first" linking to the edit drawer. Same for the future
   app-channel (customer has no Velnes account yet — the notification
   queues against their record regardless; it delivers when they do).
5. **Duplicate live offers**, same customer+service, overlapping
   validity → warn in the drawer, allow override (owner may stack a
   sweeter deal deliberately).
6. **Expiry without a clock.** No cron in the prototype: `status` is
   *derived* at read time (`validUntil < TODAY → expired`), stored
   status only for explicit acts (cancelled/redeemed). Production: a
   nightly job may materialise it, plus the `offer_expired` event.
7. **Price drift.** Catalog price changes mid-validity →
   `normalPrice` is a creation-time snapshot (same snapshot philosophy
   as slots); the drawer shows both if they diverge.
8. **Customer merge/delete** → messages and activity follow the
   surviving id (production concern; noted for the .NET team).
9. **Suggestion staleness.** The customer books tomorrow; the queued
   comeback message is now wrong. V1 mitigation: the messages list
   shows cadence-state at queue time vs now; a real fix
   (auto-cancel-on-booking) is a delivery-era rule, noted.
10. **Sender identity** — which name signs the message? V1: location
    name (`businessId/locationId` are on the row); configurable
    later.

---

## 11. Recommended V1 scope (§20.19)

**In (order of work, each step tested before the next):**
1. `actions[]` migration + `data-ciact` dispatch (touches existing
   tests — updated same patch).
2. `customerMessages` + doors + templates + Contact-customer drawer.
3. `personalOffers` + doors + drawer + prefill (shared helpers
   extracted from `openOfferFor`), Marketing list block.
4. Notify section on the offer drawer (offer_message).
5. `custActivity` + doors + Activity tab (+ both registrations).
6. Permissions group + role-kit defaults + gating.
7. `marketingConsent` field + channel gating.
8. Tests: ~60–80 new checks (contract migration, template content,
   drawer flows, offer/message independence, resend-no-duplicate,
   consent/blacklist/no-email gating, permission hiding+bouncing,
   activity ordering, expiry derivation). Full regression after.

**Out (explicitly):** any real delivery; customer-facing app;
`priceFor()`/till enforcement of specialPrice (named next milestone);
open/accept tracking (schema ready, no writers); AI-generated copy
(seam ready: `msgTemplate` signature); channel-choice intelligence.

**Decisions I need from Alex before building:**
A. Template languages (MK/EN? per-customer language field?).
B. Front desk gets `customers.message`? (I propose yes.)
C. `marketingConsent` default for existing demo customers (I propose
   true for all except one, to demo the gating honestly).
D. Personal-offer default validity 7 days vs median-gap-based (I
   propose the latter for comeback intent only).

---

## 12. Future AI/automation opportunities (§20.20)

Ordered by how little they cost once V1's shapes exist:
1. **AI copy** — `msgTemplate` swaps composer for model call
   (identical to the `aiAnalysis` seam; same payload plus intent).
2. **Channel intelligence** — once opened/failed events flow,
   suggestions pick the channel (`response.byChannel`).
3. **Send-time intelligence** — daypart trend already exists; queue
   messages *for* Friday 13:00 (needs the delivery scheduler anyway).
4. **Outcome-aware suggestions** — suppress offer suggestions for
   customers who never redeem them; prefer reminders (brief §13's
   examples, computed from the activity log).
5. **Auto-drafts, never auto-sends** — the QUEUED gate means even a
   future "autopilot" mode can only fill the outbox; the owner's
   approval stays the send button. Product rule 1 survives every
   phase by construction.

---

*Approval checklist: §1 action contract · §2 message model · §4 the
two-offer-objects decision and the empty-price rule · §6 activity
model + Activity tab · §8 the two permission keys · §10.1 consent
field · §11 scope + decisions A–D.*
