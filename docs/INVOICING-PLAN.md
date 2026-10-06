# Velnes Invoicing — architecture and plan (2026-10-06)

Status: **proposal, nothing built.** Alex's brief: durable, tenant-aware
accounting invoices for salons in North Macedonia — proper numbering,
immutable issued documents, snapshots, VAT by rate, credit notes, PDF,
audit — not "fake PDFs". This document is the analysis the brief asked
for before any code: what exists, what the law requires, the proposed
model, and the phases. Sections A–J follow the brief's headings.

---

## A. Current architecture findings

What Velnes already has, by file, and what is missing. (Full survey in
the session notes; the essentials here.)

### A.1 The sale and today's `invoices`

- **One sale door exists**: `POST /sales` → `finishSale`/`settleSale`
  (`services/api/src/modules/till/till.service.ts:348–724`), idempotent
  by `idempotency_key`, whole-or-nothing. The consumer app's online
  payment settles through the same door (`payments.service.ts:173–288`).
- **Tables** (`db/migrations/20260824210009_till.sql`): `invoices`
  (`number`, `date` as a plain date, `customer_name` snapshot,
  `employee_name`, `method` free text, `status` enum **`Paid | Refunded`
  only**, `total`, tip/service charge/cart discount/points/gift/promo
  columns, idempotency key), `invoice_lines` (`description`, `qty`,
  `unit_price` *after* line discount, `line_discount`, `item_class`
  free text, `service_id`/`product_id`/`appointment_id`, `vat` **rate
  only**), `checkouts`, `merchant_transactions` (one per invoice;
  `provider_ref`, `legal_doc_ref` reserved), `checkout_items`,
  `tax_rules` (reserved, resolves to NULL), `invoice_counters`.
- **Numbering**: an upsert-and-increment on `invoice_counters` per
  location (`till.service.ts:438–453`); the number is
  `${locations.inv_prefix}${seq padded 4}`. The year in `CEN-2026-0413`
  is **text inside the prefix** — nothing resets on 1 January, and a
  real sign-up gets `VEL-` with no year (`hq.service.ts:235`). The
  purchase-order invoice added this week uses the better pattern:
  `pg_advisory_xact_lock` + yearly `INV-<year>-NNNN`
  (`suppliers/invoice-pdf.service.ts:30–53`).
- **Mutability**: the API role can UPDATE/DELETE `invoices` (only a
  tenant-isolation policy). `refundInvoice` and the cancellation refund
  loop flip `status` to `Refunded` in place — the only "correction".
  No void, no credit note, no partial refund (`refunds.invoice_id` is
  UNIQUE, amount always the full total).
- **Snapshots**: only `customer_name`, `employee_name`, line
  `description`, `unit_price`, `vat` rate, `method`. **Not** the issuer's
  legal name/address/tax numbers, the location address, the buyer's
  address or tax number, the currency, the VAT amounts.
- **Documents**: there is **no salon invoice document** — no
  `GET /invoices/:id`, no PDF, no print, no customer receipt. The only
  PDF renderer in the repo is the purchase-order invoice (pdfkit +
  bundled DejaVu Sans for Cyrillic), the right template to generalise.
- **Known arithmetic defect to fix first**: `unit_price` is stored net
  of the line discount **and** `line_discount` is stored, and four
  readers compute `qty*unit_price − line_discount`, subtracting the
  discount twice (`reports.routes.ts:104,116,188,253`,
  `till.routes.ts:120`, `customers.routes.ts:349–368`). Reports also
  hardcode VAT rates `[18, 5]` and treat prices as VAT-inclusive, while
  the PO PDF treats prices as net. No test covers discounted totals.

### A.2 Money, VAT, currency

- `MoneySchema = z.number().int()` — **whole denars, integers**
  (`packages/contracts/src/catalog.ts:3`). No minor unit, no shared
  rounding or VAT helper; rounding is ad-hoc `Math.round` at a dozen
  sites. Integer denars are fine for MKD retail, but VAT on a net base
  needs defined rounding (see C.5).
- VAT rate lives on `services.vat`, `products.vat`, `combos.vat`,
  `supplier_products.vat` (integers, default 18). Appointment lines in
  the till **hardcode 18** (`till.service.ts:62`).
  `businesses.settings.sales.defaultVat` is collected and never read.
- `legal_entities.currency` (default `MKD`) exists and nothing reads
  it. No currency on invoices.

### A.3 Company data

- `businesses`: `name`, `vat` (**the tax number, despite the name**),
  `address`, `city`, `phone`, `country`, `settings` jsonb. No legal
  name, email, zip, registration number (EMBS), bank account.
- `legal_entities` (`name`, `tax_id`, `vat_reg`, `currency`, `status`,
  `fiscal_profile_id` reserved) + `legal_entity_locations`. No address,
  bank, EMBS, VAT-registered flag. The workspace shows the legal card
  **read-only, HQ-managed** (`settings/CompanySection.tsx:139–165`).
- `locations`: `address`, `city`, `zip`, `country`, `tz` (default
  `Europe/Skopje`), `inv_prefix`.
- Logo: `businesses.gallery` / avatar data URLs; HQ-side `avatar`.

### A.4 Customers

