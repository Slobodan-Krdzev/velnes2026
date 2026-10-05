# Velnes Loyalty — the platform points ledger

Started 2026-09-30 (Alex). One Velnes balance per consumer account,
earned at any salon, every point with a reason and a source, every
automatic award idempotent, every balance explainable from immutable
rows. Earning, balance, history and notifications are built here;
redemption, promotions and expiry are designed for, not built.

**Not the salon's loyalty card.** The till already runs a per-salon
ledger (`loyalty_ledger`, `loyalty_config`, `customers.points` — points
are money the salon owes, earned on the paid total, redeemed at the
till, ×1.5 for Premium). That stays exactly as it is. This document is
about a second, platform-level ledger keyed to `client_users`.

## 1. What the inspection found (2026-09-30)

Numbered as in the brief.

1. **Consumer model.** `client_users` (email, password, first/last,
   phone, dob, lang, avatar, `email_verified_at`, consent flags); the
   bridge to a salon's customer row is `client_customer_links
   (client_user_id, tenant_id) → customer_id`.
2. **Registration lifecycle.** `POST /client/register` inserts the row
   at once (unverified, cannot log in) and mails a six-digit code;
   `POST /client/verify-email` sets `email_verified_at` (idempotently —
   an already-verified row keeps its timestamp), rings the welcome bell
   (`kind account`, "Welcome to Velnes") and opens the session. Login
   refuses `EMAIL_UNVERIFIED` until then. Re-registering an existing
   address answers the same as a new one (no oracle).
3. **Guests.** A guest books with `client_user_id NULL`. When that
   person later registers and books, `linkCustomer` adopts the salon's
   customer row by verified email (or phone), but **no code back-fills
   `client_user_id` onto the guest's earlier appointments** — they stay
   invisible to the account. There is no claim flow.
4. **Existing loyalty.** Salon-level only (see the box above); the
   consumer app never shows any points; `loyalty_config.welcome` and
   `.birthday` exist and nothing reads them; the Premium page's "1.5×
   loyalty" refers to the salon card.
5. **Completion.** No status, no column, no event. `isCompleted(a, tz,
   now)` in `reviews.service.ts` is the platform's one definition:
   kind appointment, status booked or confirmed, end passed in the
   location's zone. The employee app's "Treatment finished" is a
   history line, not required and not authoritative.
6. **Multiple services.** A visit is a chain of sibling rows linked by
   the idempotency-key prefix (`visitLegs` in `changes.service.ts`),
   one service per leg, each leg with its own status.
7. **Delivered services.** A leg that is booked/confirmed with its end
   passed; cancelled and no-show legs are not delivered.
8. **Products.** Sold at the till: `settleSale` writes one invoice with
   a `service` line carrying `appointment_id` and N `product` lines
   carrying `product_id` (`appointment_id` null) on the same
   `invoice_id`. Products sold with no appointment in the basket have
   no customer at all and cannot be attributed. Products reserved with
   an app booking (2026-10-01, `appointment_products`) land on that same
   invoice — through the app's pay door or the till's pre-filled basket
   — so they count here with no rule of their own.
9. **Quantity.** `invoice_lines.qty` (integer, ≥ 1); the workspace
   stepper increments it; stock moves by `-qty`.
10. **Void/refund.** `refundInvoice` flips `invoices.status` to
    `Refunded` (whole invoice, no per-line void, no returns, no stock
    return, no points reversal — the salon ledger has the same hole).
11. **Reviews.** `submitReview`: client-owned, completed, one per
    appointment (UNIQUE, 23505 → `ALREADY_REVIEWED`), inserted in one
    transaction with the salon's bell. **No editing, no consumer
    deletion** (the client policy is INSERT only). Moderation
    (`body_status`, `rating_status`) is HQ-only by RLS and has no route
    yet.
12. **Notifications.** `client_notifications` (kind, title, body,
    refType, refId) via `notifyClient`; the consumer bell deep-links by
    `refType`; the account welcome is `kind account`.
13. **Events/jobs.** No outbox, no scheduler. Two in-process loops
    (mail, review reminders) plus the refund loop; the durable pattern
    is a scan + a gate row inserted in the same transaction as the side
    effects, behind a `platform_features` cutoff.
14. **Recommended ledger** — §2.2.
15. **Balance** — ledger is truth; a cached `client_users.loyalty_points`
    recomputed as `SUM(points)` inside the same transaction as every
    insert (the till's own pattern), so it cannot drift.
16. **Idempotency** — `UNIQUE (client_user_id, type, source_id)`: one
    registration bonus per account (source = the account id), one award
    per visit (source = the first leg's id), one per review (source =
    the review id), one reversal per visit. Retries, restarts, doubled
    workers and racing submits all hit the same index.
17. **Rules** — `LOYALTY_RULES` in `@velnes/contracts` with `version:
    1`; every ledger row stores `meta.ruleVersion` and its breakdown, so
    a rule change never rewrites history. No HQ UI: platform constants.
18. **Registration timing** — award at **email verification**, the
    first moment the account is real (it can log in, book, review). An
    unverified signup earns nothing; verifying twice earns once.
19. **Existing users** — see §2.9: no silent backfill.
20. **Guests** — no wallet; nothing awarded "into nowhere"; no
    retroactive claim (there is no secure claim path). §2.9.
21. **Review deletion** — does not exist; moderation is separate and
    never touches points. §2.9.
22. **Appointment reversal** — completion is derived, so "un-completing"
    is a later status change to cancelled/no-show; the sweep writes one
    negative `appointment_reversal` row (unique per visit). §2.6.
23. **Workspace/HQ** — the salon never sees or edits the platform
    balance; HQ gets a read-only lookup. §2.8.
24. **Consumer surfaces** — §2.7.
25–27. Migrations, contracts, tests — §2.10, §3.

**The discrepancy, reported and settled.** The stated rule (first
service 100, each additional +30) gives 1 → 100, 2 → 130, 3 → 160,
4 → 190, while the brief's example said 3 services → 190. Alex
confirmed on 2026-10-02 that the rule stands and the example was a
mistake: three services earn 160.
`LOYALTY_RULES.appointment.additionalService` is 30; every derived
number (tests, fixtures, the "how to earn" copy) reads the constant.

## 2. Design

### 2.1 Rules

| Event | Points | Source |
| --- | --- | --- |
| Email verified (first time) | 100 | the account |
| Visit completed, first service | 100 | the visit's first leg |
| each additional delivered service | 30 | — |
| each choice beyond Standard — a length other than the base card, each option picked (2026-10-02) | 20 | the leg's `variant_id`, each of `modifier_option_ids` |
| each product unit sold with the visit | 20 | — |
| Verified review submitted | 50 | the review |

`LOYALTY_RULES = { version: 1, registration: 100, appointment: {
firstService: 100, additionalService: 30, productUnit: 20, extraChoice: 20,
settleHours: 2 }, review: 50 }` in `packages/contracts/src/loyalty.ts`;
`servicePoints(n)`, `productPoints(units)` and `appointmentPoints`
live beside it and nowhere else.

### 2.2 Schema — `db/migrations/20260930140000_loyalty.sql`

- `client_loyalty_ledger`: `id`, `client_user_id` (FK, CASCADE),
  `type` (CHECK: registration_bonus, appointment_completed,
  review_submitted, appointment_reversal, product_return_reversal,
  reward_redeemed, promotion_bonus, manual_adjustment,
  points_expired), `points integer NOT NULL CHECK (points <> 0)`
  (signed), `source_type`, `source_id`, `tenant_id` (where it was
  earned; no FK, like favourites), `meta jsonb`, `note`, `created_at`,
  `created_by`. `UNIQUE (client_user_id, type, source_id) WHERE
  source_id IS NOT NULL`. Index `(client_user_id, created_at DESC)`.
  RLS: the client reads their own (never writes); HQ reads and writes;
  nothing for tenants — every award is written under the platform
  context by the loyalty service.
- `client_users` + `loyalty_points integer NOT NULL DEFAULT 0` (the
  cache).
- `platform_features ('loyalty')` — the rollout cutoff: no visit that
  ended, no review written and no account verified before it earns.

### 2.3 One writer

`services/api/src/modules/loyalty/loyalty.service.ts` — `award(...)`
inserts the row and recomputes the cache in one HQ transaction;
`ON CONFLICT DO NOTHING` makes every caller idempotent. Callers:

- the verify-email door (registration bonus, then the welcome bell
  says the number);
- the review submit door (after the review's own commit; the response
  carries `loyaltyPoints` for the thank-you card);
- the **sweep** (`runLoyaltySweep`, in-process every five minutes, like
  the reminders): completed visits `settleHours` past their end in the
  location's zone, per (client, salon, day) → one award for the whole
  visit; awarded visits whose delivered legs have all since been
  cancelled or marked no-show → one reversal; verified accounts and
  reviews after the cutoff that have no row (the repair path if a door
  awarded nothing because the process died).

Exactly-once is the unique index; eventual is the sweep; instant is
the door. No event bus.

### 2.4 The appointment reward

At sweep time: delivered legs = the visit's legs with status booked or
confirmed (cancelled/no-show legs do not count); `serviceCount` =
their number; product units = `SUM(qty)` of `item_class = 'product'`
lines on non-refunded invoices that carry a line referencing one of the
visit's legs. Two hours after the end, so the checkout at the till is
already on the invoice. `meta` keeps `{ serviceCount, servicePoints,
productUnits, productPoints, total, ruleVersion, salonName,
serviceNames }`. Cancelled, no-show, requested, rescheduled-not-yet-
happened: nothing. A visit moved by an approved reschedule keeps its
identity and is awarded once, when it eventually completes.

### 2.5 Registration and review

Registration: `award(registration_bonus, source = account id)` at
verification. Review: `award(review_submitted, source = review id)`
after `submitReview` returns; no edit or delete exists, so there is
nothing to repeat or reverse; moderation never touches points.

### 2.6 Reversals and the future

Negative rows are ordinary rows. Balance may go negative (auditable,
no floor; V1 has no way to spend, so it cannot happen yet). Types for
redemption, promotions, returns, expiry and HQ adjustments exist in
the CHECK and the contract; only `appointment_reversal` has a writer
today (the sweep, when a delivered visit is later cancelled or marked
no-show).

### 2.7 Consumer

My Velnes gains a **Velnes Loyalty** card on the overview (balance,
in the brand colour, the flower) and a **Loyalty** section
(`/account/loyalty`): the balance, "Recent activity" from the ledger
with human labels and the salon, and "How to earn points" from the
rules. Notifications: the welcome bell states the 100; a visit award
rings `kind loyalty` ("You earned N Velnes points") deep-linking to the
Loyalty section; the review's thank-you card says "+50" and no second
bell rings. Numbers are whole and localised.

### 2.8 Workspace and HQ

The salon workspace shows nothing of the platform balance (it is not
the salon's; showing it would leak spend at other salons) and has no
door to change it. HQ gets `GET /hq/loyalty?email=` — the account's
balance and ledger for support — and a "Loyalty lookup" panel reachable
from the navigation search. No adjustment UI in V1.

### 2.9 Product decisions taken (reported, proceed)

1. **Existing accounts are not back-filled.** Only verifications after
   the cutoff earn the welcome bonus. Dev has the demo consumer plus
   the fixture consumers (about 80 across the demo batch); production
   has real accounts. Back-filling them is a one-line explicit
   migration if wanted (B); the default here is A.
2. **Historical visits earn nothing.** The cutoff row makes the sweep
   blind to anything that ended before launch.
3. **Guests earn nothing, and nothing is held for them.** A future
   claim (adopting a guest's appointments when the same email is
   verified at registration) would be the secure path; not built.
4. **Reversal exists for the one reachable case** (status changed after
   the award). Product returns have no writer because the till has no
   returns.
5. **Balance may go negative** (auditable). No debt rules.
6. **Awards settle two hours after the visit's end**, so till checkouts
   count. A product sale rung up later than that is not counted.
7. **The additional-service constant is 30**, confirmed 2026-10-02.

### 2.10 Doors and contracts

- `GET /client/me/loyalty` → `{ balance, rules, entries[] }`;
  `ClientProfileSchema.loyaltyPoints`; `ClientReviewSchema.loyaltyPoints`
  (on the submit response only).
- `GET /hq/loyalty?email=` → the same shape plus the account.
- Contracts: `packages/contracts/src/loyalty.ts`.

## 3. What was built (2026-09-30)

- **Migration** `db/migrations/20260930140000_loyalty.sql` — §2.2; applied
  to dev; the test database migrates on every run.
- **Rules** `packages/contracts/src/loyalty.ts` — `LOYALTY_RULES`
  (version 1), `servicePoints`, `productPoints`, `appointmentPoints`,
  the ledger types and the account shape. `additionalService: 30`,
  confirmed (§1).
- **Service** `services/api/src/modules/loyalty/loyalty.service.ts` —
  `award` (the one writer), `awardRegistration`, `awardReview`,
  `visitReward` / `settleVisit`, the sweep (`runLoyaltySweep`: due
  visits, reversals, repair) and `startLoyaltyLoop` (five minutes, like
  the others), `loyaltyAccountOf`, `loyaltyLookup`.
- **Doors** — verify-email awards the bonus and the welcome bell says
  the number (localised); the review submit awards and answers
  `loyaltyPoints`; `GET /client/me/loyalty`; `GET /hq/loyalty?email=`;
  `ClientProfileSchema.loyaltyPoints`.
- **Consumer** `apps/consumer/src/features/account/Loyalty.tsx` — the
  overview card (flower, balance, "View points"), the Loyalty section
  (`/account/loyalty`: balance, Recent activity from the ledger with
  human labels and the salon, How to earn points from the rules the
  door sent), the review thank-you's "+50 Velnes points", the
  `loyalty` bell deep link. Whole, localised numbers.
- **HQ** — "Loyalty lookup" under Customers (read only), reachable from
  the navigation search in four spellings.
- **Fixtures** `fixtures loyalty --batch <name>` — Consumer A (the
  booking-changes consumer) with welcome + one-service visit + review +
  two-service visit with two products, a welcome-only consumer, an
  active one with seven visits and reviews, a quiet one with none, and
  the visits that earn nothing (cancelled, no-show, unreviewed) beside
  a rescheduled visit awarded once.
- **Tests** `services/api/src/modules/loyalty/loyalty.test.ts` (an
  unverified signup earns nothing, verification earns once and retries
  do not, the second account sees only its own; the sweep settles 1–4
  services by the rule and never twice, products by quantity from the
  till's invoice, cancelled/no-show/pending-request earn nothing and a
  moved visit earns once when it completes, an undone visit gets one
  reversal; the review earns once and a retry, an early review and a
  stranger earn nothing; two racing awards for one source make one
  row, a negative row is ordinary, salons add to one balance equal to
  the ledger's sum and the profile's cache, HQ looks up by email) and
  `apps/consumer/src/features/account/Loyalty.test.tsx`.

## 4. Deferred, honestly

Redemption (no door spends points), promotions, expiry, HQ adjustments
(the types exist; no writer), product returns (the till has no
returns), guest claims, a back-fill of existing accounts or history
(explicit decisions, §2.9), the consumer app's navigation search (it
has none; the universal search bar is for salons), and plural forms
beyond the hand-rolled ones the dictionaries use today.

## Choices beyond Standard (2026-10-02)

Alex: picking anything other than the **Standard** card for a treatment
earns 20 points on top — first asked for lengths, then widened to the
option groups too ("Hair colour brand" and the like). Rule version 2:
`LOYALTY_RULES.appointment.extraChoice` and `extraPoints`;
`appointmentPoints(services, units, extras)` carries it in its
breakdown. "Standard" is the service itself — what no-choice means at
the door (`svcChoice` never books a length nobody chose) — so
`visitReward` counts, per
delivered leg, one for a `variant_id` (any length is an upsale) and one
per entry of `modifier_option_ids`. The salon page follows the same
rule: its Standard card quotes the service's own minutes and price (the
quote equals the charge), every length and every option wears the tag
"Earn +20 Loyalty points!" — a count badge, like the profile tab's —
and the booking summary's preview counts them; the loyalty screen's
"How to earn" has the row.
`loyalty.test.ts`, `BookAgain.test.tsx`, `Loyalty.test.tsx`.

## Quiet slots (2026-10-05)

Alex: "give extra loyalty points to a user if the user books a time slot
that is usually not booked … decided by an algorithm." Decisions taken
with it: the platform pays, a flat **+20** per visit, judged **per
location**, **any reschedule forfeits it**, and only salons with more
than 40 appointments take part.

**The judgement** (`quiet-slots.service.ts`, constants in
`QUIET_SLOT_RULE`). Per location, over the last 6 weeks, every
weekday-and-start pair (the 15-minute grid, inside the location's
opening periods — exceptions count, Sundays closed count as nothing) is
scored: how many of those weeks the location was open at that time, and
in how many of them something was booked *over* it (an appointment
running across the quarter hour fills it; a no-show wanted it; a
cancellation and an unanswered request did not). A pair is judged only
when open in at least 4 of those weeks. It is quiet when its fill is
under 20 % **and** under half the location's own fill over the window
(so a half-empty salon cannot have its whole week tagged), and at most
30 % of each weekday's judged pairs are tagged, the quietest first —
ties, which a quiet salon has many of, go to the hours of the day the
salon is least booked at over the whole week, so the tags read
"evenings are quiet here" rather than landing on whichever weekday
sorts first. A
location with fewer than 40 completed visits in its whole history is
judged, recorded as not qualified, and gets no pairs at all. The pass
runs in-process once an hour and rejudges each location once a day
(`location_quiet_runs`, `location_quiet_slots`); `seed:demo` judges the
seeded world at once, and HQ can judge again on demand.

**One door, read only.** The availability doors — the tenant's, the
public widget's, the chain `/slots` — add `bonus` to a free start the
location's published pairs name; nothing is computed at request time, so
a tag cannot flip while someone is choosing. `confirmBooking` stamps
`appointments.quiet_bonus` on the visit's first treatment when a
Velnes-app booking (`marketplace`, `client`) takes such a start — staff,
widget and phone bookings never earn it. The stamp is the promise: a
slot that stops being quiet later still pays; one that becomes quiet
later does not. `patchAppointment` clears it when the date or time
changes (a change of hands keeps it); `approveReschedule` clears it
wherever the visit lands; the consumer's reschedule confirmation says
so before they ask. At settlement the bonus is its own ledger row —
`promotion_bonus`, source the visit, `meta.reason = 'quiet_slot'` — so
the customer sees why there was more, and the bell says "including a
+20 quiet-time bonus"; a visit undone after its award reverses both
rows (the bonus reversal's source is `<visit>:quiet`, so the unique
index keeps the two apart).

**What people see.** The salon page and the booking page wear a small
"+20 pts" tag on the quiet time chips and a line under the grid
explaining it; the loyalty screen's "How to earn" has the row and the
ledger names the bonus; the workspace calendar stripes the quiet cells
with a coral dot and a title, so staff know why a customer asked; HQ's
Customers tab lists every location's last judgement, its fill, its
quiet times by weekday with their k/N weeks, and the rule in words, with
a "Judge again now" button. `quiet-slots.test.ts` covers the judgement,
the bonus on a free start, the stamp, both kinds of move, settlement,
idempotence and reversal; the apps' tests cover the tags.

**Deferred, honestly.** Salon opt-in or salon-funded bonuses; a bonus
scaled by how quiet a slot is; per-employee quiet times (a time can be
empty only because one professional is always booked); a cap on how
many quiet bonuses one account may earn; and the thresholds themselves,
which are constants until real salons show what they tag.

