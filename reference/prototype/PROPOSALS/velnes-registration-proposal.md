# Proposal — Salon registration (classic wizard) + login · 21 aug 2026

**Status: awaiting Alex's approval. No code has been changed.**
Base build: `11dc36a731f876e38f5294785e883590` (20,433 lines).
Roadmap slot: after multi-merchant, deliberately — the wizard's company
step creates the salon's default LegalEntity from birth, so no early
tenant ever needs a migration.

## What exists / what doesn't (verified)

The AI onboarding (stages source → … → claim → verify → welcome) is the
premium path and stays untouched. There is **no** classic step-by-step
wizard, **no** login screen, and no sign-out in the desktop shell (the
mobile shell has one). The prototype boots straight into the demo
session — and must keep doing so (24 suites depend on it).

## A. Two new full-screen routes, outside the app shell

Like `book` and `onboarding`: **`login`** and **`register`**. Boot is
unchanged (demo session, all suites unaffected); the routes are reached
by address (`#login`, `#register`), from a new **Sign out** item in the
desktop user menu → login, and from AI-onboarding's source screen
gaining a modest "Prefer the classic form?" link (the two paths must
know about each other).

**Login** — email + password, demo accounts listed honestly (this is a
prototype: "any listed account, password `demo`"), "Create your salon"
→ register. Successful login = pick the matching session user, enter
the app. No real auth claims anywhere.

## B. The wizard — seven steps, one draft, one door

State `state.reg` (a single draft object), a step rail showing
progress, back/next with per-step validation, every field surviving
navigation both ways.

1. **Account** — owner name, email, password. Email-format and
   duplicate check (against existing users — honest error).
2. **Salon** — name, type (from the existing business-type vocabulary),
   phone, languages.
3. **Company & legal** — legal name, tax number, VAT registration,
   currency. This step *is* the LegalEntity intake: the draft carries a
   complete entity per the multi-merchant model. Copy explains why in
   one sentence ("this is who legally sells").
4. **Location** — address fields *plus* the map pin: an honest stub map
   (SVG street grid, clearly labeled "demo map"), draggable pin writing
   lat/lng to the draft, with the address fields as the source of truth
   and the pin as refinement — exactly the production contract
   (geocode → adjust). No external tiles, no network dependency. The
   color-picker lesson applies: dragging updates via the input-time
   light path, never a full re-render mid-drag.
5. **Catalog starter** — pick a starter set (Physio / Beauty / Wellness
   templates derived from the existing service vocabulary) and tick the
   services to begin with; each editable later, says so.
6. **Team & hours** — invite rows (name + email, add/remove) and the
   default weekly hours grid (reusing the hours vocabulary, simplified:
   open/close per day + closed toggle).
7. **Review & submit** — every section summarized with per-section
   Edit links jumping back to the step; submit only enabled when every
   step validates.

## C. What submit does (the honest prototype boundary)

In production: tenant provisioning. In the prototype, submit writes a
**`registrations`** row — the full draft, status `pending`, timestamped
— and shows a confirmation screen ("Your salon is being set up — HQ
activates new salons"). Then:

**HQ › Customers gains a "New registrations" card** listing pending
rows (salon, owner, city, submitted-when) with **Activate** /
**Decline** — activation flips status and logs to the audit log. No
actual second tenant is created (the demo world is single-tenant;
faking a second one would ripple through every screen dishonestly).
The docs state this boundary in one line, same discipline as
"Advance stage · demo".

The AI onboarding's claim path and this wizard converge on the same
`registrations` door — two front doors, one intake table, which is
exactly the production shape.

## D. Explicitly out of scope

Real provisioning, e-mail sending/verification, password hashing or
strength theater, forgot-password, supplier registration (HQ-managed,
per the earlier decision), Employee-App login (its own surface later).

## E. Tests — `test-registration.js` (~45 checks)

Route reachability (address + sign-out path + the cross-link from AI
onboarding); wizard: per-step validation blocks Next with the honest
message, values survive back-and-forth, duplicate email refused; map
pin: drag updates draft lat/lng without re-rendering the input (the
color-picker assertion pattern); review: edit-links land on the right
step, submit disabled until valid; submit: registrations row complete
(entity fields present per the multi-merchant model), confirmation
shown; HQ: pending card renders, Activate flips status + audit row,
Decline likewise; boot unchanged (no login gate — the demo session
still opens directly; asserted). Regression: screens (two new
full-screen routes must be registered in SCREENS/addresses — the
onboarding precedent shows how the suite enumerates them; intentional
suite additions listed), headers, rolekits, onboarding-look, plus the
usual till suites untouched-by-construction.

## Sizing

Between the embed feature and Velnes Premium: one wizard surface,
two auth screens, one HQ card, one suite. Single delivery.

## Definition of done

Login + wizard reachable and validated; draft → registrations row with
a complete LegalEntity intake; HQ activation loop with audit; map pin
draggable and honest; boot untouched; all suites green; chain +
`REGISTRATION-DOCS.md` + addendum.