`customers`: `name`, `email`, `phone`, groups, loyalty. **No company
name, tax number, billing address, B2B flag.** A legally addressable
B2B invoice cannot be written today.

### A.5 Payments

No `payments` table; a payment is a `merchant_transaction` under one
`checkout` per invoice. Methods are free text: `Cash`, `Card`,
`Gift card`, `Bank transfer`, `Online card`, `Apple Pay`. Deposits are
recorded on the appointment and never netted at the till (documented
deferral, `docs/TILL.md`). The `PaymentProvider` seam is refund-only
and mock.

### A.6 Platform conventions to follow (verified)

- **RBAC**: one vocabulary in `packages/contracts/src/permissions.ts`
  (`PERM_GROUPS` → `PermKeySchema`; scopes `none | own | assigned |
  location | locations | business`; `scopeChoices(key)` limits which
  scopes a key offers). Roles store a perm map in `roles.perms`; the
  Owner role is `ownerPermMap()` (widest scope for every key) — **a new
  key is granted to owners automatically and to every existing custom
  role as `none`**, so phase 1 ships a data migration that grants the
  day-to-day invoice rights to roles that already hold `pos.checkout`.
  Routes gate with `permsFor` + `can` inside `withTenant` and refuse
  `{ error: 'FORBIDDEN', message: 'Missing permission: …' }`; the
  workspace mirrors with `useSession().can`, nav `perm` fields and the
  Settings `SEC_PERM` table. Existing keys we will not reuse for
  accounting acts: `pos.view_invoices` (the till receipt list) and
  `pos.refund` (the receipt status flip) keep their meaning.
- **Audit**: `logAudit(trx, tenantId, { actorName, action, object,
  before, after, source, reason })` inside the change's transaction;
  `audit_log` has only SELECT + INSERT policies — immutable for the API
  role. Actions are Title-case prose, `object` is `Type · Identity`.
- **Doors**: contract in `@velnes/contracts` → `modules/<name>/
  <name>.service.ts` taking `(trx, …)` → `<name>.routes.ts` with the
  zod type provider and full `response` maps → one line in
  `server.ts`. Typed error class + `sendErr` mapper to `{ error,
  message }`. Idempotency: `key: z.string().min(8)` in the body, an
  `idempotency_key` column with a tenant-scoped partial unique index,
  `prior`-lookup-then-replay as the first statement.
- **Migrations**: dbmate, prose header with the decision and date,
  `tenant_id`-first indexes named `<table>_<purpose>`, `ENABLE` +
  `FORCE ROW LEVEL SECURITY`, `tenant_isolation` or `tenant_read` +
  `tenant_append` for append-only tables; business days as `date`,
  moments as `timestamptz`; `localIso()` and `nowAt(tz)` for dates.
- **Mail**: `queueMail` writes the outbox inside the caller's
  transaction; **no attachment support anywhere** (`MailInput`,
  `mail_outbox`, `sendMail` all lack it). Options in phase 8: a
  tokenised link to the PDF door, or extend all three deliberately.
- **Images**: no asset host; logos and avatars are data URLs with size
  caps (`AVATAR_MAX_CHARS`, gallery caps). pdfkit's `doc.image()` takes
  the decoded Buffer.
- **i18n**: flat dictionaries en/mk/sq with a completeness test;
  Settings sections own a 4-letter prefix (`sset.*` for Sales); the
  invoice section gets `iset.*`, the Invoices pages `inv.*`.
- **Tests**: vitest against `velnes_test`, real HTTP via `app.inject`,
  demo logins, each test deleting what it made.

### A.7 Reusable, as is

The sale door and its idempotency; `logAudit`; `queueMail`; the pdfkit
renderer and fonts; `legal_entities` as the issuer key; locations'
`tz`; RBAC and audit; the workspace Settings layout; the Invoices page
shell (`pages/till/Invoices.tsx`) as the place the new section grows.

---

## B. Macedonian compliance findings

Sources read: the consolidated **Law on VAT** (ЗДДВ, UJP consolidated
text of 30.12.2025: Articles 22, 28–30-б, 51, 52, 53, 53-б), the
consolidated **Law on registration of cash payments** (ЗРГП, Chamber
text: Articles 2, 5, 9, 10), UJP and press material on **е-Фактура**,
and accountancy practice notes on credit notes. Everything marked
**[confirm]** goes to the accountant list in section I.

### B.1 Three different things, not one

| Document | Law | Who must | What Velnes can do |
|---|---|---|---|
| **Фактура** (accounting/VAT invoice) | ЗДДВ чл. 53 | A taxpayer *on request* for supplies to other taxpayers; in practice every B2B sale and any customer who asks | **Build it.** This is the scope of this plan. |
| **Фискална сметка** (fiscal receipt) | ЗРГП чл. 2, 5 | Every taxpayer paid **not through a bank** — cash **and payment card** both count (чл. 2: "плаќањето не се извршува по банкарски пат"; чл. 5 т. 16 lists "во готово или со платежна картичка") | **Cannot be produced by software alone.** It requires an approved fiscal device with fiscal memory and a GPRS link to UJP (чл. 3–5), a prescribed layout (FS-01), a 2D barcode, a storno document (чл. 10). Salons are **not** in the чл. 9 exemptions. Velnes must integrate with a fiscal printer/device or an approved fiscal system, or the salon keeps issuing fiscal receipts outside Velnes. |
| **е-Фактура** (UJP structured e-invoice) | draft law; UJP programme | Voluntary from 1 Oct 2026, B2G mandatory in 2026, phased mandatory B2B from 2027 (press: "од 2027 постепено") | Structured JSON + qualified e-signature + UJP verification (EUID). **A PDF will not satisfy it.** Design the data model so an e-Faktura adapter can be added; do not build it now. |

