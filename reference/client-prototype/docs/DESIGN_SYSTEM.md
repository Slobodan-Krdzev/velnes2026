# Design System

Extract exact values from the `:root` block at the top of `index.html`'s stylesheet —
that file is the source of truth. Summary of what the UI uses:

## Tokens

| Token | Role |
|---|---|
| `--brand` `#FF8D67` | Primary coral: CTAs, active states, badges, links |
| `--ink` `#4D2A1F` | Primary text (warm brown) |
| `--bg` `#FFF9F7` | App background (cream) |
| `--warm` | Soft warm fill (segmented controls, hovers, input prefixes) |
| `--line` / `--line-soft` | Borders / hairlines |
| `--muted` | Secondary text |
| Semantic badge palettes | ok `#EAF2E4`/`#3E5A34`, warn `#FFF3E0`/`#9A6A1F`, alert `#FBEFE9`/`#B4531F`, muted `--warm` |

Radii: inputs/small 12 · cards 14–18 · pills/badges 999. Buttons: `.btn` base with
`.btn-p` (filled brand) and `.btn-g` (ghost/outline); full-width inside cards/dialogs.

## Typography

- Display serif: **Yeseva One** (`.serif`) — hero, section headings, screen titles,
  point balances. Desktop hero h1 is 64px (mobile keeps its own scale).
- UI sans: **Plus Jakarta Sans** — everything else. Small text ~12–13.5px, body ~14–15px.

## Component inventory (prototype class → purpose)

| Class | Component |
|---|---|
| `.btn .btn-p / .btn-g` | Primary / ghost buttons |
| `.chip`, `.tiny-tag`, `.rating` | Filter chip, mini tag, star rating |
| `.tr-card` (+`.dtr` desktop) | Selectable service/product card (icon, name, duration/『Product』, price, check) |
| `.prod-tg` + `#prodbody` | Collapsible section header (chevron rotates via `aria-expanded`) |
| `.dcart` (+`.min`) | Floating booking cart: rows, when-line, total, CTA, minimize pill |
| `.acc-card / .acc-kv / .acc-row / .acc-lbl` | Account card, key-value row, media row, section label |
| `.acc-badge ok/warn/off/mut` | Status badges (Confirmed/Paid, Pay at salon, Cancelled, neutral) |
| `.acc-seg` | Segmented tabs (Upcoming/Past/Cancelled) |
| `.acc-menu` / `.acc-chips` | Sidebar menu (≥1024) / horizontal section chips (<1024), unread count pill |
| `.acc-me`, `.avdot`, `.avchip` | Profile block, avatar (initials or photo), header account chip with badge |
| `.acc-bell` + `.acc-bdg` | Bell button + synced unread badge (same badge class rides the mobile nav tab and avatar chip) |
| `.vnav` | Mobile bottom navigation (Home · Search · Appointments · My Velnes) |
| `.gps-modal/.gps-card` + `#acc-modal` | One dialog container: bottom sheet <1024, right drawer ≥1024 (`accSlide` animation, backdrop click closes) |
| `.acc-inp`, `.acc-flbl`, `.acc-err`, `.ph-wrap` | Form input, label, inline error, combined flag+code+number phone input |
| `.cal*` | Styled date picker (month/year selects, ‹ ›, Monday-first grid, brand-filled selected day) |
| `.reg-dots` | Wizard progress dots |
| `.acc-empty` | Empty state (title, copy, CTA) |
| `.acc-off` | Offer card (photo, type flag, strike-through was-price, CTA) |

## Breakpoints & layout rules

- `900px`: legacy desktop/mobile env swap; `.vnav` and mobile paddings live below it;
  desktop floating cart and hero enlargement live above it.
- `1024px`: account sidebar vs chips; dialogs drawer vs sheet; nested back button hidden
  (sidebar covers navigation).
- Account content column max-width 720px; auth pages 440px; account shell grid
  `270px + 1fr`, sidebar sticky.

## Principles to preserve (from the product instructions)

Premium-calm visual tone; progressive disclosure (4 treatments → View all; products
collapsed; smart defaults over filters); one primary action per screen; explainable
recommendations; no dark patterns; real-looking data and photography in hi-fi screens.
