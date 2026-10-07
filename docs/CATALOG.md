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

## Combos — the till's Packages (2026-09-04)

A combo bundles services and products into one sellable line, exactly
the prototype's `combos`. The **Combos** tab (previously an empty
"arrives later" pane) now carries the real table — name, includes,
regular vs combo price, an on-till toggle, Edit — and a right-hand
panel (`ComboPanel`) that adds/edits a combo with a checkbox roster of
services and products, per-item quantities, category, validity, prices
and a Delete action. One door: `combos` (migration 20260904190039,
tenant-scoped RLS, items as validated JSONB) behind `GET/POST/PUT/PATCH/
DELETE /combos`, gated by `catalog.edit`. Every item is checked against
the tenant's own catalog before the combo will save (422 `BAD_ITEM`
otherwise) — a combo can never become a text-only line. The seed
carries the prototype's two packages (Recovery start pack, Assessment
with home kit). Honest deferral: **selling** a combo at the till (booking
its services and deducting its products from stock) is the next
increment — this delivers creating and managing them.

## A price edited in the panel is saved where it is read (2026-10-01)

Two things made a price edit look unsaved. The list, the booking engine
and the till read the **location rows** (`location_catalog_services`,
`location_catalog_products`), while the panel's PUT wrote only the
salon-wide `services.price` / `products.price`; the seed gives every
location a row, so the number on screen never moved. Now `updateService`
carries a changed price (and duration) to every location row that is
not that location's own: a row becomes its own only when someone sets
its price (or duration) for that location — the inline cell, the
panel's per-location table, the override door — which flips
`location_catalog_services.custom_price` / `custom_duration`
(`20261001150000_location_price_custom.sql`; nothing is custom until
set, so rows the old bug left behind heal on the next salon-wide
edit). Un-marking a row is not built. `updateProduct` carries the price to every shelf
row — the workspace has no per-location product price, so there is
nothing to preserve — and the active flag likewise. And the assistant's
floating button shared the corner with the panel's Save, so a click
could land on it: it hides while a panel is open.
`catalog/catalog.price.test.ts`.

## Removing a length (2026-10-01)

Taking a duration out of a service in the panel used to delete the
`service_variants` row — and a length that was ever booked is referenced
by appointments (and by personal offers and measured pace), so the
delete failed and the save died with a message at the end of a scrolled
panel. Now `reconcileNested` **retires** a referenced length
(`retired_at`, `20261001160000_variant_retired.sql`): `svcVariants`
leaves it out, so the catalog, the booking page and the till no longer
offer it, while the visits that carry it keep their `variant_id` and
snapshotted `variant_label`. A length nothing references is deleted as
before. Removing the standard one promotes nothing, because the flag no
longer decides what gets booked (Alex, 2026-10-02): **no choice means
the service itself** — `svcChoice` answers the base minutes and price
whatever is marked, the salon page's Standard card quotes them, and
every length is an upsale beyond it. The standard flag only says which
length the booking page and the workspace preselect where a length
must be picked, and whose price the salon card shows as "from"; a click
on the already-marked radio clears it. The panel's save error now sits
in the footer beside Save, where the eye is.
`catalog/catalog.variants.test.ts`, `catalog/Catalog.test.tsx`.

## Product promotions (2026-10-07)

A salon puts one of its own products on promotion for a period: a
percentage off (1–90 %) or a promo price (below the regular price).
`product_promotions` keeps one live-or-scheduled promotion per product
(a partial unique index); a new one is refused with `409` while one is
running or scheduled; **End now** ends it early (`active = false`,
`ended_at`) and the history stays — nothing is deleted. Doors:
`GET/POST /products/:id/promotions` and `POST
/products/:id/promotions/:pid/end` (`catalog.edit`), each write audited
with before/after. The effective price is decided in one function,
`promoPrice` in contracts, and applied by `prodAt` — the resolver the
till and booking checkout already price products through — so the till
charges the promo price while it runs, a booking takes the product home
at it, the catalog screen shows it beside the regular price (and a Promo
badge), and the till's tiles show it. The Workspace catalog table has a
**Promo** button per product that opens the right-hand promotion panel.
What is not here: promotions on services, stacking, and per-location
promotions (a promotion applies to the product at every location, each
at that location's price).

