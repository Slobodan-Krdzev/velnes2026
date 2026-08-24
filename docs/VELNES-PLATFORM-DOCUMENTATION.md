# Velnes Platform — Production Documentation
### Revelapps · v1.0 · 24 Aug 2026

This document is the authoritative specification for building the real
Velnes platform. It is derived from the working single-file prototype
(`reference/prototype/index.html`, build `0b399333830e329735e225299062a3a3`,
~21.5k lines, 30 test suites) which remains the behavioral reference:
when this document is ambiguous, the prototype's behavior wins.

---

## 1. What Velnes is

A multi-tenant SaaS platform for wellness/physiotherapy salons
(initial market: North Macedonia). One platform, **five applications**,
one API, one PostgreSQL database. Salons run their business in it
(bookings, till, staff, stock, customers, marketing); customers book
through it; suppliers sell through it; Revelapps operates and governs
it. Revenue model: SaaS subscription + Premium features + payment flow.

**The five apps:**

| # | App | Users | Form |
|---|-----|-------|------|
| 1 | **Salon Workspace** | Owners, managers, front desk | Vite + React SPA |
| 2 | **Employee App** | Practitioners/staff on the floor | Vite + React **PWA** |
| 3 | **Booking Page + Widget** | The public / salon customers | Embed-first public app |
| 4 | **Supplier Portal** | Product suppliers | Vite + React SPA |
| 5 | **Revelapps HQ** | Revelapps staff | Vite + React SPA |

All five speak to **one API**. No app touches the database directly.

## 2. Technology stack (locked)

- **Monorepo:** pnpm workspaces.
- **Backend:** Node.js + TypeScript + **Fastify**. One API service;
  the widget's public endpoints are a separate narrow Fastify plugin
  surface with its own rate limiting and caching.
- **Contracts:** a shared `@velnes/contracts` package — zod schemas +
  inferred TS types for every request/response. Defined once, imported
  by API and all five apps. This is the one-door discipline enforced
  by the compiler across process boundaries. No endpoint exists
  without its contract.
- **Database:** **PostgreSQL 16** with **Row-Level Security** on
  `tenant_id` (business). Query layer: **Kysely** (typed SQL builder;
  no ORM). Every index starts with `tenant_id`. Migrations via a
  single migration runner (e.g. `kysely-migrator` or `dbmate`) —
  one shared schema, never database-per-tenant.
- **Auth:** short-lived JWT access tokens + rotating refresh tokens.
  No Keycloak. Roles/permissions modeled after the prototype's role
  kits (owner / manager / front desk / staff + custom roles), scoped
  by location.
- **Deploy:** Linux VPS, Docker Compose + **Caddy** (TLS, routing).
  Sized for hundreds of salons on one 8–16 GB VPS; scale by splitting
  the widget/API before anything else.
- **Testing:** Vitest for unit/contract tests, Playwright for the
  critical end-to-end journeys. Suites green before merge — the
  prototype's discipline carries over.

## 3. Non-negotiable engineering principles

1. **One door.** No screen computes its own numbers and no handler
   embeds business rules. Every domain rule lives in exactly one
   named service function behind one endpoint (`priceFor`,
   `availableSlots`, `routeCheckout`, `locTransition`, `locLive`,
   `svcChoice`, …). The prototype's door functions map 1:1 to API
   service modules.
2. **Lifecycles over booleans.** Locations, registrations, offers and
   premium opportunities carry explicit state machines with audited,
   validated transitions. One transition function per machine; no
   direct status writes.
3. **Everything audited.** Price changes, role changes, lifecycle
   transitions, HQ actions, refunds — one `audit_log` table, one
   `logAudit` door, actor + before + after + reason.
4. **Honest emptiness.** Missing integrations (SMTP, payment
   provider, fiscalization) are represented truthfully as reserved
   fields/pending states — never faked.
5. **Tenant safety in the database.** RLS policies on `tenant_id`
   make an unfiltered cross-tenant query structurally impossible; the
   API sets the tenant context per request. HQ operates through
   explicitly-audited elevated policies, never by bypassing RLS.

## 4. Domain model (core entities)

**Tenancy & structure**
- `businesses` (tenant root; plan, brand settings, gallery)
- `locations` — with **lifecycle** `DRAFT → SUBMITTED → UNDER_REVIEW →
  CHANGES_REQUIRED → RESUBMITTED → APPROVED → ACTIVE`
  (+ `SUSPENDED`, `CLOSED`). Hours, payments config, rooms, invoice
  prefix, country (drives holiday calendar + fiscal profile).
- `legal_entities` — sellers; status pending/verified; own
  `payment_accounts` (provider ref, status) and `tax_rules`.
  Entity ↔ locations mapping. A location can never trade on an
  unverified entity.
- `employees` — role kit, `access` level, **multi-location**
  assignment (`employee_locations`), bookable flag, skills, hours,
  2FA flag, personal color.
- `roles` — standard kits + custom roles with permission maps.

**Catalog**
- `services` with **variants** (duration/price per variant) and
  **modifiers** (add-ons); category tree; combos; gift cards.
