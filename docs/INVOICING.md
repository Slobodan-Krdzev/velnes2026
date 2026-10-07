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

Issuing and numbering (phase 3 — **built**, below), the PDF (4),
payments (5), credit notes and void (6), auto-draft on checkout (7),
email (8). The four `[confirm]` treatments above and the service-charge
rule are decisions for the accountant before issuing goes live.

## Phase 3 — issuing: the number, the freeze, the timeline

Built 2026-10-07 (Alex's approval of phase 2 and the phase-3 brief).
The transition `draft → issued`, irreversible by design: there is no
`issued → draft`, no delete, no edit of an issued document; a mistake
is corrected later by a credit note (phase 6). Nothing here renders a
PDF (phase 4 renders exclusively from what phase 3 freezes).

### Decisions this phase fixed

- **Accounting treatment, for now**: promo codes and loyalty value are
  price reductions allocated over the lines; a gift card is tender; a
  tip is outside the document; a **service charge is unresolved** and
  a sale carrying one is still refused (no tax treatment is invented).
  The flags on the draft's origin stay for the accountant.
- **Numbering**: one sequence per *legal entity × series × calendar
  year*, yearly reset; the default invoice format is `2026-000001`
  (credit notes `KO-2026-000001` later). The year is the **issue date
  in the location's time zone**, never the server's UTC day.
- **Logo**: not frozen at draft time (a draft shows the profile's
  current logo); frozen **at issue** by content.

### Tables (migration `20261007100000_billing_phase3_issue.sql`)

- `billing_sequences (tenant_id, legal_entity_id, series, year,
  last_seq)`, PK on all four keys. `series` is the configured prefix of
  the document kind (`''` for the default invoice series); `year` is
  the legal issue year, or `0` for a series that does not reset.
  Advanced only inside the issue transaction (below). RLS; no DELETE
  policy.
- `billing_events (invoice_id, at, actor, source, kind, data)` — the
  document's own timeline: `created`, `edited`, `issued` live now; the
  later kinds are reserved. **Append-only for everyone**: RLS offers
  SELECT and INSERT only, and a trigger refuses UPDATE and DELETE even
  from the database owner. Existing drafts were given their `created`
  event from their own row.
- `billing_assets (tenant_id, sha256, kind, mime, bytes, data)` —
  content-addressed, immutable copies of the branding an issued
  document used. Insert-only by RLS, UPDATE/DELETE refused by trigger.
  A thousand invoices with the same logo store it once; the profile's
  logo may change tomorrow without touching yesterday's document.
- `billing_invoices` gained `issue_key` (unique per tenant), `issued_by`,
  `issued_by_name`; a unique index on `(legal_entity_id, number)` so
  the rendered string is unique in its own right beside the
  `(entity, series, year, number_seq)` index; and a CHECK that a draft
  has none of the number facts while a non-draft has all of them.

### The issue door — `POST /billing/invoices/:id/issue` (`billing.issue`)

One transaction (`withTenant`), in this order:

1. lock the row `FOR UPDATE` (a second issuer waits, then finds it
   issued); reach by the role's scope as in phase 2;
2. **idempotency** by the body's `key` (the till's convention): an
   issued document with the same key is returned as is (a lost answer,
   a retry); with another key it is `409 CONFLICT` naming the number;
   a key already used by another document is `409` too;
3. refresh what is refreshed until issue — the issuer snapshot (entity
   + profile + brand), the place, and the buyer from its billing
   identity when it has one. The sale's money is **not** rebuilt: the
   draft is the transaction as it happened;
4. the issue date is `nowAt(location.tz)`; an unknown zone blocks;
5. **readiness** — one pure function, `evaluateIssueReadiness` in
   `@velnes/contracts`, which the GET door reports on every draft and
   the issue door refuses on, so they never disagree. It takes the
   Phase 1 `evaluateBillingProfile` verdict verbatim (issuer complete
   and verified), `evaluateBuyer` (a company needs name, address, city,
   ЕДБ; a person its name; no buyer is a warning, not a block), the
   clock, the dates (supply ≤ issue; due ≥ issue; a supply-to-issue gap
   over seven days is a **warning** — the five-working-day rule needs
   the holiday calendar, which is not modelled, so it is reported, not
   enforced), and every money invariant from billing-math over the
   **stored** lines: `net + vat = gross` per line, `gross = source −
   allocated`, the half-up split re-derived per line, exempt lines at
   zero, totals as sums, the breakdown equal to the grouped lines, the
   discount equal to the allocations, and the phase-2 origin equation
   both ways (`Σ gross = lines − cart − promo − loyalty = sale − tip +
   gift`). It also compares the live sale with the origin snapshot:
   still `Paid`, the same total, tip and gift, no service charge. Any
   problem → `422 ISSUE_BLOCKED` with the structured `problems`
   (`{part, field, reason}`) and **nothing below has run**;
