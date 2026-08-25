# Customers, CI, Offers & Velnes Premium (Phase 9)

## Customer intelligence — one door

`customerInsights` (GET `/customers/:id/insights`) is the port of the
prototype's `custStats`, rules verbatim:

- Only **completed** visits count — in this world: the appointment's
  day has passed (or it ended earlier today) and it was not cancelled
  or a no-show. Cancellations stay visible in history but weigh
  nowhere.
- **Visits are days**, not rows: two treatments in one sitting are
  one visit. Products join through the customer's invoices.
- **Medians over averages** — one long holiday cannot break a rhythm.
  A rhythm exists only when the quartile spread allows it
  (`CI.RHYTHM_SPREAD`); the median alone would always give a number.
- Retention labels (`returning` / `at_risk`) appear **only with a
  proven rhythm** — a label without proof is a guess, not an insight.
- With no history, the recorded totals answer, marked `seeded:false`.

The `CI` constants live in `@velnes/contracts` exactly as the
prototype defines them.

## Personal offers

A promise to **one customer** for **one service**: created only at
live locations, the normal price pinned by `svcChoice` at creation
(the offer may not disagree with the catalog), `expired` derived from
`valid_until` and never stored — there is no clock that flips fields
overnight.

`priceFor` answers with the personal option; **booking stamps the
promise** on the appointment (`po_id`, the column reserved in
Phase 4) and **paying redeems it** — `finishSale` marks the offer and
writes the `offer_redeemed` activity line with `override:false`. The
cancel/redeem endpoints are the audited administrative correction
(`override:true`), for the day the promise was made in cash and the
system was down.

`customer_activity` is the append-only relationship log —
actor/intent/ref on every line, so future funnel metrics are a pure
read. Appointment history deliberately stays out.

## Velnes Premium

The membership is **platform truth**, mirrored read-only on
`customers.premium`; `isPremium()` is the one door that reads it and
nobody stores their own copy. Members earn **×1.5 loyalty** at the
till (the ledger line carries the `· ×1.5 Velnes Premium` suffix).
The HQ rules document (`PREMIUM_RULES`) renders read-only in
Marketing → Velnes Premium.

## Last-minute offers

`openCapacity` is the **single capacity source**: each bookable
employee's working window clipped to `scheduleFor`'s truth, gaps
computed against real appointments (prep + reset included), and
`bestFill` choosing the longest treatment *this employee* fits into
the gap — variants count, and a faster hand fits a longer treatment.

One offer, several phases (`last_minute_offers`): the early window
belongs to Velnes Premium; the public phase starts when it ends and
runs until each appointment starts. The capacity snapshots travel
with the offer — today's gaps are not gaps tomorrow. `priceFor`
compares alternatives, never stacks them; a percentage rebates the
price that applies *here and now*, not a base price elsewhere.

## The Premium pipeline

`memberScore` weighs suitability transparently — service affinity,
employee loyalty, weekday, time band, at-risk as a soft signal,
reliability, offer fatigue — and every point names its **why**. The
scan is deterministic (tomorrow's first gap, priced inside the HQ
ceiling); nothing is ever sent without **Approve**. The approved
window walks the staircase — best member (`priorityMin`) → member
group (`escalationMin`) → public if the HQ rule allows — through
`pmoVisible`, and `priceFor` serves the `member` option to exactly
who the stage says. The advance endpoint is the honest demo clock,
labelled as such in the UI, until a real scheduler lands.

## Deferred honestly

Waiting list (needs its matching engine), loyalty configuration UI,
reviews (marketplace phase — a review hangs on an appointment),
campaigns (SMTP undecided), product-testing invitations (supplier
phase), the CI trends/suggestions rule sets and the AI analysis panel
(a real model on the same JSON).
