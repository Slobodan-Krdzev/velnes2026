# Handover addendum — Customer Intelligence (18 aug 2026, sessie 2)

Supplement to HANDOVER-18aug.md. That document stays authoritative for
everything it covers; this one documents the Customer Intelligence
feature built and verified today.

## File integrity chain (md5, per working agreement)

| Step | md5 | Lines |
|---|---|---|
| Baseline (= previous delivery) | `a5773f4346c9f0c42a04456a6af07691` | 18,773 |
| + data & stats engine | `dbbcb9062cc1a7db5e087be40edf9d41` | 19,115 |
| + seeder rhythm fix | `0e99c3349e34d85691ae422bc4a26ef7` | 19,118 |
| + state/handlers/list (Part A) | `03de685e1912455b058891d5463226cb` | 19,165 |
| + profile page (Part B) | `a4556ead0ab2ac487550255b04bb2c09` | 19,288 |
| + offer bridge & birthday (C+D) | `074f30505f40086ae4be320cf7596a53` | 19,331 |
| + birthday moved to custSections | `c3263ac0b710efa8cd80aa19ba79ebb3` | 19,333 |
| dead-code dedup | `eb7c325cbae6dce61d7a560e2493fecf` | 19,331 |
| **DELIVERED** (UI glow-up) | **`a57124cde9157a81bfd2ba809a90bc0b`** | **19,343** |

No unexplained code appeared this session. Every patch was applied via
scripted, uniqueness-asserted string replacement; every anchor asserted
`count==1` before replacing.

## What was built

Approved proposal: `velnes-customer-intelligence-proposal.md` (same
folder). All of it is implemented, plus Alex's five additions: first
visit with details, last visit with details, favorite services **and
products**, total spend, average per visit.

### 1. Data (prototype only — deleted in production)
`custHistory[]`, seeded by a fixed-LCG IIFE directly after the demo
data. Separate from `appointments[]` so the calendar and booking gate
never see it. Personas:
- **Marija c4** — 98 visits / 268,800 MKD over ~3y. Two-weekly Fridays
  → weekly in the last ~10 months (steps of exactly 14 and 7 days so
  the IQR gate passes and the trend is measurable). 80% e1, afternoon
  band 14–17, s2 core, s5 taping rides same-day until 210 days ago
  (lapsed), p2/p3 items periodically, 2 cancelled rows.
- **Katerina c1** — 38 visits, 33–37-day jittered gaps (deliberately
  not a multiple of 7), last visit 52 days ago → 17 days overdue.
  1 no-show row.
- **Ivana c2** — 21 visits, gaps alternating 16/65, rotating
  employees/services/times. **Produces zero claims by design.**
- **c3/c5/c6** — no history; `custStats` falls back to the stored
  `visits`/`spend` fields (the fallback that production drops).
- Birthdays: c4 gets `'1988'+addDays(TODAY,9).slice(4)` (fires the
  suggestion, always, regardless of when the demo runs); c1 is 120 days
  out (proves silence).

### 2. Engine — one door
- `custStats(cid)` → `{seeded, totals{visits,spend,avgSpend,firstDate,
  lastDate}, firstVisit, lastVisit, services[], products[], times[],
  weekdays[], employees[], cadence{medianGapDays,sampleSize,trend,
  steady}, overdueDays, lapsedServices[], favoriteService,
  favoriteProduct}`.
  - Completed only. **Visits are distinct dates**, not rows (two
    treatments in one sitting = one visit).
  - `apptTotal(a)` = service price + till items → total spend covers
    services **and** products.
  - Median for cadence; **rhythm claimed only if IQR/median ≤ 0.6**
    (`CI.RHYTHM_SPREAD`) — without this gate every customer with enough
    visits gets a "rhythm", because a median always yields a number.
  - Trend: recent-182-day median vs. older, ≥20% shift, only when steady.
- `custHistoryPage(cid,page)` — 15/page, all statuses, newest first.
  **This is the production pagination boundary.**
