# Booking changes — customer rescheduling and cancellation

Started 2026-09-30 (Alex). A customer reschedule is a **request** the
salon approves or declines; the original appointment stays authoritative
until approval. A cancellation is a distinct, policy-governed event with
history, notifications, availability, Premium and (future) payment
consequences. This document opens with what the inspection found
(§1), then the design decisions it led to (§2), then what was built.

## 1. What the inspection found (2026-09-30)

Numbered as in the brief.

1. **Booking statuses.** `appointment_status` enum: `booked`,
   `confirmed`, `cancelled`, `no_show`, `requested`
   (`db/migrations/20260824180006_scheduling.sql:10`, `…booking_requests.sql:8`).
   `requested` is a Velnes-app booking at a salon that confirms by hand;
   it holds its slot until accepted (`booked`) or declined (`cancelled`).
2. **State machine.** There is none beyond one guard: `decideRequest`
   refuses anything not `requested` (`NOT_A_REQUEST`). `patchAppointment`
   accepts any status change without checking the past, payment or the
   current status; its move branch re-runs `bookingCheck` with
   `ignoreId` and the frozen prep/reset (`booking.service.ts:859-885`).
   The consumer cancel door checks only `ALREADY_CANCELLED`.
3. **Start/end storage.** Local wall clock: `date` + `start_min` +
   `duration_min`, with `prep_min`/`reset_min` frozen at booking. End is
   derived. No timestamptz on the row except `created_at`.
4. **Timezone.** `locations.tz`; `nowAt(tz)` (Intl-based, DST-safe)
   gives the salon's day and minute. Nothing converts a local
   appointment time to an instant today — the cancel-deadline
   arithmetic does not exist anywhere.
5. **Existing cancellation.** Staff: `PATCH /appointments/:id
   {status:'cancelled'}` (perm `appointments.cancel`): status, a
   history line `Cancelled` (source `staff`), an audit row; no mail, no
   client bell. Consumer: `POST /client/me/appointments/:id/cancel`:
   status, history (source `client`), salon bell, client bell; **no
   policy check, no audit row, no mail, and it cancels one leg of a
   multi-treatment visit only**. Guests have no cancel door.
6. **Cancellation-policy schema.** `locations.cancel_hours` (int,
   default 24, 0–168) is the one real policy; `settings.marketplace.
   cancelUntil` is descriptive text; `widgets.cancel_policy` is
   `'inherit' | hours` for the widget surface. Surfaced to the consumer
   as `cancelHours`, **enforced nowhere**.
7. **Snapshot.** Not snapshotted: the window is read live from the
   location at display time.
8. **Consumer upcoming UI.** `MyVelnes.tsx`: `bucketOf` (browser
   clock, end time, no tz) → up / past / cancelled; the detail is the
   list row; upcoming shows policy text (hardcoded English), Pay now,
   Book again, and a Cancel button with no confirmation.
9. **Consumer detail UI.** Same file; header card (2026-09-30) carries
   Write a review / Book again; a map card; the review form.
10. **Workspace appointment detail.** `AppointmentDrawer.tsx` EditBody:
    employee, status badge, price, location, source, variant, modifiers;
    actions Accept/Decline (requests), Take payment, Edit (move, via
    PATCH), Open profile, Cancel. **No history/timeline is shown and no
    read route for `appointment_history` exists.**
11. **Workspace calendar.** Fetches the day/week per scoped location;
    **cancelled rows are fetched and hidden client-side** with no
    toggle; `requested` gets a dashed border; no drag-and-drop; refusals
    localised by `refusal.<CODE>`; the bell deep-links to
    `/calendar` with `state.appointment`.
12. **Customer detail.** `GET /customers/:id/appointments` → upcoming /
    history (no status filter, limit 200); cancelled and no-show rows
    render dimmed with a badge; KPIs are visits/spend; `customers.
    no_shows` exists but is never incremented by code.
13. **Notification architecture.** `client_notifications` (kind, title,
    body, refType, refId, read_at) written by `notifyClient` (opens its
    own client context — cannot join a tenant transaction);
    `platform_notices` (audience salons/hq, kind, refId) written by
    `notifySalon(trx, …)`. The workspace bell has no server read state
    (localStorage) and deep-links `booking*` kinds to the calendar.
    Neither table has a dedupe key.
