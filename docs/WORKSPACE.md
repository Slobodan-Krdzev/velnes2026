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

**Settings parity (2026-08-26).** The full 13-section prototype nav
with `SEC_PERM` gating and group-header hiding. Pure-choice config
lives in one `businesses.settings` jsonb document behind GET/PATCH
`/business-settings` (zod defaults fill unsaved sections; each
section keeps the prototype's permission split); the business card
(name/address/phone/description/gallery-as-data-URLs + read-only
HQ-managed legal block + `timing_enabled`) sits behind GET/PATCH
`/business`. Opening hours edits the location's real week + cancel
window through audited PATCH `/locations/:id` — the same truth
`scheduleFor` reads — with the Phase-3 exceptions/holidays doors for
the Exceptions tab. Schedules & services persists per-employee
roleTitle/week/skills through the extended employee PATCH. Honest
deferrals: General's tz/currency/week-start render read-only (per-
location / fixed for MK); the online-booking deposit and per-location
online toggles wait for payments and a real door; marketplace choices
are stored now, honored when §5 search/discovery starts; the form
builder and commission stay disabled.

**E2E.** Four Playwright journeys run in CI against the migrated +
seeded stack: flightdeck, calendar booking, till sale → invoice →
audit, and the trilingual chrome flip.

**Reports (2026-08-31).** One computed door — GET `/reports?from&to`
— reads the same tables the till and calendar write and returns the
whole document: totals with previous-period deltas, revenue per day,
and the six panes (locations, booking sources with the marketplace
fee, services, products with live stock, employees with utilisation
against their own week, VAT reconciling to invoice revenue). Scope
follows the permission: location/business-wide readers see all,
`reports.view_own` sees exactly their own rows. The screen is the
prototype's viewReports with a period filter and a real CSV download
per pane. The seed carries ten deterministic weeks of history
(appointment + paid invoice pairs, sources rotated, six no-shows)
kept away from the customers whose exact figures the suites assert.