- `custTrends(cid)` / `custSuggestions(cid)` — rules read only
  `custStats` output (the exact JSON a future AI endpoint receives).
  Every claim carries a `why`. Overdue/high-value/birthday have no
  action button (no messaging channel exists); offer and win-back do.
- `aiAnalysis(cid)` — V1 deterministic composer over the same data,
  labelled "Generated from this customer's booking history". Production
  swaps the inside for a model call; the contract is the seam.
- Thresholds live in `CI` (mirrors `TIMING`): MIN_VISITS 5,
  MIN_EMP_PCT 60, MIN_WD_PCT 45, MIN_BAND_PCT 50, RHYTHM_SPREAD .6,
  LAPSE_MIN 4, LAPSE_WINDOW 180, OVERDUE_FACTOR 1.4, TREND_WINDOW 182,
  TREND_PCT .20, HIVAL_FACTOR 2 / HIVAL_DAYS 90, BDAY_WINDOW 14, PAGE 15.

### 3. List screen
- `sortPop()` — own pill next to Filters (13-aug single-dimension
  filter decision untouched). Options: Default / Most / Fewest visits /
  Highest / Lowest spend. Spend sorts hidden without
  `customers.view_business`. **Default = original array order** →
  zero regression by construction.
- Visits/Spend columns now show derived numbers (`custStats`), View
  button (`data-goprofile`) added before Edit.

### 4. Customer page (`viewProfile`, existing route reused — no new screen)
- Toolbar: **Analyse with AI** ↔ **Back to charts** (full only).
- KPI rows (full): Visits · Lifetime spend · Average per visit · Last
  visit / Favorite service · Favorite product · Loyalty points ·
  Prepaid. Non-full path visually unchanged apart from derived visits.
- Identity card: membership badge (full), Can book / Booking blocked.
- Left column: **First visit** and **Last visit** cards with per-row
  service · employee · time · amount and a visit total.
- Insights (full only): Trends card, Suggestions card (with real
  buttons), three chart sections — services / times / spend incl.
  "Products at the till" — each individually collapsible via
  `data-cisec` (services open by default), **Expand all** via
  `data-ciexpand`. AI mode replaces all of it with the narrative panel.
- **AI panel styling (glow-up, same day):** the panel wears the
  flightdeck hero jacket (`.fd-hero` + `.fd-kicker`, accent tint,
  sparkle icon) so the analysis carries the same visual rank as
  "Priority of today". The suggestions render **inside** the panel as
  "Recommended actions" with their live buttons — analysis and advice
  read the same JSON, so the analyser knows them by construction. The
  toolbar button carries the sparkle icon too.
- **Edit details** in the profile toolbar now opens the real edit
  drawer (`data-panel="customerEdit|{id}"` → custSections), identical
  to the Edit button on the customers table.
- Appointments tab: existing upcoming/past rows kept, seeded history
  appended paged (15) with **Load More** (`data-cimore`); cancelled and
  no-show rows dimmed with a danger badge, excluded from all metrics.
- CI view-state (`ciMode`, `ciOpen`, `ciPage`) resets in the
  `data-goprofile` handler.

### 5. The bridge to the yield engine — `openOfferFor(cid,kind,sid)`
The flightdeck pattern aimed at one person:
- Location = last visit's; date = next preferred weekday if the
  weekday rule fires, else tomorrow; capacity pre-selection filtered to
  the preferred 3-hour band when one exists (falls back to all).
- Draft carries `person:{cid,name}`, `publicOn:false`, and
  `winbackSid` for win-backs.
- `saveOffer` ph1: `audience:'SPECIFIC_CUSTOMERS'`,
  `customerIds:[cid]` (`phaseAllows` — note the name, **not**
  phaseApplies — already resolved this audience; it now has its first
  real sender). No public phase → single-phase offer.
- Drawer: audience becomes a read-only "«name» — personal offer"
  field; section pill and panel ident say "Personal offer for «name»".