14. **SMTP.** Real (nodemailer, Resend by default) since 2026-09-23;
    `queueMail(trx, …)` writes `mail_outbox` inside the caller's
    transaction; a 30 s loop drains with backoff 1/5/15/60 min, five
    attempts. No template registry — each call site composes prose;
    only the review reminder is localised (`@velnes/i18n`, by
    `client_users.lang`). Salon-side recipient = the owner employee's
    email (`salonOf`). **No mail dedupe** — idempotency must come from
    the transition itself.
15. **Idempotency/jobs.** Unique keys per domain (`appointments.
    idempotency_key`, `holds.key`, `invoices`, `merchant_transactions`).
    No jobs table, no scheduler: two in-process loops (mail, review
    reminders). The reminder pattern — a gate table with a primary key
    inserted in the same transaction as the side effects — is the one
    to copy.
16. **Audit/history.** `audit_log` (employee actor only; consumer facts
    ride in `actor_name` + `source`), `logAudit(trx, tenantId, …)`;
    `appointment_history` (free-text `what`, `by_name`, `source`) with
    ~10 distinct `what` strings across the code. The consumer cancel
    door writes history but no audit row.
17. **Premium.** Implemented: `member_recs` (pending → approve/decline)
    → `premium_offers` staged 1→2→3 (demo "advance" button, no
    scheduler) → a `member` price option at the till. **Not
    implemented**: customer notification, customer acceptance, booking
    from an offer (`appointments.pmo_id` never written). The only
    creator is `memberRecScan(trx, tenantId, locId)` — a pull-based scan
    of **tomorrow's first gap**, guarded by "any rec exists → skip".
    `openCapacity` already excludes cancelled appointments, so a
    cancelled slot reappears as a gap on the next read; nothing pushes
    it.
