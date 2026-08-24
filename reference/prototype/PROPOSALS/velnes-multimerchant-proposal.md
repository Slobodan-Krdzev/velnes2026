# Proposal — Multi-merchant / multi-legal-entity commerce domain · 20 aug 2026

**Status: awaiting Alex's approval. No code has been changed.**
Base build: `f071e71dba802576f13a3b60abae73f2` (19,999 lines).
Source: Alex's architecture brief (docx, read in full). Scope honours its
§15 hard limit: **domain + routing + UI readiness — no money movement.**

## The principle, in one line

One customer checkout — multiple legal sellers and merchant transactions
behind the scenes. Nobody at the till ever picks a merchant; routing is
configuration, resolved through one door.

## A. Data model (answers brief Q1–Q4)

Four new first-class arrays, platform-consistent with how the prototype
already models domains:

**`legalEntities`** — reusable, owned by a salon *or* a supplier
(`ownerType:'salon'|'supplier'`, `ownerId`). Fields per brief §4: legal
name, tax/company identifiers, VAT registration, currency, status
(`verified`/`pending`/`incomplete`), `fiscalProfileId`, valid locations.
Not a `merchantId` field on the salon — a salon can grow a second entity
without a migration.

**`paymentAccounts`** — one per entity per provider
(`legalEntityId`, `provider`, `merchantId`, `settlementRef`,
`status:'active'|'pending'|'incomplete'`). Merchant ID lives here, not
on the entity (Q2: through provider-specific records), so a provider
switch later is a new row, not a schema change.

**`taxProfiles`** — id, label, rate, legal basis note. Referenced by
items; **never** derived from service-vs-product (§12). The seeds mirror
today's reality (5%/18%) but as data, not code.

**Seller assignment** (Q4): `sellerLegalEntityId` on every service and
product, resolved via one door — `sellerFor(item)`: explicit assignment
wins; otherwise the owner's **default entity**. Single-seller salons
configure nothing and feel nothing. Supplier retail products
(`use:'retail'`) seed with the supplier's entity — the gel routes to
BeautyPro's entity from birth.

Seeds: the salon gets one verified entity + active account; **sup1
(BeautyPro)** gets a complete config; **sup2 (Aroma Nordic)** gets a
deliberately `pending` account with no merchantId — so the missing-config
states are demonstrable everywhere they must show.

## B. Checkout → CheckoutItem → MerchantTransaction (Q5, Q7, Q8)

`finishSale` today writes one invoice. It will additionally write the
commerce objects the brief names:

- **`checkouts`** row: the parent — full basket snapshot, customer, one
  total, `status`.
- Each line becomes a **CheckoutItem** carrying
  `sellerLegalEntityId`, `taxProfileId`, and later its
  `merchantTransactionId` — the refund thread of §11: return only the
  gel, and the item points at exactly the transaction that paid for it.
- **`merchantTransactions`**: one per (paymentAccount) group, with
  `amount`, `status`, `providerRef:null`, and an `idempotencyKey` minted
  now (Q7) so the future payment layer can never double-charge a
  succeeded group.

States, honest to §10: transactions `pending → paid | failed`
(failed is retryable; paid is locked); checkout derives
`PAID / PARTIALLY_PAID / FAILED`. In the prototype, cash/card at the
till marks all groups paid in one act — but a **demo control on the
checkout detail** ("Fail this transaction · demo", same honesty pattern
as "Advance stage · demo") lets us show partial success, locked-paid,
and retry-only-the-failed without pretending a provider exists.

## C. Routing engine (Q6, Q12)

One pure door, next to `priceFor` in spirit:
`routeCheckout(lines)` → item → seller entity → payment account → tax
profile → groups. Screens never group; the till, the checkout detail,
and any future API all call it. Provider-agnostic by construction: it
ends at `{accountId, amount, items[]}` and knows nothing about how money
moves — the future provider adapter consumes its output (§9).

**Validation (Q11):** `sellerReady(item)` — entity exists, account
active, merchantId present, tax profile set. The till surfaces this at
add-time: an item whose seller config is incomplete gets a warning badge
and, per the brief, is blocked from checkout with a plain-language
reason ("Aroma Nordic's payment account is still pending — HQ can
complete it"). Nothing silently routes to the wrong pocket.

## D. The three UI surfaces (§5, Q9, Q10)

1. **Supplier Portal** — new **Payments** card in the portal's settings
   area: legal entity, Merchant ID (shown as identifier, never
   secrets), provider, account status badge. Read-only in V1, exactly
   per brief.
2. **Revelapps HQ › Suppliers** — merchant column on the list
   (entity · merchantId · status) plus a **"Missing config"** filter
   chip; the supplier detail body gets the full account block. This is
   the diagnosis surface (§13) — and HQ is where sup2's `pending` row
   visibly begs for completion.
3. **Salon Workspace › Settings** — a modest **Legal & payments** card:
   the salon's own entity, its merchant account, status. Simple on
   purpose (§5: only what the salon needs).

**Permissions (Q10):** viewing merchant config in the salon workspace
rides the existing settings gate; editing entities/accounts is
HQ-only in V1 (matching "HQ manages suppliers for now" from the
roadmap decision). The Supplier Portal sees only its own entity —
same tenant-projection discipline as Premium.

## E. What explicitly does not change / not built (§15)

No provider integration, no funds movement, no settlement, no fiscal
device. `priceFor` is untouched — pricing decides *how much*, routing
decides *to whom*; the two doors compose at the till and never merge.
Invoices keep working exactly as today; checkouts are written alongside,
not instead.

## F. Tests — new `test-merchant.js` (~40 checks)

Seller resolution (explicit beats default; supplier product routes to
supplier); validation blocks incomplete sellers at the till with the
honest message; a mixed sale produces one checkout + two transactions
whose amounts sum to the invoice total; demo-fail → PARTIALLY_PAID,
paid group locked, only failed retryable, idempotency key stable across
retries; item→transaction linkage survives for the refund thread; the
three UI surfaces show what §5 demands and never render secrets; sup2's
pending state flagged in HQ. Regression: pos, pricefor, screens,
rolekits, portal/HQ-touching suites.

## G. Answers filed for the backend (brief §16, beyond prototype scope)

Q3 (one source of truth): entities/accounts live in platform tables;
Portal and HQ are projections of the same rows — prototyped exactly so.
Q9 (APIs): read endpoints per surface + HQ write endpoints; contracts
mirror the arrays above 1:1. These go into the monorepo contracts
package when the .NET/Node build starts; the prototype's row shapes are
the draft.

## Definition of done

Mixed basket routes to two transactions on one checkout; partial-fail
demo behaves per §10; all three surfaces show merchant config with sup2
flagged; validation blocks unready sellers; all suites green; chain +
addendum + a `MULTI-MERCHANT-DOCS.md` in DOCS/.