6. the branding: the profile's logo is hashed (SHA-256 of the data
   URL), inserted into `billing_assets` if new, and referenced from the
   issuer snapshot as `logoSha256`/`logoMime`;
7. **the number, last**: an upsert-increment on the sequence row —
   `INSERT … ON CONFLICT DO UPDATE SET last_seq = last_seq + 1
   RETURNING last_seq` — one statement, one row lock, inside this
   transaction. Never `MAX(number) + 1`. The rendered number is built
   by `formatInvoiceNumber` from prefix, issue year, sequence and
   width; series, year and sequence are stored apart from the string;
8. the row: status, number parts, `issue_date` (a `date`),
   `issued_at` (`clock_timestamp()`, so the order of commits is the
   order of numbers), actor, key, the finalised snapshots;
9. the `issued` event (number, dates, entity, location, totals,
   currency, key, logo hash, warnings) and the platform audit row
   `Invoice issued · 2026-000001`.

A failure anywhere rolls everything back **including the sequence
advance**, so an ordinary failed issue never burns a number; the next
successful issue gets the number the failed one held. Tested at the
service level by throwing after allocation.

### Immutability

The phase-2 trigger became a **whitelist**: once `issued`, the only
columns of `billing_invoices` that may change are `paid_minor`,
`pdf_sha256`, `fiscal_receipt_ref`, `efaktura_euid`, `efaktura_status`
and the `updated_*` stamps. Everything else — status, kind, number,
series, year, sequence, entity, location, origin, every snapshot,
supply/issue/due dates, `issued_at`, currency, VAT state, net, VAT,
gross, discount, breakdown, **notes**, buyer link, actor, key — is a
historical fact and raises `frozen`. A `BEFORE DELETE` trigger refuses
deleting an issued row even for the owner. Lines of an issued document
refuse insert, update and delete. Thirty-one columns are tried one by
one in `issue.test.ts`.

### Numbering configuration

Once an entity has issued anything, `billing_profiles` refuses a change
to `invoicePrefix`, `creditPrefix`, `numberWidth` or `yearlyReset`
(`422`, "Numbering cannot change once an invoice has been issued"); the
profile reports `numberingLocked` and Settings → Invoicing disables the
four fields and says why. A new series is a decision for the
accountant, not a form field. The database stays the last word either
way (two unique indexes).

### Rights

`billing.issue` (scope none/location/locations/business) is in the
vocabulary and in `ownerPermMap`; the migration grants it only to
owner-shaped roles (`users.manage` at business). `billing.create` does
**not** imply it — the Employee kit drafts and gets `403`; a salon
widens it by hand in Roles. Tested: create ≠ issue.

### Doors

- `POST /billing/invoices/:id/issue` — above.
- `GET /billing/invoices/:id` now carries `series`, `year`,
  `numberSeq`, `issuedBy`, `events` (oldest first) and
  `issueReadiness` (always ready on an issued document).
- `GET /billing/invoices/:id/logo` (`billing.read`) — the frozen asset
  of an issued document, the profile's current logo for a draft
  (`sha256: null`), `204` when there is none.
