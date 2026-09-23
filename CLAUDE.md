# Velnes — engineering guide

Multi-tenant SaaS for wellness/physiotherapy salons (Revelapps).
Read `docs/VELNES-PLATFORM-DOCUMENTATION.md` first — it is the
authoritative spec. `reference/prototype/` is the read-only behavioral
reference (single-file prototype + 30 test suites + subsystem DOCS);
when the docs are ambiguous, the prototype's behavior wins. Never
modify anything under `reference/`.

## Working method (non-negotiable)
- Proposal first: before each phase, present a short plan and WAIT for
  Alex's approval. Never build past an unanswered open question.
- One door: every business rule is ONE service function behind ONE
  endpoint with ONE zod contract in `@velnes/contracts`. UI never
  computes domain values.
- Lifecycles over booleans; transitions validated + audited server-side.
- RLS on `tenant_id` from day one; every index starts with `tenant_id`.
- Honest emptiness: SMTP/payments/fiscalization are undecided — model
  reserved fields/pending states, never fake integrations.
- Definition of done per feature: contract + migration + service +
  endpoint + UI + tests + seed + one docs paragraph.
- Report failures honestly; never claim green without running tests.

## Commands
- `pnpm dev` — everything in watch mode (api :3001, apps :5173–:5177)
- `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build`
- Local DB: native Homebrew Postgres 16 (`brew services start
  postgresql@16`), db/user/password `velnes`. NO Docker anywhere —
  Alex's decision 2026-08-24; the API deploys natively to the shared VPS
  (PM2 + Nginx, PostgreSQL 16) per `deploy/DEPLOY.md`; web apps on Vercel.
- Migrations: dbmate (SQL in `db/migrations/`), types via kysely-codegen

## Layout
`apps/{workspace,employee,booking,supplier,hq,consumer}` · `services/api`
(Fastify; widget surface is a separate narrow plugin scope) ·
`packages/{contracts,ui,config,i18n,client}` · `db/migrations` ·
`reference/prototype` · `reference/client-prototype` (consumer app's
read-only design spec) · `docs/`

## Status (2026-09-18)
All ten phases built: foundations, catalog/pricing, scheduling,
till/checkout, workspace app, employee PWA, booking page + widget,
registrations + HQ app, customers/CI/offers/Premium, supplier chain +
portal. Plus `apps/consumer` (dev :5178) — the public browse-and-book
app: key-free `/public/discovery/*` doors, real Leaflet/OSM maps from
`locations.lat/lng` (the pin salons drop at registration), and **client
users**, the platform's fourth principal (`/api/v1/client/*`,
`app.client_id`). Booking is what links a client to a salon as a
customer; notifications ring both bells. SMTP delivery, reviews,
loyalty/premium and geo search stay deferred, not faked (see
`docs/CONSUMER-APP.md`). Per-phase docs live in `docs/`
(FOUNDATIONS, CATALOG, SCHEDULING, TILL, I18N, WORKSPACE, EMPLOYEE-APP,
BOOKING-PAGE, REGISTRATIONS-HQ, CUSTOMERS-MARKETING, SUPPLIERS,
CONSUMER-APP) — each ends with its honest deferrals, which together
form the backlog.
Search/discovery is **built** (2026-09-21): one universal search bar,
`search_documents` as the cross-tenant matching projection,
`service_category_terms` for multilingual synonyms, the Phase B ranker
gaining `textRelevance`, server-side filters, a real "Most chosen", a
zero-result miss log and the HQ Search lab. `docs/SEARCH.md` §12 carries
what each step settled; §14 its deferrals.
All apps are trilingual (en/mk/sq, `packages/i18n`, completeness
tested); MK/SQ dictionaries still need native review.
Principals: tenant employees, `hq_users`, `supplier_users`,
`client_users` — four token shapes that reject each other by
construction; RLS context modes: `app.tenant_id`, `app.auth`
(incl. `client_login`), `app.public`, `app.hq`, `app.supplier_id`,
`app.reg_token`, `app.client_id`.