- Per-location overrides (`location_catalog`): active / online / pos
  flags, price, duration, prep/reset minutes, variant overrides.
  Resolution door: `svcAt` / `svcChoice` / `svcVariants`.
- `products` with per-location config + **stock** (stock is
  transactional: adjustments, transfers, deliveries; never copied).
- **Timing engine:** per-employee pace learned from measured
  treatments (`emp_timings`: observedN, median, paceFactor,
  suggested/approved/dismissed lifecycle). Owner approves; Velnes
  never changes durations on its own. Resolution:
  catalog → employee-approved → employee-pace, via `effTreatment`.

**Customers & intelligence**
- `customers` — one profile across locations; contact, tags, notes,
  loyalty points, blacklist flag.
- `activity_log` — schema'd events (visits, offers shown/redeemed,
  messages) powering Customer Intelligence: stats, rhythm/lapse
  detection, trends, threshold-gated claims (no claim without
  evidence), AI-analysis hooks.
- **Personal Offers:** owner-priced, per-customer offers with intent,
  validity window, preferred weekday/band; lifecycle draft → live →
  redeemed/expired; redemption is checkout-driven (a fact, not a rule).
- **Premium last-minute:** capacity gaps → HQ-ruled recommendations
  (max discount, member scoring) → staged member offers; opt-in
  membership; blacklist respected.

**Commerce**
- `appointments` — service/variant/mods, employee, location, promised
  vs measured times (history events TREAT_START/END), status,
  linked offers.
- **Till / POS:** basket lines (services, products, combos, gift
  cards), line discounts, coupons, loyalty redemption, tips, rounding;
  `finishSale` resolves promises (offer redemption) and writes
  `invoices` (per-location numbering `invPrefix`).
- **`routeCheckout`:** splits basket lines by seller legal entity →
  payment account groups (multi-merchant); `checkoutStatus` over
  `merchant_transactions`. Fiscalization fields reserved per entity.
- `reservations/holds` — booking holds with idempotency keys and
  expiry countdown.

**Search & discovery** (consumer side; §5 answers still pending)
- `platform_salons` market records: area/region, categories,
  price level, rating (brand-inherited flag), completion, per-category
  quality, local momentum, `newUntil` window, verified, reliability.
- Ranking with exposure decay, chain dedup by business, quality
  floor; consent modes; HQ Search lab for tuning. Location admission
  happens **only** on lifecycle ACTIVE (idempotent, audited).

**Governance**
- `registrations` — classic salon signup; status machine
  `pending_review → under_review → changes_required → resubmitted →
  active/declined`; full draft retained for resubmission; reserved
  SMTP seats (email token, invites).
- `audit_log`; HQ support sessions (time-boxed read-only environment
  access, logged).

## 5. App 1 — Salon Workspace (the flagship)

The owner/manager/front-desk web app. Functional areas (all exist in
the prototype and are the build spec):

- **Flightdeck (home):** today's numbers, capacity gaps, Premium
  card, action queue.
- **Calendar:** week/day views, appointment create/edit drawer
  (variants, mods, employee pace-aware durations, prep/reset
  visualization), split shifts, schedule exceptions, holiday
  calendar per location country.
- **Cash register (till):** location-gated; sell + rebook flows;
  products/services/combos/gift cards; discounts, coupons, loyalty
  points, tips; payment methods per location; invoice creation;
  post-sale rebooking prompts and upsells.
- **Catalog:** services/variants/modifiers/categories/combos editor;
  per-location tables (price/duration/active/online/pos); product
  catalog with stock, low-stock, own-use; CSV import with dedupe and
  draft/commit/undo.
- **Customers:** list + profile (sales, activity, intelligence tabs);
  personal offers (Actions dropdown); notes, tags, loyalty.
- **Marketing:** discounts, offers, waiting list, loyalty, Premium
  (member offers pipeline), reviews (with routing), campaigns.
- **Reports:** by location/source/service/product/employee/VAT;
  timing report (suggestions stack).
- **Suppliers:** connect suppliers, order drafts, deliveries →
  stock-in, supplier academy content.
- **Settings:** general, company (**legal entities + payment
  accounts**), **locations** (list + lifecycle cards + **New-location
  wizard**: scratch/copy, snapshot copy engine, legal attach-or-create,
  submit → HQ; readiness checklist; owner-only Activate), team/users,
  roles (kits + custom), booking rules, marketplace/consent,
  audit log; **booking widget management** (widget configs, domains,
  keys, embed code, integration events).
- **Onboarding:** AI-assisted and classic registration paths.

## 6. App 2 — Employee App (PWA)

Mobile-first for practitioners: sign-in per employee; **agenda**
(own day, appointment details); **treatment flow** — start/finish
buttons writing measured history (feeds the timing engine);
**mobile POS** (quick checkout incl. upsell/rebook prompts); **rank**
(personal performance). Installable PWA, offline-tolerant reads,
optimistic writes with idempotency keys.

