# Screens & Flows

Navigation in the prototype is a single-page screen switcher: `go(name)` shows the
`[data-screen="name"]` section and hides the rest. The account area is one screen
(`myvelnes`) with an internal section state (`accSec`). In React these become routes
(see the routing map in `REACT_VITE_MIGRATION.md`).

## Screen inventory

| Screen | Purpose | Entry points |
|---|---|---|
| `home` | Hero + one search field + category cards + recommendations | logo, bottom-nav Home, empty-state CTAs |
| `results` | Category results: best match + alternatives + map placeholder, per-category data | category cards, search sheet suggestions, Book-again fallback |
| `salon` | Salon 3 destination page: treatments, **products (collapsible)**, date & time, professional, summary; **desktop floating cart** | results best-match/rows, favourites "View salon", Book again, personal offer |
| `email` → `verify` → `profile` | Guest booking identity steps (skipped entirely when signed in) | `bookSalon`/`bookSvc`/desktop cart when logged out |
| `confirm` | Booking confirmation summary | all booking paths |
| `login` | Email + password; restores the seeded demo account | header "Log in" (desktop + mobile), register footer link |
| `register` | 6-step wizard (see below) | login footer link |
| `myvelnes` | Account shell: sidebar (≥1024) / profile + chips (<1024) + content pane | avatar chip, bottom-nav My Velnes, deep links |

## Account sections (`accSec` inside `myvelnes`)

`over` (landing: profile hero + Offers) · `general` · `appts` · `appt` (detail; back → appts) ·
`favs` · `billing` · `notifs` · `loyalty` · `premium`.
Sidebar order: General, Appointments, Favourites, Billing, Notifications (unread pill),
Loyalty, Velnes Premium, Log out. Offers deliberately have **no** menu item — they live
on the landing.

## Booking flows

**Signed-in (any surface):** selection → `confirm` directly, and an appointment record +
confirmation notification are created in the account (email/verify skipped).

**Guest:** selection → `email` → `verify` (code) → `profile` (optional) → `confirm`.

**Desktop salon cart (≥ 900px):**
1. All 8 service cards and 4 product cards are multi-select toggles (nothing preselected).
2. First selected item opens the floating bottom-right panel: line items with remove,
   live `date · time · professional` line, total, Book now.
3. Products alone cannot book (button disabled + hint) — a booking needs ≥1 service.
4. Panel header arrow minimizes it to a `N items · total` pill; adding while minimized
   updates the pill; a fresh selection after emptying auto-expands.
5. Book now composes the label (`Haircut + Coloring · 105 min · 2 products`), total, and
   routes signed-in → confirm (+account record) or guest → email step.
6. The inline summary bar mirrors the cart; its old Book now button is removed
   (desktop only — the mobile bar is unchanged).

**Mobile/tablet salon:** unchanged single-select (`pickTr`, scoped away from desktop
cards) with the bottom booking bar.

**Book again / personal offer:** seed the desktop cart with the salon-page price and
preselect the matching card; non-Salon-3 rebooks route to the matching category results.
Premium last-minute offer books instantly into `confirm`.

## Registration wizard (constant title "Welcome to Velnes")

1. Name → 2. Email → 3. Phone (combined **flag + code + number** input) →
4. Password (≥6, repeat) → 5. DOB via **styled calendar** (optional) + language select
(English/Македонски/Shqip) + terms → 6. **Email verification code** (mock; SMTP later).
Progress dots ×6, per-step validation with inline errors, Back preserves all values,
completion creates a fresh empty account and signs in.

## Notifications

Header/nav badges (desktop avatar-chip badge, mobile My Velnes tab badge, sidebar pill,
chips pill) all sync from one unread count. Deep links: appointment → detail,
offer → account landing, loyalty → loyalty, account/premium → those sections.
"Mark all as read" clears everywhere. New notifications are pushed by: booking,
cancellation, refund, phone add/change, Bazaar redemption, Premium join/cancel/resume.

## Empty states (all reachable via a fresh registered account)

No upcoming/past/cancelled appointments · no favourites · no offers · no loyalty
activity (with "Find a service" CTA) · empty billing history · Premium "Not active"
with a working Join flow. Every empty state has a next-best action.

## Dialog presentation

One container serves all account dialogs (cancel, review, edit info + avatar,
phone add/change, password, add card, payment details, Premium management):
bottom **sheet** below 1024px, right-side **drawer** (slide-in, backdrop click closes)
at ≥1024px.