### B.2 What a фактура must contain (ЗДДВ чл. 53 ст. 10, verbatim list)

1. Place, date of issue and number.
2. Name and address of the supplier and **its VAT tax number**.
3. Name and address of the recipient.
4. **Day of the supply** (датум на промет).
5. Quantity and description.
6. Amount **without VAT**.
7. Applied VAT rate.
8. VAT amount.
9. Total with VAT.
10. Name, surname and **signature of the person authorised to sign**
    invoices at the issuer.

Plus, from the same article: separate listing of taxable and exempt
supplies, with the words **„данок на додадена вредност не е
пресметан“** on exempt supplies (ст. 6); issue **on the day of supply,
at the latest within 5 working days** (ст. 8); an invoice for every
**advance payment** on the day it is received (ст. 4, 9); an electronic
invoice **needs no stamp** (ст. 12); the issuer keeps a copy (ст. 7).

Practice adds (Companies Law business-document rules, accountants'
checklists): **ЕМБС**, **ЕДБ**, **bank account** of the issuer, unit of
measure, due date. **[confirm]** which of these are legally required on
a salon's invoice versus customary.

### B.3 Electronic invoices (ЗДДВ чл. 53-б)

Recipient's **explicit written consent** to receive invoices
electronically; authenticity and integrity ensured by a **qualified
electronic signature**; readability on screen. Several consolidations
add a чл. 53-в accepting a PDF with all чл. 53(10) elements sent
electronically — the UJP text we read cuts off there. **[confirm]**:
whether an unsigned PDF emailed to a consenting customer is an
accepted invoice today, or whether the salon must print/sign or apply a
qualified signature. This decides whether Velnes needs a signing
integration for emailed invoices.

### B.4 VAT registration and rates

- Registration threshold: total turnover **> 2,000,000 MKD** in the
  previous calendar year (чл. 51). Many salons sit below it. The
  invoice system must behave for both.
- Rates (чл. 28–30-б): **18 %** general; **5 %** and **10 %** reduced,
  for listed goods and services (food, water, books, medicines, energy,
  catering…). **Hair, beauty, massage and wellness services are not in
  the reduced lists → 18 %.** Products a salon resells may differ
  (e.g. certain supplements at 5 %); the rate must come from the
  product record, never from a global constant. **[confirm]** per
  product category with the accountant.
- A non-registered business **must not show VAT**; its document is
  still called фактура and shows amounts without a VAT column, with a
  statement that the issuer is not registered for VAT **[confirm
  wording]** (customary: „Даночниот обврзник не е регистриран за ДДВ“).
- Supplier-side B2B prices are net; retail prices to consumers are
  shown gross. The till today stores **gross** per line; reports back
  the net out. A VAT-registered salon's invoice must show net, rate,
  VAT, gross per line and a breakdown by rate (чл. 52 record-keeping
  demands turnover split by rate).

### B.5 Corrections (ЗДДВ чл. 22; practice)

If the tax base changes after the supply (return, cancellation, price
change), the supplier corrects the VAT owed in **the period of the
change** — i.e. with a new document, not by editing the old one. The
instrument is the **книжно одобрение** (credit note, reduces) or
**книжно задолжување** (debit note, increases), each with its **own
sequence**, referencing the original invoice's number and date, stating
the reason. Practice: an issued invoice is never deleted; a wrong one is
fully credited and reissued. A **storno** of a *fiscal receipt* is a
separate fiscal-device act within the same day (ЗРГП чл. 10).
**[confirm]** whether the salon's accountant wants the credit note to
require the customer's acknowledgement for the VAT correction (чл. 22
implies both sides correct).

### B.6 Retention and language

Invoices and the evidence behind them: keep **at least five years after
the calendar year** (ЗДДВ practice notes; ЗРГП чл. 8 for fiscal control
tapes). Records are kept in Macedonian; the document title **ФАКТУРА**;
amounts in denars (foreign currency may be shown alongside, denars
govern — ЗРГП чл. 5). **[confirm]** retention length the accountant
applies (5 vs 10 years under the accounting law).

### B.7 What this means for scope

- Velnes builds **the accounting invoice** correctly (numbering,
  snapshots, VAT by rate, credit notes, PDF, email with consent).
- Velnes states on every PDF that it is **not a fiscal receipt**, and
  the till flow keeps telling the salon to issue the fiscal receipt on
  its device for cash/card payments — until a fiscal-device
  integration is chosen (section I).
- The data model keeps a slot for the **fiscal receipt reference** and
  for the **e-Faktura EUID**, so both can be attached when their
  integrations arrive, without a second invoice model.