- `PATCH` on an issued document answers `422` ("corrected by a credit
  note"). There is no `DELETE` route.

### Workspace

The draft detail shows a readiness pill ("Ready to issue" / "Not ready
— n to fix") and, with `billing.issue`, an **Issue invoice** button.
The modal states the consequence ("Issuing assigns the final invoice
number and freezes this document. Changes after issuance require a
correction document."), lists the server's problems (confirm disabled
until none remain) and its warnings, and sends one idempotency key per
screen so a retry after a lost answer returns the same document. A
`422` shows the structured problems; nothing is assumed issued until
the server answers. The issued view shows the number in place of
"Draft — number assigned when issued", the Issued badge, issue and
supply dates, issuer, buyer, lines, breakdown, totals, who issued it
and when, the frozen logo, and the document's history; no edit, delete,
cancel or back-to-draft control exists. The Issued tab is live; a user
without the right sees which right it takes. PDF buttons wait for
phase 4.

### Tests

`billing-issue.test.ts` (contracts, 12): the number string, the clock,
and the readiness evaluator on every rule. `issue.test.ts` (API, 25):
the happy path with every stored fact; sequential numbers; idempotency
(replay, conflict, key reuse); the draft doors refused after issue;
create ≠ issue and another salon's owner; six refusals that leave the
sequence untouched (incomplete issuer, unverified entity, incomplete
company buyer — then issued once corrected, tampered money, refunded
sale, bad dates) and the till still selling; rollback after allocation
(the number comes back); nine concurrent issues under two legal
entities (unique, contiguous per entity, ordered by commit, all
frozen); thirty-one frozen columns, the mutable five, no delete, lines,
events and assets; the snapshot regression (entity, profile, bank,
signatory, brand, logo, identity, service name and rate, product,
location all changed — issued JSON and logo identical, a fresh draft
sees the new world); the issue date across the year boundary both ways
(`Pacific/Kiritimati` → `2027-000001`, `Etc/GMT+12` → the 2026 sequence
continues); the numbering lock; the logo door. Workspace: four new
cases (not ready, the full flow, a refused issue, no right).

### Deferred, honestly

The PDF (4 — **built**, below), payments (5), credit notes and void
(6), auto-issue (7), email (8). The five-working-day rule is reported
as a gap, not enforced. The `[confirm]` treatments stand as decided
"for now"; the service charge stays refused. `issueMode: 'auto'` is
stored but no checkout issues anything. The HQ app does not yet list
issued documents across tenants.

## Phase 4 — the canonical PDF

Built 2026-10-07. The issued JSON document of phase 3 becomes one A4
PDF, rendered from the frozen document alone, the same bytes every
time, its SHA-256 written once. Nothing financial happens here: the
renderer is presentation over figures that arrived final.

### The document's language (migration `20261007140000_billing_phase4_pdf.sql`)

`billing_invoices.lang` (`mk` | `sq` | `en`, default `mk`). Chosen when
the draft is created — the explicit choice, else the buyer's Velnes
account language when the customer is linked to one (read under the
platform context, as booking changes do), else the salon's country
(North Macedonia → `mk`, Albania/Kosovo → `sq`), else Macedonian —
editable on the draft (Workspace: "Invoice language"), and frozen at
issue by the whitelist trigger like every other column. Documents
that existed before the column took the deterministic fallback, `mk`.
One invoice, one language; the PDF never infers another.

### The renderer — `invoice-pdf.ts`

`renderInvoicePdf(issuedDocument, frozenLogo)` is a pure function of
the `BillingInvoice` contract and the content-addressed logo asset
the issuer snapshot names. It reads no table. Strings come from the
three dictionaries (`pdf.*` keys, completeness-tested); numbers from
`@velnes/contracts/billing-format` — integer minor units to
`5.150,00 MKD` (mk/sq) or `5,150.00 MKD` (en), thousandth quantities to
`1` / `1,5` / `0,25`, basis points to `18%` / `5,5%`, dates to
`07.10.2026`; negatives carry a minus so credit notes print through
the same door. Fonts: the bundled DejaVu Sans regular, bold and
oblique, embedded as subsets — Cyrillic, Albanian and Latin in one
face, no network, no system font.

Layout, A4 with 50pt margins: logo (fit in 150×64, aspect kept) and
the title `ФАКТУРА` / `FATURË` / `INVOICE`, number, issue, supply and
due dates; issuer (legal name, trading name when different, seat,
ЕМБС, ЕДБ, VAT number only for a registered issuer, contact, bank);
buyer (company: name, seat, ЕДБ, VAT number; person: name and what
address it has; none: the approved walk-in wording) and the place of
supply; the lines — `#`, description (wrapping), quantity, unit, unit
price, discount only when any line carries one, then for a registered
issuer net, VAT %, VAT, gross, and for a non-registered issuer a
single amount column; the frozen VAT breakdown row for row (rate,
taxable base, VAT, gross), discounts, net total, VAT total and the
total in bold — or, for a non-registered issuer, the total and the
approved statement that no VAT is charged or shown; a payment block
(method of the sale, gift-card tender as payment information, due
date, bank, the sale reference, the frozen payment instructions,
notes, footer text); and on every page a footer with the authorised
signatory's name, the page count, the disclaimer and, only when one is
recorded, the external fiscal receipt reference. A figure too wide for
its cell shrinks rather than breaks; the line table continues over
pages with its head repeated; the totals block is kept together.

The fiscal disclaimer, verbatim: `Оваа фактура не е фискална сметка.`
/ `Kjo faturë nuk është kupon fiskal.` / `This invoice is not a fiscal
receipt.` No fiscal number, no QR code, no e-Faktura artefact is
produced; the reserved columns stay unused.

### Determinism and the hash

PDFKit's only run-dependent output is the pair of dates in the info
dictionary (which also seed the file ID); both are set to the
document's `issued_at`, so the file says when it was issued, never
when it was rendered. Font subset names derive from the order of use;
compression is deterministic. `RENDERER_VERSION` is stamped into the
`pdf` event, not into the file.

`GET /billing/invoices/:id/pdf` (`billing.read`, reach by scope,
issued only — a draft answers 422) renders, hashes, and on the first
render claims `pdf_sha256` atomically (`UPDATE … WHERE pdf_sha256 IS
NULL`) and writes the document's `pdf` event (hash, bytes, language,
logo outcome, renderer version). Every later render must reproduce
the stored hash. If it does not, the bytes are **not served**: a `pdf`
event with the expected and rendered hashes and a platform audit row
`Invoice PDF integrity failure` are written in their own transaction,
the door answers `500 INTEGRITY`, and the stored hash is never
overwritten — it is history. A missing frozen logo asset is the same
class of failure; the current profile logo is never substituted. An
unsupported logo format (anything but PNG/JPEG) renders without a
logo and says so in the event.

Preview and download are one endpoint (`?download=1` only changes the
content disposition); the filename is `invoice-<number>.pdf`; the
ETag is the hash. Downloads are not audited — the issued document and
its canonical hash are the historical facts.

### Workspace

Draft detail: the language selector. Issued detail: the fixed
language, **Preview PDF** and **Download PDF** (the same canonical
bytes fetched with the session token), the PDF SHA-256 once
established. The HTML detail stays; the PDF is the accounting
representation. A draft has no PDF action.

### Tests

`billing-format.test.ts` (contracts, 8). `invoice-pdf.test.ts`
(renderer, 12, no database): one page with embedded subsets; three
renders byte-identical with no clock date anywhere; a draft refused;
mk/sq/en as three canonical files; the non-VAT layout; mixed rates,
discounts, person, walk-in, due date and instructions; 1, 10 and 35
lines with multipage continuation; long names, addresses and footers;
Cyrillic and Albanian through the embedded face; zero, one deni,
large values and fractional quantities; no logo, the profile's JPEG,
portrait, landscape and oversized PNGs, an unsupported SVG, logo
determinism; the fiscal reference only when present. `pdf.test.ts`
(API, 9): the door's headers, the hash written once with its event,
repeated renders identical, download disposition, no event on
re-render; a draft refused; language default, explicit, editable then
frozen (API and database), two languages two files, the buyer's
account language; the regression after entity, profile, logo, buyer,
business, location, service and product all changed; the integrity
refusal with its audit and event and the hash untouched; the missing
asset refused; the location desk, the right revoked, another salon.
Workspace: two cases (language on the draft; preview and download on
the issued document). With `VELNES_PDF_OUT` set the renderer suite
writes its sample documents for a visual pass; the six requested
(mk, sq, en VAT; non-VAT; mixed; multipage) were inspected rasterised.

### Deferred, honestly

Payments (5), credit notes (6), auto-issue (7), email (8 — the PDF
door is reusable by it). **Renderer changes after go-live**: the
canonical hash binds a document to this renderer version; any later
change to layout or fonts would make existing documents fail the
integrity check by design. Before the first production invoice the
rule is needed: version the renderer and keep old versions for old
documents, or re-establish under an HQ-audited step. Until then,
`RENDERER_VERSION` records which one rendered what. The dev documents
rendered during this build were re-established once after the layout
was corrected, before any production use. Page sizes other than A4,
a second currency's formatting conventions and the HQ cross-tenant
list of issued documents remain open.

