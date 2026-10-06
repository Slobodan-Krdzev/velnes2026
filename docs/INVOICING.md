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