Sources: ЗДДВ consolidated (UJP, 30.12.2025) — https://www.ujp.gov.mk/files/attachment/0000/0986/ ; ЗРГП consolidated (Chamber of Commerce) — https://www.mchamber.mk/Upload/Editor_Upload/ ; e-Faktura timeline — https://vecer.mk/makedonija/od-2027-godina-sekoja-transaktsija-pod-lupa-zadolzhitelna-e-faktura-ujp-ke-dobiva-podatotsi-za-sekoja-transaktsija , https://www.loginsystems.biz/post/e-faktura-makedonija-ujp-integracija-usoglasenost , https://it.mk/od-2026-godina-makedonija-ke-koristi-e-faktura/ ; VAT threshold — https://racin.mk/vesti/ujp-potsetuva-obvrska-za-ddv-registraczija-za-site-so-promet-nad-2-milioni-denari/ ; invoice content in practice — https://mojkonsultant.mk/2024/08/27/ , https://www.facturino.mk/mk/blog/faktura-primer-mk ; credit notes in practice — https://brojki.com/kreditna-nota , https://unija.com/mk/knizni-odobrenija-izadozenija-i-dan/ .

---

## C. Proposed invoice architecture

### C.1 Principle

Today's `invoices` table is the **till receipt ledger** that Reports,
Flightdeck, loyalty, refunds and the consumer app all read. It stays as
it is (with the arithmetic defect fixed) and keeps being written by the
sale door. The **accounting invoice** is a new, separate family of
tables — `billing_*` — written by its own single door, that
*references* a sale (or an appointment, or nothing) and snapshots
everything. One sale can produce at most one issued invoice; a credit
note references an invoice. Nothing in `billing_*` is ever updated
after issue except payment and e-Faktura/fiscal reference columns that
are themselves append-only events.

Why not extend `invoices` in place: it carries two statuses in one
column, no snapshots, free-text methods, and ten consumers that assume
`status='Paid'` means revenue. Changing its meaning would ripple
through every report. A clean family with a one-way link is safer and
lets the till keep its speed.

### C.2 Entities

```
billing_profiles        (1 per legal entity)  issuer settings + series config
billing_sequences       (legal entity × series × year)  the counter, locked
billing_customers       (tenant)              billing identities, B2C or B2B
billing_invoices        (tenant)              the document: status, snapshots, totals
billing_invoice_lines   (tenant)              line snapshots with VAT
billing_payments        (tenant)              money against an invoice (many)
billing_events          (tenant, append-only) the document's own audit trail
```

Relationships:

```
legal_entities 1──1 billing_profiles 1──* billing_sequences
legal_entities 1──* billing_invoices *──1 billing_customers (nullable for walk-in)
billing_invoices 1──* billing_invoice_lines
billing_invoices 1──* billing_payments
billing_invoices 1──* billing_events
billing_invoices *──0..1 invoices (the till sale)     [origin]
billing_invoices *──0..1 appointments                 [origin]
billing_invoices (credit note) *──1 billing_invoices (corrects)
```

### C.3 Document kinds and states — three separate axes

- **kind**: `invoice` | `credit_note` | `debit_note` (`advance_invoice`
  reserved; ЗДДВ чл. 53(4) needs it the day deposits get settled).
- **document status** (one writer, forward only):
  `draft → issued → (voided only while draft)`. An *issued* document
  never changes status again; corrections are **new documents**:
  `credit_note` referencing it. `cancelled` is a *derived* view: an
  issued invoice whose credit notes sum to its total.
- **payment status** (derived from `billing_payments`, cached):
  `unpaid | partially_paid | paid | overpaid`.
- **correction status** (derived): `none | partially_credited |
  fully_credited`.

No state machine rewrites the original's money. Drafts are the only
editable thing; issuing freezes them.

### C.4 Issue — the atomic step

```
POST /billing/invoices/:id/issue  (idempotent by draft id + Idempotency-Key)
  in one transaction:
    1. lock the draft row (FOR UPDATE), check status = draft, permission
    2. validate: issuer profile complete, lines ≥ 1, customer complete for B2B,
       every line has a VAT rate the profile allows, supply date ≤ today+5wd rule
    3. snapshot issuer (from billing_profiles + legal entity + location),
       customer (from billing_customers), lines (names, prices, rates)
    4. compute totals server-side (C.5), compare with the draft preview,
       write them
    5. reserve the number: SELECT … FROM billing_sequences
       WHERE legal_entity_id, series, year FOR UPDATE; next; UPDATE
       (row lock per sequence = concurrency-safe; year from the issue
       date in the location's tz; series reset per year is a profile flag)
    6. set status issued, issued_at, number, pdf_hash NULL
    7. billing_events: 'issued' with actor, totals, number
    8. logAudit 'Invoice issued'
  commit
```

A retry with the same key returns the same issued invoice. A failure
anywhere rolls the number back with the transaction (the sequence row
is only advanced inside it), so numbers stay gap-free.

### C.5 Money and VAT arithmetic (one module, `packages/contracts/src/billing-math.ts`)

