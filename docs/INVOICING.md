# Invoicing — what is built (2026-10-06)

The build log for the accounting-invoice system whose architecture is
`docs/INVOICING-PLAN.md`. Each phase ends with what it deliberately
left out. Phase 0 (the till ledger's arithmetic) is in `docs/TILL.md`.

## Phase 1 — issuer profile, billing identities, permissions

### Who the issuer is, and who owns which field

The issuer of an accounting invoice is the **legal entity**. The salon
brand and the location are not issuers: one legal entity can invoice
for every location linked to it (`legal_entity_locations`) without
repeating its identity. Field ownership, decided and recorded here:

| Field | Owner | Why |
|---|---|---|
| Legal name, ЕДБ (`tax_id`), VAT number (`vat_reg`), currency, verification status | `legal_entities` | Identity, verified by HQ at registration; the invoice's issuer block is a snapshot of these |
| ЕМБС (`embs`, added by migration 20261006170000) | `legal_entities` | Identity too; registration never collected it, so the salon fills it through the billing door |
| Registered (seat) address, "VAT registered" as declared, bank, series, numbering, defaults, signatory, footer, payment instructions, contact, logo, issue mode | `billing_profiles` | Configuration an invoice needs, not identity; one row per legal entity |
| Trading name | `businesses.name`, overridable per profile (`trading_name`) | The brand is the salon's; the invoice shows it beside the legal name |
| Place of supply, its address and its clock (`tz`) | `locations` | The supply date is the location's day, never the server's — the profile read carries each linked location's `tz` for the later issue step |

The salon may write ЕМБС freely, and may fill the VAT number while the
entity has none or is unverified; once HQ has verified the entity, the
VAT number changes only through HQ (`422` from the salon side). Legal
name and ЕДБ stay read-only in the workspace, as before.

### Tables (migration `20261006170000_billing_phase1.sql`)

`billing_profiles` (PK `(tenant_id, legal_entity_id)`, `UNIQUE
(legal_entity_id)`), `billing_customers` (buyer identities, `kind`
person|company, `customer_id` nullable), `billing_consent_events`
(append-only: SELECT + INSERT policies only, like the audit log), plus
`legal_entities.embs`. All under `FORCE ROW LEVEL SECURITY` with
`tenant_isolation`; profiles readable by HQ.

### Completeness — one evaluator

`evaluateBillingProfile` in `packages/contracts/src/billing.ts` is the
single verdict: `{ complete, missing[], invalid[{field, reason}] }`.
Required: legal name, ЕДБ, seat address, city, postal code, country,
authorised signatory (ЗДДВ чл. 53(10) т. 10); the VAT number when
`vatRegistered`. Rejected: a default VAT rate on a non-registered
profile (nothing invented), bad identifier shapes, a non-ISO currency,
a bad or duplicated series prefix, a width outside 4–8, a bad contact
email or account number, an entity HQ has not verified. The settings
page shows the server's result; it never computes its own. The issue
door (phase 3) will refuse on the same function. Identifier shapes are
structural and marked `[confirm]` for the accountant: ЕМБС 7 digits,
ЕДБ 13 digits (often written MK+13), VAT number MK+13.

### Billing identities and consent

A billing identity is a person (name; address optional) or a company
(legal name, seat, ЕДБ required; VAT number optional), linked to a
Velnes customer or standing alone — a walk-in or a manual invoice needs
one too. Saving one never touches the `customers` row. Electronic
invoice consent (ЗДДВ чл. 53-б) is explicit: a person records it with a
note, `consent_electronic_at` holds the standing state, and every grant
or withdrawal is a row in `billing_consent_events`, immutable for the
API role, so a document sent later can show what stood at the time.
Nothing infers consent from an email, an account, marketing, terms or
an online booking.

### Doors and permissions

`GET /billing/profiles`, `GET|PUT /billing/profiles/:legalEntityId`
(`billing.settings`); `GET|POST /billing/customers`,
`GET|PATCH /billing/customers/:id`, `POST
/billing/customers/:id/consent` (`billing.create`). A foreign id is
`404` under RLS. Two keys were added to the vocabulary, in a new
**Invoicing** group: `billing.settings` (business scope only) and
`billing.create`. `ownerPermMap()` grants both to owners by
construction; the migration grants both to existing roles holding
`users.manage` at business scope and `billing.create` at the till
scope to roles holding `pos.checkout`; the standard Employee kit now
carries `billing.create: location`. No other invoicing right exists
yet.

### Workspace

Settings → **Invoicing** (`iset.*`): one form per legal entity grouped
as legal identity (HQ fields read-only), registered address, tax/VAT,
bank, invoice defaults, numbering (with a live `2026-000001` /
`KO-2026-000001` preview and the note that drafts carry no number),
authorised signatory, contact and branding; the completeness banner
names each missing or invalid field. Customer → **Billing details**
(`cbill.*`): the identity for that customer, person or company, and the
consent card with its history. Both only with their right.

### Tests

`packages/contracts/src/billing.test.ts` (the evaluator and the write
contracts on their own), `services/api/src/modules/billing/billing.test.ts`
(profile defaults, save, one per entity, non-VAT complete without a VAT
number, VAT-registered needs one, HQ-verified VAT number not rewritable,
numbering and identifier validation, currency round-trip, company and
person identities, linked and standalone, foreign customer refused,
consent given and withdrawn with history kept and undeletable, Employee
kit may create identities but not touch settings, another tenant's
owner can neither read, write nor discover the demo salon's profile or
identities, a sale still goes through with no profile at all), and the
workspace tests for both screens.

### Deferred, honestly

Nothing in this phase issues, numbers, renders, pays, corrects or
emails an invoice — phases 2–8. The accountant's confirmations in the
plan's section I still stand; the identifier shapes above are
structural until then. The payment-method CHECK from phase 0 stays
`NOT VALID` until production's distinct values have been inspected.

## Phase 2 — the draft accounting invoice

### What a draft is

A `billing_invoices` row of kind `invoice` and status `draft`, built
once from a paid till sale (`POST /billing/invoices { saleId }`) under
an advisory lock on the sale, so a double click, a retry or two desks
at once find the same document; a partial unique index on
`(tenant_id, origin_sale_id)` backs that at the database. It has no
number and consumes none — `number`, `series`, `issued_at` stay NULL
until phase 3. It is never deleted; there is no DELETE policy.

### Snapshots (what the document remembers at creation)

| Snapshot | Taken from | Frozen for the draft |
|---|---|---|
| `issuer` | `legal_entities` (legal name, ЕДБ, VAT no, ЕМБС) + `billing_profiles` (seat, bank, signatory, contact, footer, payment instructions) + `businesses.name` as the trading name unless the profile overrides it | yes |
| `location` | `locations` (name, address, clock `tz`) | yes |
| `buyer` | the chosen `billing_customers` row; else the sale's customer's only identity; else the customer's name alone; else nobody (walk-in) | yes — re-taken only by an explicit PATCH of `billingCustomerId` |
| `origin` | the sale: number, date, method, employee, and every deduction in minor units with the `[confirm]` flags it relies on | yes |
| lines | `invoice_lines` (description, qty, class, catalog ids, **`amount`**, `vat`) | yes |
| `currency`, `vatRegistered`, `pricesIncludeVat` | the profile at creation | yes |
| `supplyDate` | the sale's `created_at` in the **location's** clock, never the server's | editable |
| `dueDate`, `notes` | — | editable |

Later changes to the catalog, the identity, the brand or the profile
never reach an existing draft (tested); a new sale's draft sees today's
world. The profile's logo is not snapshotted yet (a data URL per
document is a phase-4 decision: snapshot or reference).

