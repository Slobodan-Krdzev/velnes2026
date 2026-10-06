# Phase 4 — Till & checkout

**One sale door.** `POST /sales` is `finishSale`, idempotent by key:
whole or not at all, the same key never produces two invoices. Every
line price is recomputed at the door (appointment's stored price;
services/products through the resolution doors) — the till screen
decides nothing. A non-live location refuses checkout outright.

**Totals, the prototype's arithmetic.** `lineTotal = max(0,
price·qty − lineDiscount)`; then cart discount and deductions in
order **points → gift card → promo**, never below zero (a gift card
contributes at most what it holds); tip and service charge count back
on top — the tip belongs to the employee, not the discount.

**Invoices.** Per-location numbering from `invoice_counters`
(`CEN-2026-0413` continues the prototype's sequence), normalized
lines for Phase 5 reports, refund = status flip with a mandatory
reason and the prototype's audit shape ("2.700 ден paid → 2.700 ден
refunded"); no money movement — honest, there is no payment provider
yet.

**Multi-merchant.** `routeCheckout` splits the receipt by legal
seller (explicit product/service assignment wins, else the house
default entity — a single-seller salon feels none of this), grouped
by payment account; `sellerReady` = verified entity + active account
+ merchant id. A not-ready group (Aroma Nordic) is honestly
`config_incomplete` and the checkout reads `PARTIALLY_PAID`. Payment
promises: **paid is locked and never collected twice**, only failed
groups retry, the idempotency key never changes, incomplete config
must be fixed before retrying. `GET /checkouts/:id/status` is the one
status door. `provider_ref`/`legal_doc_ref`/`tax_rules` are reserved
fields awaiting the provider and fiscalization decisions.

**Loyalty is a ledger.** Points are money the salon owes: every
change is a ledger row (redeem at the till, earn on the *paid* total
— round(total/60) — with the invoice number attached); the customer's
`points` is the derived balance, reconciled at seed time with opening
balances. The Premium ×1.5 multiplier stays HQ configuration for
Phase 9.

**Codes.** `POST /till/validate-code` is the one validator for promo
codes (window, usage limit, case-insensitive) and gift cards
(balance) — the till and later surfaces cannot drift.

**Stock at sale time.** Sold products write `sale` movements;
services consume own-use per `service_recipes` (a sports massage
takes 25 ml arnica oil and 1.4 m couch roll), opening containers from
stock as needed and reporting shortages honestly the moment they
happen. Own-use products are refused as sale lines.

**Online payment is a sale (2026-09-22).** When a customer pays a
booking from the Velnes app (CONSUMER-APP › Paying), the money lands
here, not beside here: `settleSale()` — `finishSale` split so the
till's signed-in employee and the Velnes app are both just a
`SaleActor` — writes the same invoice (method `Online card` or
`Apple Pay`, the professional as employee, actor "Velnes app"), the
same routed checkout and merchant transactions (now stamped with the
provider's `provider_ref`), the same gift-card balance and promo
counter, the same personal-offer redemption, the same audit line
(source `Velnes app`). So the drawer says paid because an invoice line
says so, the till stops offering the appointment, and the reports
count the revenue — nothing special-cased. The provider is a mock
(`payments.service.ts › mockCharge`: Luhn, expiry, a card ending 0000
declines) until one is chosen, exactly like the mail transport.
`validateCode()` is the one code door for the app too.

**Seed.** The prototype's gift cards, four promo codes across their
lifecycle states, loyalty config + reconciling ledger, the recipes,
historical invoices CEN-2026-0409..0412 and the counter at 413.

## Products reserved with an app booking (2026-10-01)

A consumer can add products to a visit when booking in the Velnes app
(`appointment_products`, see `docs/CONSUMER-APP.md`). The till treats
them as what they are — a reservation: when such an appointment is rung
up (tapped on Today's, or sent from the drawer's Take payment), its
products follow into the basket as ordinary product lines at this
location's shelf price, marked "With the booking", removable and
re-countable like any line. The sale door is unchanged; the same lines
would have been typed by hand. Paid online, the app's pay door already
wrote those lines, and the appointment leaves the till as before.

## Due payments (2026-10-01)

The till's second tab, **Due**, lists the visits that happened and were
never paid — booked or confirmed, their end already passed in the
location's clock, and no line on a non-refunded invoice referencing
them (the same test `toContract`'s `paid` makes). Cancelled, no-show
and still-requested visits owe nothing. One door, `GET /till/due`
(`DuePaymentsSchema`, `listDue`), per location, oldest first, bucketed
on the tab by age (earlier today, yesterday, this week, older); the tab
carries the count. A tile rings up exactly like a Today's appointment —
the appointment line and the products reserved with it — and the sale
takes it off the list. **Deferred:** a deposit taken at booking is shown
on the row (`deposit`, `due = price − deposit`) but the sale door still
charges the appointment's price; netting a deposit at the till is not
built. `till/till.due.test.ts`, `till/Till.test.tsx`.

## Phase 0 of invoicing — the ledger adds up (2026-10-06)

Before the accounting invoice is built on top of it
(`docs/INVOICING-PLAN.md`), the till's own figures were made
trustworthy. `invoice_lines.unit_price` had always been the unit price
*after* the line discount, rounded, with `line_discount` stored beside
it; Reports, the cash drawer and a customer's sale history then took
`qty × unit_price − line_discount` and subtracted the discount a second
time, and the rounding of `unit_price` could lose up to `qty − 1`
denars against the receipt's total. Migration 20261006150000 adds
`invoice_lines.amount` — the exact line total after its discount,
written by the sale door, backfilled as `qty × unit_price` for history,
filled by a trigger when a writer omits it — and every reader now sums
`amount`: the Reports panes and VAT block, the Flightdeck, the customer
upsell figures, the ranking's upsell turnover. The cash drawer and the
customer's sale history read `invoices.total`, the one total the sale
door wrote. Appointment lines take the service's own VAT rate instead
of a hard-coded 18, falling back to Settings → Sales → default VAT only
when the service is gone; the rate stays snapshotted on the line. The
Reports VAT block lists every rate the lines actually carry and splits
the net out of the gross through the one billing-math door
(`packages/contracts/src/billing-math.ts`: integer minor units, basis
points, half-up once per line, totals as sums — the module the
accounting invoice will use). Payment methods are one list
(`PAYMENT_METHODS`: Cash, Card, Gift card, Bank transfer, Online card,
Apple Pay): the sale door validates it, and a `CHECK … NOT VALID` on
`invoices` and `merchant_transactions` fences new rows without
refusing a historical one — validate it after production's distinct
values are confirmed. `till.amounts.test.ts` and
`billing-math.test.ts` carry the cases. Still honest: cart-level
deductions (cart discount, points, gift, promo) live on the receipt,
not allocated to lines, so the VAT block is on line amounts before
them — the accounting invoice allocates them per line (plan C.5).

