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
`packages/{contracts,ui,config}` · `db/{migrations,seed}` ·
`reference/prototype` · `docs/`
