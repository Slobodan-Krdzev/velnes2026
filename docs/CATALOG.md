# Phase 2 — Catalog & pricing

**One master item, per-location rows.** A service or product exists
once (`services`/`products`: identity + shared content); everything
commercial or operational that differs per location lives in
`location_catalog_services` / `location_catalog_products`. Resolution
is one door: `svcAt` (override row, else the master's own values;
master active = not draft), `svcVariants` (variants inherit price and
duration from the master variant, overridable and switchable-off per
location), `svcChoice` (chosen variant → the `std` one → first active;
without variants, the service itself) — one function so calendar,
till and booking flow never drift apart. `GET /locations/:id/catalog`
serves the fully resolved world.

**Modifiers.** Groups (`single`/`multi`, `required`) with options that
carry a price (negative allowed — "small group −600") and minutes.
`modTotals` sums them; `modMissing` names unsatisfied required groups
and is enforced where booking/checkout happens.

**Pricing.** `GET /price` is `priceFor`, THE single pricing door. The
response shape is final: `{ base, options, best, effective, choices,
hasChoice, discounted }`. Phase 2 serves the list price (variant at
location, else `svcAt`); last-minute, personal and member offers
append options in Phases 8–9 without touching the contract. Money is
whole MKD denars (integers), as in the prototype.

**Line quotes.** `POST /catalog/line-quote` is `svcLine`: price =
choice + modifiers (clamped ≥ 0), treatment = duration + modifier
minutes (≥ 5), prep/reset from location → master → defaults (0/10,
all zero when timing is off), `operationalMin` = prep + treatment +
reset. Duration basis is `catalog`; Phase 3's `effTreatment` plugs in
here.

**Stock.** `POST /stock/movements` is the one stock door: an
append-only ledger (`stock_movements`) plus a materialized quantity,
written in the same transaction. Transfers write both sides atomically
under one ref; stock never goes negative and is never copied. Own-use
products (price 0, cost tracked) are never sellable (`pos=false`).

**Readiness completed.** `locReadiness`'s service and staff checks now
query the real catalog: a bookable service at the location, and an
active bookable employee assigned there whose skills include one.
Owner-only activation is fully tested: a manager holding
`locations.manage` still cannot activate.

**Catalog writes.** `POST/PUT /services` (nested variants/modifiers
reconciled by id), `POST/PUT /products`, per-location override
PATCHes — all behind `catalog.edit`; every price change is audited
with before/after.

**Seed.** The prototype's catalog verbatim: 8 services, variants on
s2/s6/s8, 9 modifier groups, employee skills, 7 retail + 3 own-use
products (BeautyPro sells the arnica oil — the multi-merchant seam for
Phase 4), opening stock at Centar entered as real ledger movements.