### Money — the reconciliation invariant

Everything is in minor units (the till's whole denars × 100) and goes
through billing-math only:

1. Each till line's exact `amount` is the line's source amount.
2. The sale's **price reductions** — cart discount, promo code, and the
   loyalty value — are spread over the lines in proportion to their
   amounts by `allocateDiscount` (largest remainder; deterministic).
   The loyalty value is not stored on the receipt; it is what remains
   once every stored figure is accounted for
   (`Σ amounts + tip + service charge − cart − gift − promo − total`).
3. Each line: `gross = amount − allocated`, then one half-up split into
   net and VAT at the line's own rate (gross-priced; VAT-inclusive
   prices are decision 3). A non-registered issuer gets rate 0, VAT 0,
   `exempt` true.
4. Totals and the breakdown by rate are **sums of the lines**.
5. Before the row is written, both readings must agree:
   `Σ line gross = Σ amounts − cart − promo − loyalty = sale total − tip − service charge + gift tender`;
   otherwise the draft is refused (422), never fudged. Database CHECKs
   repeat `net + vat = gross` per line and per document and
   `gross = source − allocated` per line.

### Till concepts and their treatment

| Till field | Treatment on the accounting invoice | Status |
|---|---|---|
| line `amount` (after line discount) | taxable base per line | settled (phase 0) |
| `cart_discount` | price reduction, allocated to lines, reduces the VAT base | approved allocation |
| `promo_amount` (discount code) | price reduction, allocated like the cart discount | **[confirm]** flag `promo_as_discount` |
| loyalty points value (derived) | price reduction, allocated like the cart discount | **[confirm]** flag `loyalty_as_discount` — a salon-funded discount is the usual reading; an accountant may want it shown separately |
| `gift_amount` | **means of payment**, not a discount: inside gross, recorded as tender | **[confirm]** flag `gift_card_as_tender` — hinges on whether the gift card was a single- or multi-purpose voucher when sold |
| `tip` | gratuity, outside the supply and the document | **[confirm]** flag `tip_excluded` |
| `service_charge` | **no agreed treatment — a sale carrying one is refused** | open |
| refunded sale | refused; belongs to a credit note (phase 6) | by design |
| online payment (`Online card`, `Apple Pay`) | same lines, same math; the method is remembered in `origin` for the payment phase | settled |