- Store **minor units as integers** (`amount_minor bigint`, MKD has 100
  deni; today's catalog is whole denars, so minor = ×100). Currency is a
  column on every money row; the catalog's integer-denar prices convert
  at draft time. No floats anywhere; all helpers are integer-only.
- Each line: `qty` (×1000 for fractional units — keep integer),
  `unit_price_minor`, `discount_minor`, `vat_rate_bp` (basis points,
  1800 = 18 %), `price_includes_vat` flag (retail lines are gross-priced
  at the till; B2B lines net), then
  `net = gross-priced ? round(amount ÷ (1+rate)) : amount`,
  `vat = gross-priced ? amount − net : round(net × rate)`,
  `gross = net + vat`. Rounding **per line, half-up**, then **invoice
  totals are sums of lines** (never recomputed from the invoice total)
  and the **VAT breakdown by rate** is the sum of line VAT per rate.
  **[confirm]** per-line vs per-rate rounding with the accountant; the
  module makes it a switch.
- Non-VAT-registered profile: every line `vat_rate_bp = 0`, `vat = 0`,
  `net = gross`, invoice flag `vat_exempt_reason = 'not_registered'`,
  PDF prints the statement instead of a VAT column.
- Exempt supplies (чл. 23) on a registered profile: rate 0 with
  `exempt = true` and the чл. 53(6) sentence.
- Invoice-level discount (the till has cart discount, points, gift,
  promo): allocated to lines **proportionally to net**, remainder to the
  largest line, so the VAT base is right; the allocation is stored per
  line (`allocated_discount_minor`) and shown as a "Discount" row.

### C.6 Snapshots

`billing_invoices` carries `issuer jsonb`, `customer jsonb`,
`location jsonb` snapshots and scalar copies of the fields that are
indexed or printed in headers (legal name, tax number, VAT reg,
currency). Lines carry name, SKU/code, unit, prices, rates, employee
name. The PDF is rendered **only** from these columns; a rendered PDF's
SHA-256 is stored on first render (`pdf_sha256`) and compared on
re-render, which is the reproducibility test.

### C.7 Payments

`billing_payments`: `invoice_id, paid_at, amount_minor, currency,
method (enum: cash | card | bank_transfer | online_card | apple_pay |
gift_card | other), reference, merchant_transaction_id (nullable link
to the till's record), recorded_by`. Many per invoice; cached
`paid_minor` on the invoice updated in the same transaction (the
loyalty ledger pattern). Refund money is a **negative payment** linked
to a credit note, so the ledger stays one table.

### C.8 Corrections

- **Credit note**: a `billing_invoices` row with `kind = credit_note`,
  `corrects_invoice_id`, its own series (`KO-2026-000001`), **negative
  totals**, lines copied from the original (full) or chosen (partial)
  with quantities capped at what remains uncredited, mandatory
  `reason`. Issued through the same atomic step. The original gets an
  event and its derived correction status changes; nothing else.
- **Debit note**: same with positive lines (reserved; build when a
  salon asks).
- **Void**: only a **draft** can be voided (status `void`, keeps its
  row, never had a number). An issued document is never voided — it is
  credited.
- **Refund** = credit note + negative payment (and, when the sale was
  online, the existing refund intent).

### C.9 Links to the rest of Velnes

- `origin_sale_id → invoices.id` (the till receipt) and
  `origin_appointment_id`; one issued invoice per sale (partial unique
  index). The till's own `invoices.status` keeps meaning "revenue
  counted" for reports; the accounting document is beside it.
- `fiscal_receipt_ref` (text, nullable): the fiscal device's receipt
  number when the salon types it or an integration posts it.
- `efaktura_euid`, `efaktura_status`: reserved for the UJP adapter.

---

## D. Database changes

One migration per phase (J). Tables, with the constraints that matter;
every index starts with `tenant_id` except the sequences, which are
keyed by legal entity across its locations.

```sql
-- D.1 issuer settings
billing_profiles (
  tenant_id, legal_entity_id PK/FK,
  legal_name, trading_name, address, city, zip, country,
  embs, edb, vat_registered boolean, vat_reg_no,
  bank_name, bank_account,
  default_currency DEFAULT 'MKD',
  invoice_series_prefix DEFAULT '' , credit_series_prefix DEFAULT 'KO-',
  yearly_reset boolean DEFAULT true, number_width int DEFAULT 6,
  default_vat_rate_bp int DEFAULT 1800, prices_include_vat boolean DEFAULT true,
  footer_text, payment_instructions, signatory_name,
  contact_email, phone, website, logo (text data URL or asset ref),
  issue_mode text CHECK (issue_mode IN ('draft','auto')) DEFAULT 'draft',
  updated_at)
  RLS tenant_isolation; HQ read.

-- D.2 the counter
billing_sequences (
  tenant_id, legal_entity_id FK, series text, year int, next int NOT NULL DEFAULT 1,
  PRIMARY KEY (legal_entity_id, series, year))
  -- advanced only inside the issue transaction under FOR UPDATE

-- D.3 billing identities
billing_customers (
  id, tenant_id, customer_id FK nullable, kind CHECK ('person','company'),
  name, legal_name, address, city, zip, country, edb, vat_reg_no, email, phone,
  consent_electronic_at timestamptz,   -- ЗДДВ 53-б
  created_at, updated_at)
  INDEX (tenant_id, customer_id)

-- D.4 documents
billing_invoices (
  id, tenant_id, legal_entity_id, location_id,
  kind CHECK ('invoice','credit_note','debit_note'),
  status CHECK ('draft','issued','void'),
  series, number text, number_seq int, year int,
  UNIQUE (legal_entity_id, series, year, number_seq) WHERE status='issued',
  corrects_invoice_id FK self, reason,
  origin_sale_id FK invoices UNIQUE WHERE kind='invoice' AND status<>'void',
  origin_appointment_id FK,
  idempotency_key, UNIQUE (tenant_id, idempotency_key) WHERE NOT NULL,
  currency, price_includes_vat boolean, vat_registered boolean,
  vat_exempt_reason,
  issue_date date, supply_date date, due_date date,
  issued_at timestamptz, voided_at,
  issuer jsonb NOT NULL, customer jsonb, location jsonb,
  billing_customer_id FK nullable,
  net_minor bigint, vat_minor bigint, gross_minor bigint, discount_minor bigint,
  vat_breakdown jsonb,            -- [{rate_bp, net_minor, vat_minor, gross_minor}]
  paid_minor bigint DEFAULT 0,    -- cache of billing_payments
  pdf_sha256 text, fiscal_receipt_ref text, efaktura_euid text, efaktura_status text,
  notes, created_by, created_at)
  INDEX (tenant_id, issue_date DESC), (tenant_id, status), (tenant_id, billing_customer_id)
  TRIGGER billing_invoices_immutable: BEFORE UPDATE, when OLD.status='issued',
    allow only paid_minor, pdf_sha256, fiscal_receipt_ref, efaktura_* to change; else RAISE.
  RLS: tenant_isolation for SELECT/INSERT/UPDATE; **no DELETE policy**.

billing_invoice_lines (
  id, tenant_id, invoice_id FK, sort,
  item_class CHECK ('service','product','other'), service_id, product_id, appointment_id,
  employee_name, name, code, unit,
  qty_milli int, unit_price_minor bigint, discount_minor bigint, allocated_discount_minor bigint,
  vat_rate_bp int, exempt boolean, net_minor, vat_minor, gross_minor)
  INDEX (tenant_id, invoice_id)
  TRIGGER: lines of an issued invoice reject UPDATE/DELETE. No DELETE policy.

-- D.5 money
billing_payments (
  id, tenant_id, invoice_id FK, paid_at timestamptz, amount_minor bigint (signed),
  currency, method CHECK (...), reference, merchant_transaction_id FK nullable,
  credit_note_id FK nullable, recorded_by, created_at)
  INDEX (tenant_id, invoice_id). Append-only (no UPDATE/DELETE policies).

-- D.6 events
billing_events (
  id, tenant_id, invoice_id FK, at, actor_employee_id, actor_name, source,
  kind CHECK ('created','edited','issued','payment','credit_note','void','pdf','emailed','fiscal_ref','efaktura'),
  data jsonb)
  INDEX (tenant_id, invoice_id, at). Append-only.
```

Also, phase 0 fixes in the existing schema: `invoice_lines.vat` read
from the service for appointment lines; the double-discount readers;
a `payment_method` CHECK on `invoices.method`.

---

## E. API changes

All under the tenant API, `withTenant`, permission-gated, zod
contracts in `packages/contracts/src/billing.ts`.

| Door | Permission | Notes |
|---|---|---|
| `GET /billing/profile` · `PUT /billing/profile` | `billing.settings` | per legal entity; PUT validates completeness, logs audit |
| `GET /billing/customers?customerId` · `POST` · `PATCH /:id` | `billing.create` | billing identities; PATCH never rewrites issued snapshots |
| `GET /billing/invoices` (filters: status, paymentStatus, kind, from, to, customer, number, method) | `billing.read` | paginated |
| `GET /billing/invoices/:id` | `billing.read` | document + lines + payments + events |
| `POST /billing/invoices` (from sale / appointment / blank) | `billing.create` | creates a **draft** server-priced from the origin |
| `PATCH /billing/invoices/:id` | `billing.create` | drafts only |
| `POST /billing/invoices/:id/issue` | `billing.issue` | atomic (C.4), `Idempotency-Key` header or body key |
| `POST /billing/invoices/:id/void` | `billing.void` | drafts only |
| `GET /billing/invoices/:id/pdf` | `billing.read` | rendered from snapshots; `inline`; hash stored |
| `POST /billing/invoices/:id/payments` | `billing.record_payment` | signed amounts, method enum |
| `POST /billing/invoices/:id/credit-notes` | `billing.correct` | full or partial; returns the new draft; issue it through `/issue` |
| `POST /billing/invoices/:id/email` | `billing.send` | needs `consent_electronic_at` on the billing customer; attachment support added to `queueMail` |
| `POST /billing/invoices/:id/fiscal-ref` | `billing.record_payment` | records the fiscal receipt number typed by staff |

Errors follow the existing `{ error, message }` shape with codes
`WRONG_STATE`, `INVALID`, `INCOMPLETE_PROFILE`, `NOT_FOUND`. Rate limit
the PDF and email doors per tenant (existing Fastify limiter if present,
else a small token bucket).

Permissions: a new **Invoicing** group in `PERM_GROUPS` with keys
`billing.read`, `billing.create`, `billing.issue`,
`billing.record_payment`, `billing.correct`, `billing.void`,
`billing.send`, `billing.settings`; `scopeChoices` offers
`none | location | business` for the first six and `none | business`
for `void`/`settings`. `ownerPermMap()` grants all of them to owners
by construction; a data migration grants `read/create/issue/
record_payment` at the role's `pos.checkout` scope to roles that hold
`pos.checkout`, so front desks keep working on day one. Crediting and
voiding stay owner-only until a salon widens them — the `pos.discount`
"second right" pattern.

---

## F. Workspace changes

- **Settings → Invoicing** (new `SEC_PERM` entry under `#Selling`,
  gated by `billing.settings`, strings under `iset.*`):
  one form per legal entity: identity (legal name, trading name,
  address, EMBS, EDB, VAT registered toggle → VAT reg number), bank,
  series (prefix preview "2026-000001" / "INV-2026-000001", yearly
  reset, width), defaults (VAT rate, prices include VAT), signatory,
  footer/payment instructions, logo, contacts, **issue mode** (issue on
  checkout vs draft first). A completeness banner: the issue door
  refuses until the mandatory fields are filled.
- **Invoices** (grows out of `pages/till/Invoices.tsx` into its own
  nav item): tabs All · Draft · Issued · Unpaid · Paid · Credited;
  columns number, customer, issue date, gross, payment status,
  document status; filters by number, customer, date range, status,
  payment status, method; search bar entries ("invoice 2026-000012").
- **Invoice detail**: header (issuer, customer, dates, numbers), lines
  with net/VAT/gross, breakdown by rate, payments list, events
  timeline; actions by state and permission: Preview (draft), Issue,
  Download PDF, Print, Record payment, Create credit note, Email (if
  consent), Record fiscal receipt no.; nothing financial editable after
  issue — the UI never even shows inputs.
- **Customer profile → Billing details**: the B2B identity form
  (company name, EDB, VAT no, address, electronic-invoice consent).
- **Till receipt pane**: after a sale, a line "Invoice 2026-000012
  issued" or "Draft invoice created" with a link, and the reminder
  "Fiscal receipt: issue on your fiscal device" until integrated.

---

## G. Appointment / payment integration

- **When**: the sale door (`settleSale`) is the moment a visit becomes
  money. In the same transaction it creates a **draft** accounting
  invoice from the sale (lines server-priced from the sale's resolved
  lines, discounts allocated, VAT from the service/product records,
  payment recorded from the sale's method). If the profile's
  `issue_mode = 'auto'`, the same transaction runs the issue step; if
  `draft`, staff issue from the Invoices page. Default **`draft`** for
  existing salons, because a wrong auto-issued number cannot be taken
  back; a salon that always invoices can flip to `auto`.
- **Online payment** (consumer app) goes through the same door, so the
  same rule applies; the customer's billing identity is the client
  account's name unless they asked for a company invoice at checkout
  (a later consumer-app step; reserved).
- **Deposits**: today never settled at the till. ЗДДВ чл. 53(4) wants
  an advance invoice when a deposit is received. Phase 6 adds
  `advance_invoice` and nets it on the final invoice; until then the
  invoice shows the full price and the deposit as a payment line
  **[confirm]** acceptable interim treatment.
- **Refund of a visit** (cancellation flow): creates and issues a full
  credit note and a negative payment, alongside the existing refund
  intent — one transaction.
- **Idempotency**: the draft is keyed by the sale's idempotency key;
  the issue door takes the draft id plus a client key; a retried
  checkout cannot create a second invoice.

---

## H. PDF structure (A4, pdfkit, DejaVu Sans; mk/sq/en by the salon's language)

1. **Header**: logo (left); **ФАКТУРА** / Faturë / Invoice; for credit
   notes **КНИЖНО ОДОБРЕНИЕ** with "кон фактура бр. … од …"; number;
   place and date of issue; supply date; due date; currency.
2. **Issuer** (snapshot): legal name, trading name, address, ЕМБС,
   ЕДБ, ДДВ бр. (if registered), bank and account, contact.
3. **Buyer** (snapshot): person → name (and address if given); company
   → legal name, address, ЕДБ, ДДВ бр.
4. **Lines**: #, description (+ professional for services), qty, unit,
   unit price (net), discount, VAT %, net, VAT, gross. Non-registered
   profile: no VAT columns; the statement line instead.
5. **Totals**: subtotal net, discounts, VAT by rate table (rate, base,
   VAT, gross), **ВКУПНО ЗА ПЛАЌАЊЕ** gross; exempt-supply sentence
   when applicable.
6. **Payment**: status (paid / unpaid / partially paid), method(s) and
   dates, payment instructions; fiscal receipt number if recorded.
7. **Foot**: signatory name (чл. 53(10) т. 10) with "електронски
   документ, валиден без печат" for electronic issue; notes; "Издадено
   преку Velnes"; the honest fiscal line: "Оваа фактура не е фискална
   сметка" until a device integration exists.
8. Reproducible: rendered only from the snapshot columns; SHA-256
   stored; a test renders twice and compares.

---

## I. Risks and unresolved decisions

### Macedonian Compliance / Accountant Verification Required

1. **Fiscal receipts.** Cash **and card** payments to consumers require
   a fiscal receipt from an approved device (ЗРГП чл. 2, 5); salons are
   not exempt (чл. 9). A Velnes PDF does not replace it. Decide:
   (a) integrate a fiscal printer/approved fiscal system (vendor,
   protocol, cost), or (b) keep the device outside Velnes and record its
   receipt number on the invoice. Until decided, Velnes must say so on
   every document.
2. **e-Faktura.** Mandatory phases from 2027 (B2G earlier). Confirm
   the adopted law's text, the B2C treatment, and whether retail with a
   fiscal receipt is excluded; plan the adapter (JSON, qualified
   signature, EUID) as its own phase.
3. **Electronic PDF invoices by email**: is an unsigned PDF with all
   чл. 53(10) elements accepted when the customer consented (чл. 53-б/
   53-в), or is a qualified e-signature needed? This decides whether we
   buy a signing service.
4. **Mandatory fields beyond чл. 53(10)**: ЕМБС, bank account, unit of
   measure, due date, place of issue, signatory — confirm the exact set
   the accountant expects, and the wording for a non-VAT-registered
   issuer.
5. **Numbering**: yearly reset vs continuous; one series per legal
   entity vs per location; credit-note series name (КО-/КЗ-); whether
   drafts may carry a provisional number (we say no).
6. **VAT rates by product category** a salon resells; treatment of
   gift cards (VAT at sale or at redemption — current till sells gift
   cards as lines) and of tips/service charge (outside the VAT base?).
7. **Rounding**: per line vs per rate; deni vs whole denars on the
   document.
8. **Advance payments / deposits**: advance invoice on receipt (чл.
   53(4)) — confirm the interim treatment and the final netting.
9. **Corrections**: whether a credit note needs the customer's
   confirmation for the VAT correction (чл. 22); handling of
   wrong-customer invoices (full credit + reissue).
10. **Retention**: 5 vs 10 years; export format the accountant wants
    (PDF bundle, CSV, е-Фактура JSON later).
11. **Language**: documents in Macedonian by default; Albanian where
    the salon operates in Albanian — confirm any requirement.

### Technical risks

- Integer denars in the catalog vs deni on invoices: conversion is
  exact (×100) but every new money column must be minor units from
  day one.
- The existing double-discount bug must be fixed before invoices read
  sale lines, or the first invoices will disagree with the till.
- Snapshots make the PDF reproducible but freeze typos; the answer is
  a credit note, which staff must understand (UI copy + docs).
- `queueMail` has no attachments; adding a `mail_attachments` path is
  part of the email phase.
- Supplier purchase-order invoices (this week's PDF) are a different
  document (supplier → salon). Leave them as they are; later they can
  move onto the same renderer.

---

## J. Implementation phases (each: contract + migration + service +
door + UI + tests + seed + docs paragraph; each shippable alone)

0. **Till arithmetic** — **built 2026-10-06** (`docs/TILL.md` "Phase
   0"). What implementation settled against the analysis: the defect
   was in the readers and in the rounding of `unit_price`, not in the
   stored totals, so no historical value was rewritten — `invoice_lines`
   gained an exact `amount` (backfilled, trigger-filled for writers
   that omit it) and every reader sums it; the cash drawer and the
   customer's history read `invoices.total`. Payment methods stay the
   six display strings the apps emit (no renaming migration); the CHECK
   is `NOT VALID`, to be validated after production's distinct values
   are confirmed. The VAT block derives net from gross because till
   prices are VAT-inclusive (decision 3). Cart-level deductions are not
   allocated to lines in the till ledger; the accounting invoice does
   that (C.5).
1. **Issuer profile + billing customers** — **built 2026-10-06**
   (`docs/INVOICING.md`). Settled against the analysis: legal name,
   ЕДБ and VAT number stay on `legal_entities` (ЕМБС added there), so
   `billing_profiles` carries no copy of identity — only configuration
   and the seat address; consent gained an append-only
   `billing_consent_events` beside the timestamp; only
   `billing.settings` and `billing.create` exist as rights so far.
2. **Draft from a sale** — **built 2026-10-06** (`docs/INVOICING.md`
   "Phase 2"). Settled against the analysis: the issuer snapshot joins
   entity + profile + brand (no identity copy on the profile); the
   loyalty value is derived from the receipt's stored figures; a gift
   card is tender, a tip is outside, a service charge is refused until
   decided; `billing.read` arrived with this phase; reach by role scope
   is enforced in the service, not only in the UI; the frozen-row
   triggers for issued documents were created now as phase-3 schema
   preparation.
3. **Issue**: sequences, the atomic issue step, idempotency,
   concurrency test (parallel issues never share a number), yearly
   reset test, immutability tests (UPDATE rejected), audit events.
4. **PDF**: renderer from snapshots in mk/sq/en, hash, reproducibility
   test, Download/Print, the fiscal disclaimer, non-VAT layout.
5. **Payments**: `billing_payments`, record payment, derived statuses,
   link from the sale's merchant transaction, Unpaid/Paid tabs.
6. **Credit notes and refunds**: KO series, full/partial, negative
   payments, cancellation flow integration, void for drafts.
7. **Issue mode `auto`** and the till receipt pane link; consumer
   checkout "I need a company invoice" (billing identity capture).
8. **Email with consent**: attachment support in the outbox, the send
   door, events.
9. **Reserved integrations**: fiscal receipt reference (manual first),
   advance invoices for deposits, e-Faktura adapter — each behind the
   decisions in section I.

Estimated size: phases 0–4 are the core and about the size of the
booking-changes phase; 5–8 together about the same again.
