# React + Vite Migration Guide

Goal: rebuild `index.html` as a React + Vite app that renders the same UX from an
external API. The prototype is the **behavioral spec**; this doc maps it onto a
production architecture.

## Proposed structure

```
src/
  app/                 # router, layouts (SiteHeader, MobileTabBar, AccountShell)
  components/ui/       # Button, Card, Badge, Chip, Input, PhoneInput, DatePicker,
                       # SegmentedTabs, Sheet/Drawer (one Dialog, responsive), EmptyState
  features/
    discovery/         # home, categories, results
    salon/             # salon page, service/product cards, BookingCartPanel
    booking/           # guest identity steps, confirm
    auth/              # login, register wizard (6 steps)
    account/           # shell + sections: general, appointments, favourites,
                       # billing, notifications, loyalty, premium, offers(landing)
  lib/api/             # client + mappers (see DATA_MODEL_AND_API.md — adapter layer)
  lib/i18n/            # en / mk / sq resources (copy pass is a scheduled task)
  stores/              # small client state only (booking cart, dialog, wizard)
.env                   # VITE_API_BASE_URL=...
```

State strategy: **TanStack Query** for all server data (me, appointments, offers,
loyalty, notifications…) — badges and hub counts derive from queries, exactly as the
prototype derives them from `ACC`. Client stores stay tiny: `BookingCart`
(replaces globals `st` + `sel`), active dialog, wizard draft.

## Routing map

| Prototype screen / accSec | Route |
|---|---|
| home | `/` |
| results (per category) | `/s/:category` |
| salon | `/salon/:id` (prototype has salon-3 only) |
| guest email/verify/profile | `/book/identity` (steps) |
| confirm | `/book/confirmed` |
| login / register | `/login`, `/register` |
| myvelnes `over` | `/account` |
| general/appts/favs/billing/notifs/loyalty/premium | `/account/<section>` |
| appt detail | `/account/appointments/:id` |

Guards: `/account/*` requires session; signed-in booking skips `/book/identity`.

## Component mapping (prototype → React)

| Prototype | React component | Notes |
|---|---|---|
| `go()` + `[data-screen]` | React Router | delete the switcher |
| `.d-env` / `.m-env` duplication | one responsive tree | **do not port the duplication** |
| `renderSide` (menu+chips) | `<AccountNav/>` | one component, two layouts via CSS |
| `renderAppts/renderAppt/...` | section components | render from query data |
| `accModal` sheet/drawer | `<ResponsiveDialog/>` | all account dialogs share it |
| `selToggle/dcart*` | `<BookingCartPanel/>` + cart store | ≥1 service rule, minimize pill |
| `prodToggle` | `<CollapsibleSection/>` | products collapsed by default |
| `ph-wrap` | `<PhoneInput/>` | flag+code select fused to number field |
| `cal*` | `<DatePicker/>` | keep the styled custom picker |
| register `regStep/regD` | wizard route + draft store | 6 steps, Back preserves values |
| `syncAuth/accBadge` | derived from session + notifications query | one unread source |
| `addBooking/cancelDo/...` | mutations with optimistic or refetch updates | effects per mutation map |

## Deliberately NOT ported

Global mutable state (`st`, `sel`, `ACC`), inline `onclick` strings, the seed-restore
login and “any code works” verifications (real auth/SMTP/SMS), base64 hero photos
(use an asset pipeline/CDN), the €/MKD split (unify via API), `ES5` idioms.

## Environment & integration

- `VITE_API_BASE_URL` for the external system; auth token handling in `lib/api/client`.
- All shapes normalized in `lib/api/mappers` (the separate system’s DTOs stay there).
- Feature-flag Premium/Bazaar if backend lags UI.

## Acceptance checklist (parity with the verified prototype)

Boot & auth: signed-in boot shows badge 2 everywhere · login restores full demo account ·
register: 6 steps, per-step validation, Back preserves data, email code gate, creates
empty account, welcome notification · log out returns the guest experience.

Account: hub landing = profile hero + offers · sidebar/chips switch at 1024 with active
states + unread pill · appointments tabs 2/3/1 with detail (ref, payment method, policy) ·
cancel unpaid vs paid (refund row + notification) · book again preselects service/pro ·
review only on completed, appears on the appointment · favourites add/remove syncs counts ·
billing: set default, remove, add card (brand/last4 derived, bad input rejected), payment
detail modal with appointment deep link · loyalty balance/ledger, Bazaar redeem deducts
and notifies, empty state for new users · Premium ACTIVE ⇄ CANCELS_AT_PERIOD_END, NONE →
Join flow, ×1.5 multiplier only while Premium · notifications deep-link and mark-all-read
clears every badge · profile edit incl. avatar upload/remove with draft-cancel semantics ·
phones: combined input, SMS verify, primary guarded · password change validation ·
email read-only.

Booking: desktop multi-select services + products, totals math, products-only blocked,
cart minimize/expand/pill updates, cart booking creates the account appointment with
composed label + total · mobile single-select flow and bottom bar unchanged · guest path
via identity steps · confirm shows venue/service/when/price/professional.

Dialogs: sheet <1024, right drawer ≥1024, backdrop click closes, panel click doesn’t.

## Open items after migration start

i18n copy extraction (en/mk/sq) · currency unification · real availability engine ·
map view · payment provider + receipts · reviews listing screen · notification
preferences · remaining salon pages beyond Salon 3.