### Doors, rights, reach

`POST /billing/invoices`, `PATCH /billing/invoices/:id`
(`billing.create`); `GET /billing/invoices`, `GET /billing/invoices/:id`
(`billing.read`, new; owner-shaped roles get it at business scope, roles
with `billing.create` at that same scope, the Employee kit at
`location`). Reach follows the role's scope: `business` sees every
location, `location`/`locations` the employee's own (`claims.locs`), so
a desk at Aerodrom neither lists, reads, drafts from nor changes a
Centar document (404, not 403 — nothing is disclosed). RLS cuts the
tenant beneath that. Edits (drafts only): the buyer (re-snapshot from
an identity, or back to the sale's customer), supply date, due date,
notes; `legalEntityId`, `locationId`, `originSaleId` and every amount
are not accepted by the contract and cannot change. Creation and
changes write the audit log and `created_by`/`updated_by` on the row;
the richer `billing_events` arrive with issuing.

### Phase 3 preparation at the database

Two triggers already guard the future: an `issued` row refuses any
change to its status, number, snapshots, money, dates, entity, location
or origin (notes and the later payment, PDF-hash and reference columns
remain writable), and the lines of an issued document refuse insert,
update and delete. Tested from the database owner's path.

### Workspace

A new **Invoices** tile (`billing.read`) opens the accounting list —
titled and worded apart from the till's receipts, with a link to them.
Tabs All and Draft work; Issued, Unpaid, Paid and Credited are present
but disabled until their phases. The draft preview shows issuer, buyer
(with what it still lacks for issue), place of supply, lines with
quantity, net, VAT % and VAT for a registered issuer and gross for all,
the VAT breakdown, discounts, totals, the gift tender and tip outside
the document, who drafted and changed it. A paid receipt under the cash
register offers "Draft accounting invoice" and lands on the draft.
Nothing is computed in React; minor units are formatted with two
decimals. Checkout is untouched: no draft is created automatically.

### Tests

`drafts.test.ts` (plain sale; discounted mixed-rate multi-quantity sale
with deterministic allocation; tip outside; service charge and refunded
sale refused; non-VAT issuer; buyers — identity, name, explicit, an
incomplete company, a foreign identity; history stays after catalog,
identity, brand and profile edits; one draft per sale under a burst of
four concurrent creates; editing — allowed fields change, structural
and money fields do not; reach for the Aerodrom desk; list filters;
another salon's owner; the frozen-row triggers) and the workspace
tests (list, registered and non-registered previews, the receipt door).

### Deferred, honestly

Issuing and numbering (phase 3), the PDF (4), payments (5), credit
notes and void (6), auto-draft on checkout (7), email (8). The four
`[confirm]` treatments above and the service-charge rule are decisions
for the accountant before issuing goes live.

