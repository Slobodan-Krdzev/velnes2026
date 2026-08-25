# Phase 5 — Salon Workspace

**Pixel fidelity is structural.** The prototype's entire stylesheet
lives verbatim in `packages/ui/src/prototype.css` and every screen
emits the prototype's own markup (extracted from its `viewX()`
functions). New screens start from the prototype's markup — never
from approximation (see memory: pixel-fidelity-requirement).

**Trilingual.** English, Macedonian, Albanian via `@velnes/i18n`;
key completeness is compiler-enforced, `en.ts` is the source of
truth. UI language is a per-employee preference; booking refusals
carry structured codes + params so every client localizes the one
gate's sentences. Salon-authored content never translates.

**Architecture.** React Router 7 + TanStack Query; `@velnes/client`
holds the one API client (token rotation, zod parsing at the
boundary — runtime singletons are peer-deps only) and the session
provider. Permission-gated navigation via the shared `can()`
vocabulary; the screen hides, the server still decides.

**Screens.** Login (viewLogin) · Shell (icon rail, topbar, loc-scope
switcher, avatar/env menu) · Calendar (day/week grids, employee
colours, prep/reset bands, the booking drawer over availability +
line-quote) · Cash register (viewRegister: POS types, category tiles,
receipt, extras, payment modal → finishSale; invoices + refunds) ·
Catalog (viewCatalog: grouped tables, service editor with variants/
modifiers/per-location table, products with ledger stock edits) ·
Settings (locations lifecycle cards with the readiness checklist and
owner-only Activate, team & access, the roles permission matrix
constrained to scopeChoices, audit log) · Flightdeck (today's pulse +
the timing-suggestions stack).

**E2E.** Four Playwright journeys run in CI against the migrated +
seeded stack: flightdeck, calendar booking, till sale → invoice →
audit, and the trilingual chrome flip.
