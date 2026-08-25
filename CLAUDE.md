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
  Alex's decision 2026-08-24; VPS deploys natively per `deploy/DEPLOY.md`.
- Migrations: dbmate (SQL in `db/migrations/`), types via kysely-codegen

## Layout
`apps/{workspace,employee,booking,supplier,hq}` · `services/api`
(Fastify; widget surface is a separate narrow plugin scope) ·
`packages/{contracts,ui,config,i18n,client}` · `db/migrations` ·
`reference/prototype` · `docs/`

## Status (2026-08-26)
All ten phases built: foundations, catalog/pricing, scheduling,
till/checkout, workspace app, employee PWA, booking page + widget,
registrations + HQ app, customers/CI/offers/Premium, supplier chain +
portal. Per-phase docs live in `docs/` (FOUNDATIONS, CATALOG,
SCHEDULING, TILL, I18N, WORKSPACE, EMPLOYEE-APP, BOOKING-PAGE,
REGISTRATIONS-HQ, CUSTOMERS-MARKETING, SUPPLIERS) — each ends with
its honest deferrals, which together form the backlog.
Search/discovery is NOT started — it waits for Alex's §5 answers.
All apps are trilingual (en/mk/sq, `packages/i18n`, completeness
tested); MK/SQ dictionaries still need native review.
Principals: tenant employees, `hq_users`, `supplier_users` — three
token shapes that reject each other by construction; RLS context
modes: `app.tenant_id`, `app.auth`, `app.public`, `app.hq`,
`app.supplier_id`, `app.reg_token`.
