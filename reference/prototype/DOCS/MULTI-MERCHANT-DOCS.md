# Multi-merchant / multi-legal-entity — domain docs · 20 aug 2026

**Build:** landed on top of `3caffdb1…` (20,185). Suite: `test-merchant.js`, 47 checks.
**Scope per Alex's approval:** domain + routing + UI readiness. NO legal
invoices, NO fiscalization, NO payment splitting/execution — those wait
for finalized legal and provider requirements. **Checkout UI unchanged
by contract** (verified by test).

## Principle

One customer checkout — multiple legal sellers and merchant transactions
behind the scenes. `priceFor` says how much; `routeCheckout` says to
whom. The two doors compose at `finishSale` and never merge.

## Domain (all top-level, near the supplier domain)

- `taxProfiles` + `taxRules` — entity + itemClass → profile, as data.
  '*' rows are the base rule; entity-specific rows win. Never derive
  tax from service-vs-product in code (brief §12).
- `legalEntities` — reusable, `ownerType:'salon'|'supplier'` + `ownerId`,
  `isDefault`. Seeds: le-velnes (verified), le-beautypro (verified),
  **le-aroma (deliberately `pending` — the honest missing-config demo)**.
- `paymentAccounts` — merchantId lives HERE, per entity per provider.
  pa-aroma-1 is `incomplete` with empty merchantId, by design.
- `checkouts` + `merchantTransactions` — written by finishSale.

## Doors

- `defaultEntityFor(ownerType,ownerId)` · `accountFor(le)` ·
  `sellerReady(le)` (entity verified + account active + merchantId).
- `taxFor(itemClass,le)` — the data lookup.
- `classifyLine(l)` → service | product | other (appointment lines are
  services via their sid).
- `sellerForLine(l)` — explicit `sellerLegalEntityId` on the
  service/product row wins; otherwise the salon's default entity.
  Seeded example: **p2 (arnica oil) → le-beautypro**.
- `routeCheckout(lines)` → `{items,groups}` — groups keyed by payment
  account. Pure; screens never group.
- `checkoutStatus(coId)` — PAID / PARTIALLY_PAID / FAILED derived from
  its transactions.
- `mtxDemoFail(id)` / `mtxRetry(id)` — **doors without UI** (checkout
  UI contract). Semantics the future payment layer inherits: paid is
  locked forever; only failed retries; `config_incomplete` refuses
  retry (config first, then money); idempotencyKey never changes.

## finishSale writes (invisible at the till)

One `checkouts` row (invoice ref, total, items) + one
`merchantTransactions` row per group. Cash/card today: ready groups →
`paid` in one act; unready sellers → `config_incomplete`, surfacing in
HQ, never silently misrouted. `providerRef` and `legalDocRef` stay
null — reserved seats for the payment provider and fiscalization
milestones. Every CheckoutItem carries `merchantTransactionId` — the
refund thread: return only the gel, touch only the supplier's
transaction.

## UI surfaces (the only visible changes)

1. **Settings › Company** — "Legal & payments" card: own entity, tax
   number, Merchant ID, provider, Ready/Incomplete badge. Read-only;
   "managed by Revelapps HQ".
2. **Supplier Portal › Dashboard** — "Payments" card for the portal's
   own supplier (sup1): entity, Merchant ID, provider, settlement (as
   stored, masked-style seed), status badge, read-only note. Never
   secrets.
3. **HQ › Suppliers** — Merchant column (MID · entity · Active/Missing
   config badge; "No legal entity" for sup3), **"Missing config · N"
   filter chip** (`data-hqmiss`, registered in the delegated-click
   selector, state `hqSupMiss`), and an account block at the top of the
   supplier drawer.

## Decisions recorded

- **Invoices:** the operational invoice stays singular (customer
  summary). Legal per-entity documents are a future milestone;
  `legalDocRef` is their reserved seat. Resale-vs-marketplace per
  product relationship = which `sellerLegalEntityId` the row carries —
  a business/VAT decision, to be settled with an accountant.
- **Basket-level reductions** (points, gift cards, promo) are not yet
  apportioned across merchant groups — item amounts are line-level;
  checkout.total is the charged total. Apportioning rule = payment
  milestone. (Open item.)
- Editing entities/accounts: nowhere in V1 — HQ-only later.

## Pitfalls

- After `finishSale`, the till sits on the rebook screen (`state.sale`)
  — suites must null it before reopening the register (bit both
  test-pricefor and test-merchant).
- `data-hqmiss` lives in the second delegated-click registry string.
- Aroma's incompleteness is load-bearing for tests and demos — don't
  "fix" the seed.
