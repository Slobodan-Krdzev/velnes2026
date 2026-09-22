# Phase 1 — Foundations

**Tenancy & RLS.** One schema, tenant root `businesses`. Every tenant
table carries `tenant_id`, indexes start with it, and RLS policies
(`tenant_id = app.current_tenant()`) ship in the same migration as the
table — with `FORCE ROW LEVEL SECURITY`, so not even the table owner
skips them. The API connects as the restricted `velnes_api` role and
reaches tenant data only through `withTenant()`, which sets
`app.tenant_id` per transaction. Supplier-owned legal entities and
payment accounts are platform-level (`tenant_id IS NULL`): readable by
every tenant (checkout routing needs the seller), writable by none.
The RLS test suite proves isolation with deliberately unfiltered SQL.

**Auth.** Login by email + argon2id password → 15-minute JWT (claims:
employee, tenant, access level, role, location ids) + opaque 30-day
refresh token, stored hashed. Refresh rotates; reusing a rotated token
revokes its whole family. The pre-tenant login lookup runs under an
explicit `SET LOCAL app.auth = 'login'` policy — the one deliberate,
visible door through tenant isolation. Invited employees cannot sign
in until active. 2FA is a reserved flag (honest emptiness).

**Authorization.** The prototype's permission vocabulary (7 groups,
32 keys, scope ladder none→own→assigned→location→locations→business→
platform) lives in `@velnes/contracts`; roles store a validated perm
map (jsonb); `scopeOf`/`can` is the one authz door.

**Two standard roles (2026-09-22).** Every tenant is born with exactly
two: **Owner** (locked, every key at its widest scope) and **Employee**
— Alex's basic kit: their own appointments, create/edit/cancel
appointments at their location, take payments; every other key
`none`, so the workspace shows them Calendar, Cash register and
Support and nothing else — the Flightdeck too is behind
`reports.view_location`/`reports.view_business` now (API 403, the
home route sends them to the calendar). The kits are `STANDARD_ROLES` in
`@velnes/contracts`, written by one helper (`standardRoles()`) from
registration approval, HQ's create-business door and both seeds;
migration `20260922120000_employee_role` gave every earlier tenant
its Employee role and reset existing standard Employee roles to the
kit (custom roles untouched). An invite that names no role gets the
Employee role, never nothing. The Employee role is unlocked: an owner
who wants more for their staff edits it or adds a role.

**Location lifecycle.** `locTransition` is the only lifecycle writer:
legal edges per the prototype's `LOC_EDGES`, readiness gate on
APPROVED→ACTIVE (five requirements; the service/staff checks read the
catalog and honestly report not-ready until Phase 2), owner-only
activation, lifecycle log + audit entry in the same transaction.
`locLive` is the liveness predicate every customer surface will ask.
Search-market admission on ACTIVE is deferred with §5.

**Audit.** One `logAudit` door, one `audit_log` table (actor, before,
after, source, reason). No UPDATE/DELETE policies exist — audit rows
are immutable for the API role.

**Seed.** `pnpm --filter @velnes/api seed` builds the prototype's demo
world: Velnes Fizio Centar (Centar + Aerodrom, both ACTIVE), the five
employees (Maria owner … Bojan bookkeeper), four standard role kits +
custom Bookkeeping, the three legal entities — Aroma Nordic
deliberately pending — and payment accounts. Demo password
`velnes-demo`; the seeder refuses `NODE_ENV=production` and needs an
RLS-exempt connection (`SEED_DATABASE_URL`).
