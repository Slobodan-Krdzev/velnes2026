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

**Seed.** The prototype's gift cards, four promo codes across their
lifecycle states, loyalty config + reconciling ledger, the recipes,
historical invoices CEN-2026-0409..0412 and the counter at 413.