- `AUDIENCE_V1` now includes `SPECIFIC_CUSTOMERS`.
- V1 boundary: win-back leaves `eligibleVariantIds` empty (all
  services); the lapsed service is named in the flow, not enforced.

### 6. Birthday field
Optional date field in the edit drawer, **custSections › General**
(`data-inline="{id}|birthday"`). Without the field the birthday rule is
silent — never guessed.

## Tests
New: `test-customerci.js` — **126/126** (incl. hero styling, embedded recommended actions, and Edit-details-opens-the-real-drawer). Covers exact seed numbers,
threshold silence (Ivana, c6), first/last visit details, trends+why,
suggestions incl. the offer drawer opening with the right audience and
saving `SPECIFIC_CUSTOMERS`+`["c4"]`, `phaseAllows` yes/no, sort pill
incl. permission-hidden spend sorts and Default restoring original
order, per-section collapse + Expand all, AI mode swap, history paging,
birthday field presence and rule silence without it, and the
frontdesk-role (e4) reduced page.

Full regression, all green against the delivered file:
screens 510, exceptions 83, hours-toggle 29, splitshift 74, timing 122,
pos 112, offers 50, flightdeck 28, editor 53, apptedit 29, roles 15,
headers 28, rolekits 75, ranking 36, ownuse 47, calendar 68,
datepick 42, empcolor 42, responsive 70, onboarding-look 68,
scrollbar 12, settings-scroll 43. **≈1,655 checks, 0 failures.**

## Production API spec (for the .NET team)
Mirror the helpers one-to-one:
- `GET /customers/:id/insights` → the `custStats` shape (server
  aggregates; `seeded` disappears). Consider caching per customer with
  invalidation on appointment/sale completion.
- `GET /customers/:id/history?page=n&size=15` → the `custHistoryPage`
  shape (`rows`, `hasMore`, `total`), all statuses, newest first.
- `GET /customers?sort=visits_desc|spend_desc|…` replaces the in-memory
  list sort.
- Products per visit = appointment + linked order lines (the `items`
  model here is that join, flattened).
- AI analysis: POST the insights JSON to the model endpoint;
  `aiAnalysis()` shows exactly what the prompt payload should contain.
- Thresholds (`CI`) become server configuration.

## Pitfalls found this session (add to the standing list)
1. **`customerEditBody` is dead code.** The real edit drawer is
   `PANELS.customerEdit → custSections(id)`. Fields added to
   `customerEditBody` render nowhere. (Cost me one round; the birthday
   field now lives only in custSections. Candidate for removal in a
   cleanup pass.)
2. **`document.body.textContent` includes the app's own script
   source.** Absence assertions ("string X is not on screen") must
   scope to `#view`, or they false-fail on the source code itself.
3. **The audience gate is `phaseAllows`**, not `phaseApplies` (the
   older handover used the wrong name once).
4. **Seeded gaps must avoid multiples of 7** unless a weekday pattern
   is intended — 35- or 70-day steps land every visit on the same
   weekday and falsely fire the weekday rule (bit both Katerina and
   Ivana in draft one).
5. Friday-snapping with jitter destroys rhythm-steadiness; use exact
   7/14-day steps for a persona that must claim both a weekday **and**
   a cadence.
6. (Standing) suites must run with cwd `/home/claude/velnes`; jsdom
   resolves from `/home/claude/node_modules`.

## Open items
- Herkomstbesluit (ghost-code provenance) — still Alex's call; still no
  Netlify deploy until decided.
- Kassa + widget through `priceFor()` (carried over).
- Win-back service enforcement via `eligibleVariantIds` (V1 leaves it
  open; needs the variant-id mapping decision).
- Overdue/birthday/high-value suggestions get action buttons the day a
  messaging channel exists.
- Optional cleanup: delete dead `customerEditBody`.
- Charts are hand-rolled divs in house tokens; a heatmap for times is a
  rendering swap if ever wanted.
