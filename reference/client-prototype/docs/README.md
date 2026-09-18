# Velnes Consumer Frontend — Prototype Handover

This package hands the validated single-file prototype to the development team as the
reference implementation for the production **React + Vite** application. The production
app reads all data through an **external API** (separate system, its own data shapes) —
see `DATA_MODEL_AND_API.md` for the adapter approach that decouples the UI from that API.

## Package contents

| File | Purpose |
|---|---|
| `index.html` | The complete working prototype (single self-contained file). Open it directly in a browser or serve statically. This is the source of truth for UX, flows, copy, and visual design. |
| `docs/README.md` | This file. |
| `docs/SCREENS_AND_FLOWS.md` | Every screen, navigation rule, and interactive flow. |
| `docs/DATA_MODEL_AND_API.md` | UI view models, mutation map, suggested endpoints, **API adapter guidance**. |
| `docs/DESIGN_SYSTEM.md` | Tokens, typography, components, breakpoints. |
| `docs/REACT_VITE_MIGRATION.md` | Target architecture, routing map, component mapping, acceptance checklist. |

## Running the prototype

No build step. Either open `index.html` directly, or serve it:

```
npx serve .        # or: python3 -m http.server
```

Everything (CSS, JS, three photos as base64) is inline in the one file (~950 KB).
State is in-memory only — a reload resets to the seeded data. That is intentional.

## Demo accounts

- **Boot state:** signed in as the seeded customer **Ana Petrova** (full account:
  6 appointments, payments, 2.450 loyalty points, Premium active, offers, favourites,
  2 unread notifications).
- **Log in** (any password, email prefilled): restores the pristine Ana seed regardless
  of what the session changed.
- **Register** (6-step wizard incl. mock email code): creates a **fresh empty account** —
  the fastest way to review every empty state, the non-Premium experience, and the
  "Join Premium" flow.
- **Log out:** returns to the original logged-out experience (no bottom nav, Log in entry
  in both headers).

## Environments and breakpoints (important)

| Range | Behavior |
|---|---|
| `< 900px` | Legacy mobile env (`.m-env`) + bottom navigation (`.vnav`). |
| `≥ 900px` | Legacy desktop env (`.d-env`) with the site header. |
| `< 1024px` | Account area uses the **chip layout** (profile block + horizontal section chips). |
| `≥ 1024px` | Account area uses the **sidebar layout**; all account dialogs become right-side **drawers**; the salon page shows the **floating booking cart**. |

The seven original screens exist twice (desktop + mobile markup duplication — a legacy
convention). The account layer, auth pages, and everything newer are built **once,
responsively**. The React build must follow the responsive approach everywhere —
do **not** port the duplication (see `REACT_VITE_MIGRATION.md`).

## Known, deliberate prototype seams

- **Currency:** discovery/search/salon surfaces use `€` (with some `MKD` on home
  recommendation cards); the customer-account seed is consistently `MKD`. Production
  must standardize (expected: MKD) — the API is the right place to fix this.
- **Auth is mocked:** any password logs into the demo; register's email code accepts any
  4 digits (SMTP is a development task); phone SMS codes likewise.
- **Payments are mocked:** card tokens only; no CVV is ever collected or stored.
- **Only Salon 3** has a full salon page; other venues route to category results.
- **Language setting** offers English / Македонски / Shqip, but the UI copy is English —
  full i18n is a development task.

## Verification status at handover

Every interactive behavior listed in `REACT_VITE_MIGRATION.md → Acceptance checklist`
passes an automated headless (jsdom) walkthrough against this exact file.
Markup tag-balance verified. `index.html` SHA-256:

```
a5a1c743c8e1d734b95c3102cf5eee0d8c9aa7aabfa810ac2cd62dac96f8d94a
```