## 7. App 3 — Booking Page + Widget (public)

The only anonymous surface; embed-first, separate project.
- Hosted booking page per salon (`velnes.mk/book/<slug>`) + loader
  script for embedding on salon sites; per-widget config (locations
  subset, categories, language, theme, accent, radius, start step,
  deposit policy, cancellation policy inherit/override, domains,
  publishable keys).
- Flow: Location → Service (variants/mods) → Time (via
  `availableSlots`; only `locLive` locations exist) → Details →
  Payment/deposit → Done; hold with countdown + idempotency key;
  coupon validation.
- **Performance/security posture:** availability endpoint is the real
  load — cache (~30 s per salon/day), rate-limit, key-scoped, CORS
  per registered domain, integration-events log for debugging
  (SERVICE_NOT_FOUND etc.).

## 8. App 4 — Supplier Portal

Supplier accounts: dashboard, customer (salon) list, own product
catalog, incoming orders → deliveries, promotions, academy content
authoring, reports, settings. Orders flow into Workspace stock-in.

## 9. App 5 — Revelapps HQ

Internal operations app:
- **Verification intake:** salon registrations queue and **New
  locations** queue (same table pattern). Review cards; **compound
  review** (location + new legal entity in one decision);
  Approve / **Request changes** (mandatory reason) / Decline
  (exceptional). Every location and every salon is verified by HQ —
  no auto-approval ever.
- **Customer management:** businesses, plans, support-environment
  access (time-boxed, read-only, audited).
- **Supplier Intelligence:** supplier performance across salons.
- **Search lab:** ranking config document (versioned, like Premium
  rules), simulations, market seeding, consent oversight.
- **Premium rules:** the HQ-set rules document (max discounts,
  member scoring windows) — config tunes the game, never one player.
- **Audit:** cross-platform audit trail.

## 10. API shape (doors → endpoints, representative)

All under `/api/v1`, JWT-authed unless noted. Contracts in
`@velnes/contracts` are the source of truth; the prototype functions
named here define semantics.

- Availability/booking: `GET /availability` (**public, cached,
  rate-limited** — `availableSlots`), `POST /holds`,
  `POST /appointments` (idempotent), `PATCH /appointments/:id`.
- Pricing: `GET /price` (`priceFor`/`svcLine` — the single pricing
  door: base, variant, mods, personal/member offers, employee pace).
- Checkout: `POST /checkouts` (`routeCheckout` grouping),
  `GET /checkouts/:id/status`, `POST /sales` (`finishSale`).
- Catalog: CRUD + `GET /locations/:id/catalog` (resolved via
  `svcAt`/`prodAt`), import endpoints (draft/commit/undo).
- Locations: `POST /locations` (wizard create incl. copy checklist →
  `copyLocationSetup` snapshot), `POST /locations/:id/transitions`
  (`locTransition` — the only status writer; readiness gate +
  owner-only ACTIVE enforced server-side),
  `GET /locations/:id/readiness` (`locReadiness`).
- Registrations: `POST /registrations`, `POST /registrations/:id/...`
  (request-changes / resubmit / approve / decline).
- Customers & CI: profiles, activity events, insights
  (`GET /customers/:id/insights` — shape fixed in prototype),
  personal offers CRUD (creation refuses non-live locations).
- Premium: capacity scan, recommendations, member offers staging.
- Timing: measured events ingest, `POST /timings/recompute`
  (idempotent), suggestion approve/dismiss.
- HQ: queues, reviews, transitions, search-lab config, support
  sessions.
- Widget public surface: config fetch by publishable key,
  availability, hold, book — nothing else.

## 11. Repository layout

```
velnes/
  apps/
    workspace/        # Vite React SPA
    employee/         # Vite React PWA
    booking/          # public booking page + embed loader
    supplier/         # Vite React SPA
    hq/               # Vite React SPA
  services/
    api/              # Fastify (+ widget plugin surface)
  packages/
    contracts/        # zod schemas + types (THE door registry)
    ui/               # shared design system (tokens from prototype)
    config/           # eslint/tsconfig/shared tooling
  db/
    migrations/       # SQL migrations (RLS policies versioned here)
    seed/             # demo seed mirroring the prototype's world
  reference/
    prototype/        # index.html + tests/ + DOCS/ (read-only spec)
  docs/               # this documentation
  docker-compose.yml
  Caddyfile
```

## 12. Delivery methodology (carried from the prototype)

Proposal → Alex's approval → build. Small verified increments; every
merge green; contract changes ripple through the compiler; seeds
mirror the prototype's demo world so every feature is demonstrable;
honest reporting of failures and environment anomalies. Definition of
done per feature: contract + migration + service (door) + endpoint +
UI + tests + seed + docs note.

## 13. Known open items (inherit from prototype)

§5 search-architecture answers (blocks consumer search frontend);
SMTP provider decision (email verification, invites — tokens/seats
already modeled); payment provider + fiscalization (per legal
entity); SUSPENDED/CLOSED transition surfaces; timing suite
date-sensitivity (test hygiene note).