18. **Where a released slot enters Premium.** There is no slot-shaped
    creator. The seam is a new push-style creator in
    `marketing.service.ts` that writes a `member_recs` row for one
    explicit slot, scored by the existing `memberScore`, deduped by a
    slot key, feeding the existing approve/decline/stage machinery
    unchanged. The prototype doc anticipates exactly this ("make
    `memberRecScan` push per gap and de-dupe by slot").
19. **Payment schemas.** No `payments` table. Truth of "paid" is an
    `invoice_lines` row on a non-`Refunded` invoice; `appointments.paid`
    is a text mirror (`unpaid|deposit|paid`). `invoices.method` is free
    text (`Cash`, `Card`, `Online card`, `Apple Pay`, `Gift card`, `Bank
    transfer`); `merchant_transactions.provider_ref` carries the mock
    charge ref (`mock_ch_…`). `refundInvoice` is a status flip with an
    audit row — no money moves, nothing else is touched.
20. **Recommended abstraction.** A `payments.provider.ts` in the
    established swappable shape (`mailTransport`, `insightProvider`):
    `PaymentProvider { refund(ref, amount) }`, `MockPaymentProvider`
    today, chosen by `PAYMENT_PROVIDER` (default `mock`); a `refunds`
    table as the refund intent; `determineRefund()` isolated.
21. **Cancelled on the calendar.** Keep the rows the API already sends;
    render them muted/struck (`ev-cancelled`) behind a "Show cancelled"
    filter that defaults on. Availability already ignores them.
22. **Recommended request schema.** `booking_change_requests` — see §2.
23. **Lifecycle.** Booking status untouched by a request; request
    status `pending → approved | declined | withdrawn`; a declined
    request waits for the customer's decision (`keep` | `cancel`) and
    is then `resolved`.
24. **Permissions.** Approve/decline = `appointments.edit` (as booking
    requests); cancellation history = existing `customers.view_*`;
    refund state = existing appointment view. No new permission.
25–29. API, contracts, migrations, consumer and workspace changes —
    §2 and §3.
30. Notification matrix — §2.7.
31. Concurrency — §2.8.
32. Product decisions — §2.9.

## 2. Design

### 2.1 Domains, kept apart

| Domain | Where | Values |
| --- | --- | --- |
| Booking status | `appointments.status` (unchanged enum) | booked · confirmed · requested · cancelled · no_show |
| Change request | `booking_change_requests.status` | pending · approved · declined · withdrawn · resolved |
| Customer's answer to a decline | `booking_change_requests.customer_decision` | null · keep · cancel |
| Cancellation | `appointments.cancelled_at / cancelled_by / cancel_reason` | by: customer · salon · system · hq |
| Cancellation policy | `appointments.cancel_hours` (snapshot) | hours, from `locations.cancel_hours` at booking |
| Payment | derived from invoices | unpaid · venue · paid (+ method) |
| Refund | `refunds.status` | pending · processing · refunded · failed |
| Premium opportunity | `member_recs.status` (existing) | pending · approved · declined |

### 2.2 The visit is the unit

A multi-treatment visit is a chain of sibling rows linked by the
idempotency-key prefix (`visitOf`). Rescheduling and cancelling act on
the **visit**: a request anchors on the first leg, approval moves every
leg by the chain's own geometry (`legStarts`), cancellation cancels
every leg. The consumer sees the request state on each leg.

### 2.3 Schema

`db/migrations/20260930120000_booking_changes.sql`:

- `appointments` + `cancel_hours integer` (snapshot; backfilled from
  the location), `cancelled_at timestamptz`, `cancelled_by text`
  (`customer|salon|system|hq`), `cancel_reason text`.
- `appointment_history` + `meta jsonb` (structured from/to, actor).
- `booking_change_requests`: id, tenant_id, appointment_id (the visit's
  first leg), kind (`reschedule`), status, original_date/start_min/
  duration_min/employee_id, requested_date/start_min/employee_id,
  requested_by_client_user_id, requested_at, resolved_by_employee_id,
  resolved_at, decline_reason, customer_decision, decided_at,
  created_at. `UNIQUE (appointment_id) WHERE status IN ('pending',
  'declined')` — one active request per visit, by construction. RLS
  tenant isolation + HQ read.
- `refunds`: id, tenant_id, appointment_id, invoice_id, amount, method,
  status, provider, provider_ref, charge_ref, requested_at, completed_at,
  attempts, failure_reason. `UNIQUE (invoice_id)` — one refund intent
  per paid invoice, whatever retries.
- `member_recs` + `slot_key text`, `UNIQUE (tenant_id, slot_key)` — a
  released slot feeds Premium once.

### 2.4 Cancellation policy

`cancelDeadline = instantAt(location.tz, firstLeg.date, firstLeg.start)
− cancel_hours × 3600 s`. Allowed iff `now < deadline` (strict; at the
deadline it is blocked). `cancel_hours = 0` means "until it starts".
The snapshot taken at booking governs the booking for life; an approved
reschedule keeps the snapshot and recomputes the deadline against the
new start. The server decides `canCancel`, `cancelDeadline` and
`cancelBlockedReason`; the door re-checks at mutation time and refuses
`CANCEL_TOO_LATE` with the deadline in the refusal.

Rescheduling is **not** restricted by the cancellation window (no such
product rule exists); a request is refused only when the visit is
cancelled, has started, has an active request, or names the same time
or an unavailable one.

### 2.5 Doors

Consumer (`/client/me/appointments/:id/…`, own rows only):

| Door | Rule |
| --- | --- |
| `GET /client/me/appointments` | each row carries `canReschedule`, `canCancel`, `cancelDeadline`, `cancelBlockedReason`, `changeRequest`, `cancellation`, `payment`, `refund`, `history` |
| `GET …/:id/reschedule-slots?date=` | the visit's free starts that day, ignoring its own legs |
| `POST …/:id/reschedule {date,time}` | creates the pending request; original untouched |
| `POST …/:id/reschedule/withdraw` | pending → withdrawn |
| `POST …/:id/reschedule/keep` | declined → resolved (keep); salon told |
| `POST …/:id/cancel` | policy-checked; declined request (if any) → resolved (cancel); cancels the visit |

Workspace:

| Door | Rule |
| --- | --- |
| `GET /change-requests?status=` | the location's requests (perm `appointments.view_location`/`view_own`) |
| `POST /change-requests/:id/approve` | `appointments.edit`; re-checks every leg through `bookingCheck`; refuses `SLOT_TAKEN` otherwise |
| `POST /change-requests/:id/decline {reason?}` | `appointments.edit` |
| `GET /appointments/:id/history` | the timeline (history + requests + refunds) |
| `PATCH /appointments/:id {status:'cancelled'}` | now goes through the same `cancelVisit` (by `salon`) |
| `GET /customers/:id/appointments` | + `stats {total, completed, upcoming, cancelledByCustomer, cancelledBySalon, noShows}` and `cancelledBy` per row |

### 2.6 Payments and refunds

`payments.provider.ts` — `PaymentProvider { refund(chargeRef, amount)
→ {ok, ref} | {ok:false, reason} }`; `MockPaymentProvider` (a charge
ref containing `fail` fails, so fixtures and tests can exercise the
failure path). `determineRefund(visit)` — V1: a visit paid online
(`Online card` / `Apple Pay` invoice on the visit, not refunded) is
refunded **in full** when cancelled; venue/unpaid → not required.
Cancellation commits first; the refund row is created `pending` in the
same transaction; the provider is called after commit; success →
`refunded` + invoice `Refunded`; failure → `failed` with the reason,
retried by an in-process loop (five minutes, max five attempts), never
un-cancelling the booking.

### 2.7 Notification matrix

| Event | Salon bell | Salon mail (owner) | Customer bell | Customer mail |
| --- | --- | --- | --- | --- |
| Reschedule requested | yes (`booking_change`) | yes | — (UI shows "waiting") | no |
| Approved | state updated | no | yes | yes |
| Declined | state updated | no | yes | yes |
| Customer keeps original | yes | yes | — | no |
| Customer cancels | yes | yes | yes | yes |
| Salon cancels | — | — | yes | yes |
| Refund completed / failed | failed: yes | no | yes | yes |

Every transition is a guarded `UPDATE … WHERE status = … RETURNING`;
the bells and mails are queued inside that transaction, so a retried
call that finds the transition already made sends nothing.

### 2.8 Concurrency

Row locks (`FOR UPDATE`) on the visit's legs and the request inside one
transaction for approve/decline/withdraw/keep/cancel; the partial
unique index makes a second concurrent request fail at insert; approval
re-runs `bookingCheck` per leg with the legs' own ids ignored, so a
slot taken since the request refuses cleanly; cancellation and approval
serialise on the same row locks — whichever commits second sees the
other's state and refuses.

### 2.9 Product decisions taken (report them, proceed)

1. **Policy snapshot at booking** (Alex's stated preference): built,
   with a backfill of existing rows from their location.
2. **Reschedule near the start**: no rule exists; V1 allows a request
   until the visit starts. Reported as a decision for later.
3. **Professional on reschedule**: V1 preserves the original
   professional (or "any" if it was any).
4. **Guests**: no secure manage access exists (only a pay capability
   token); guest reschedule/cancel is **not built** — reported gap.
5. **Refund V1** = full refund of the online-paid amount; deposits and
   fees are not modelled (deposits are deferred platform-wide).
6. **Salon cancellation** now flows through the same door
   (`cancelled_by = salon`) so history, refund intent and the client's
   notification are the same whoever cancels.
7. **Salon mails stay English** (the existing convention); customer
   mails are localised by `client_users.lang` like the review reminder.

## 3. What was built (2026-09-30)

**Migration** `db/migrations/20260930120000_booking_changes.sql` — see
§2.3; applied to dev, the test database migrates on every run.

**Domain** `services/api/src/modules/booking/changes.service.ts`:
`visitLegs` (the chain by its idempotency-key prefix, locked for
writers), `cancelWindow` / `visitRights` (the server's decisions),
`requestReschedule`, `withdrawReschedule`, `approveReschedule`,
`declineReschedule`, `keepOriginal`, `cancelVisit`, `visitHistory`,
`paymentOf`, `refundOf`. `bookingCheck`, `busyRoomsAt` and
`chainAvailability` learned `ignoreIds` so a moving visit is never in
its own way. `confirmBooking` snapshots `locations.cancel_hours` onto
the row. `patchAppointment {status:'cancelled'}` and the PATCH door
both go through `cancelVisit` (by `salon`).

**Money** `services/api/src/modules/payments/payments.provider.ts`
(`PaymentProvider`, `MockPaymentProvider`, `PAYMENT_PROVIDER=mock` is
the only value env.ts accepts) and `refunds.service.ts`
(`determineRefund`, `createRefundIntent`, `processRefund`,
`retryRefunds`, `startRefundLoop` every five minutes, five attempts
with 1/5/15/60-minute backoff). A charge reference containing `fail`
is refused by the mock, so the failure path is real in fixtures and
tests.

**Premium** `releaseSlotToPremium` in `marketing.service.ts` — §1.18.
`PREMIUM_RULES.minLeadMin` is enforced for this creator (the scan
never enforced it); the customer who freed the slot is not a
candidate; `slot_key` makes it once.

**Doors** — §2.5, all built. Consumer refusals carry `code`/`params`
(the session client now forwards them), so every refusal shows in the
customer's language through `refusal.<CODE>`.

**Consumer** `apps/consumer/src/features/account/Changes.tsx` +
`MyVelnes.tsx`: Reschedule (four-day chips, the visit's own free
starts, a confirmation that says the appointment only changes after
approval), the waiting card with Withdraw, the declined card asking
keep-or-cancel (cancel offered only while the window is open), the
approved card (originally → new time), the policy card with the
deadline or the blocked explanation, the cancel confirmation (two
taps, refund note when paid online), payment and refund lines, an
Activity section; badges "Waiting for salon approval" / "Reschedule
not approved" on the rows.

**Workspace** `pages/calendar/Changes.tsx` in the drawer (request card
with Approve / Decline + reason, declined-awaiting note, cancellation
fact, payment and refund, timeline), a **Requests** pill on the
calendar with the pending count and an inbox (`?requests=1`, also the
navigation-search destination "Reschedule requests" in four
spellings), cancelled visits kept on the grid muted and struck behind
"Show cancelled" (default on), the mail's `?appointment=` deep link,
and Customers › Appointments with the counts (appointments, completed,
cancelled by customer with the salon's beside it, no-shows) and "who
cancelled" on each row.

**Fixtures** `fixtures changes --batch <name>`: the batch's first salon
gets one consumer (`changes.client@fixture.velnes.test` /
`velnes-fixture`) with the ten states of §63: open, blocked, pending,
declined-awaiting, approved, kept, customer-cancelled,
cancelled-into-Premium, prepaid refunded, prepaid refund failed.

**Tests** `cancel-window.test.ts` (instants across DST and zones, the
exact cutoff), `changes.test.ts` (request/approve/decline/keep/cancel,
the taken-slot refusal, rights, the inbox, the policy, the salon's own
cancellation, customer counts, Premium once), `refunds.test.ts` (mock
provider, unpaid, refunded, failed → retried, no duplicates), consumer
`Changes.test.tsx`, workspace `calendar/Changes.test.tsx` and the
customers stats test. The Premium suite now pins its empty-queue
precondition.

## 4. Deferred, honestly

- Guest reschedule / cancel: no secure guest access exists beyond the
  pay token — a `manage:` capability link in the same shape would open
  it; not built.
- A chosen professional on reschedule, and a chosen date beyond the
  four-day chips (the API takes any date; the picker walks in fours).
- A rule restricting reschedule requests near the start (none exists;
  requests are allowed until the visit starts).
- Deposits, fees, partial refunds: `determineRefund` is the one place
  they land; V1 refunds the online-paid invoice in full.
- A real payment provider: replaces `MockPaymentProvider` behind
  `PAYMENT_PROVIDER`; `charge_ref` is already what it needs.
- Server-side read state for the workspace bell (still localStorage).
- Salon-side mails in the owner's language (English, like every salon
  mail today).
