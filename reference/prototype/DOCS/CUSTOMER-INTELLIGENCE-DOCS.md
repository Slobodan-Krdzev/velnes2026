# Customer Intelligence — Feature Documentation
**Velnes Business prototype · file version `a57124cde9157a81bfd2ba809a90bc0b` (19,343 lines) · 18 aug 2026**

This is the working document for upgrading the feature. It covers the
architecture, every function and its contract, every DOM hook, the
thresholds, the seeded demo data, and — most importantly — **where to
cut when you change something**, so an upgrade lands in one place
instead of five.

---

## 1. Architecture in one paragraph

Everything derived about one customer flows through a single helper
family, the way availability flows through `scheduleFor()` and pricing
through `priceFor()`. **No screen computes a metric itself.** The
prototype computes from a seeded history array; production replaces the
*inside* of two functions with API calls and nothing else changes. The
rules (trends, suggestions) and the AI narrative all read the same
stats object — one input contract, three consumers.

```
custHistory[] (seeded demo data — deleted in production)
      │
      ▼
custStats(cid) ──────────────► the ONE door for derived numbers
      │                            │
      ├── custTrends(cid)          │  UI surfaces read these,
      ├── custSuggestions(cid)     │  never the raw array:
      └── aiAnalysis(cid)          │
                                   ├── viewCustomers (list: sort + columns)
custHistoryPage(cid,page) ────────►├── viewProfile (KPIs, cards, charts)
   (separate door = the future     ├── ciInsights (trends/sugs/charts/AI)
    pagination endpoint)           └── openOfferFor (offer drawer bridge)
```

---

## 2. Where everything lives (search anchors, not line numbers)

Line numbers shift; these strings are unique — find them with Ctrl-F.

| Piece | Search for |
|---|---|
| Thresholds | `const CI={MIN_VISITS` |
| Seeded history | `const custHistory=[];` |
| Seeder personas | `── Marija (c4` / `── Katerina (c1` / `── Ivana (c2` |
| Row amount helper | `const apptTotal=` |
| Stats engine | `function custStats(cid)` |
| History pagination | `function custHistoryPage(` |
| Trend rules | `function custTrends(` |
| Suggestion rules | `function custSuggestions(` |
| AI narrative composer | `function aiAnalysis(` |
| Chart bar renderer | `const ciBar=` |
| First/last visit card | `function ciVisitCard(` |
| Section open-state | `function ciOpenDefault(` |
| Collapsible chart card | `function ciSection(` |
| KPI rows | `function ciKpiBlock(` |
| Insights block (incl. AI panel) | `function ciInsights(` |
| Sort pill | `function sortPop(` |
| List sorting | `Afgeleide cijfers winnen` |
| Profile page | `function viewProfile(` |
| Offer bridge | `function openOfferFor(` |
| Personal-offer save path | `audience:dr.person?'SPECIFIC_CUSTOMERS'` |
| Personal-offer drawer field | `personal offer` (in `offerPhase1Body`) |
| Birthday field | `Date of birth` (in `custSections` › general) |
| Click handlers | `── Customer Intelligence ──` (inside the delegated click handler) |
| CI view-state init | `customerSort:'default'` (in the state object) |
| Tests | `test-customerci.js` (126 checks) |

---

## 3. The data contract — `custStats(cid)`

This shape **is** the future `GET /customers/:id/insights` response.
Change it here and you change the API spec.

```js
{
  seeded: true|false,        // false = no history → stored-field fallback (production: drop)
  totals: {
    visits,                  // DISTINCT COMPLETED DATES (two services in one sitting = 1 visit)
    spend,                   // Σ apptTotal over completed rows = services + till items
    avgSpend,                // round(spend / visits)
    firstDate, lastDate      // ISO strings
  },
  firstVisit, lastVisit: {   // null when no history
    date,
    rows: [{ sid, service, emp, empName, start, end, amount }],
    amount                   // visit total (all rows that day)
  },
  services:  [{ sid, name, count, spend, pct }],       // sorted by count desc; pct of completed ROWS
  products:  [{ pid, name, qty, spend }],              // from items[]; sorted by qty desc
  times:     [{ hour, count }],                        // per VISIT (first row of the day), sorted by hour
  weekdays:  [{ wd, count }],                          // wd: 0=Monday (wdIdx convention!)
  employees: [{ empId, name, count, pct }],            // per VISIT; sorted by count desc
  cadence: {
    medianGapDays,           // median of gaps between distinct visit dates
    sampleSize,              // number of gaps
    trend,                   // 'up' | 'down' | 'flat' | null (null unless steady + enough samples)
    steady                   // the RHYTHM GATE — see §4
  },
  overdueDays,               // null unless steady AND sinceLast > median × OVERDUE_FACTOR
  lapsedServices: [{ sid, name, count }],   // ≥ LAPSE_MIN bookings, none in LAPSE_WINDOW days
  favoriteService,           // services[0], but null under MIN_VISITS total visits
  favoriteProduct            // products[0] or null
}
```

**Invariants to preserve in any upgrade:**
1. **Completed only.** Cancelled / no-show rows are visible in the
   history list (dimmed) but weigh in *no* metric.
2. **Visits are days, not rows.** All per-visit aggregations (times,
   weekdays, employees, gaps) key on distinct dates; the first row of
   the day represents the visit.
3. **Median, never mean, for cadence** — one holiday gap must not
   break the rhythm (same reasoning as `effTreatment()` in the timing
   engine).
4. **`apptTotal(a) = a.price + Σ(items.qty × items.price)`** — total
   spend covers services *and* products. Production: appointment +
   linked order lines.

`custHistoryPage(cid,page)` is deliberately a **separate** function:
`{rows, hasMore, total}`, pages of `CI.PAGE` (15), *all* statuses,
newest first. It is the production pagination boundary
(`GET /customers/:id/history?page=n`). Never merge it into custStats.

---

## 4. Thresholds — the `CI` constant

All tuning lives in one object (mirrors `TIMING`). **To retune the
feature, edit only this block** — no rule hard-codes a number.

| Key | Value | Governs |
|---|---|---|
| `MIN_VISITS` | 5 | Below this: no favorite, no cadence claim |
| `MIN_EMP_PCT` | 60 | Employee-preference trend fires at ≥60% of visits |
| `MIN_WD_PCT` | 45 | Weekday trend fires at ≥45% of visits |
| `MIN_BAND_PCT` | 50 | 3-hour daypart band fires at ≥50% of visits |
| `RHYTHM_SPREAD` | .6 | **The rhythm gate:** steady ⇔ IQR/median ≤ .6. Without it every customer with enough visits "has a rhythm", because a median always returns a number. Don't remove it. |
| `LAPSE_MIN` | 4 | A service must have ≥4 bookings before it can "lapse" |
| `LAPSE_WINDOW` | 180 | Days of absence that make it lapsed |
| `OVERDUE_FACTOR` | 1.4 | Overdue ⇔ days-since-last > median × 1.4 (and steady) |
| `TREND_WINDOW` | 182 | Recent window for the frequency trend |
| `TREND_PCT` | .20 | Median shift needed to claim up/down |
| `HIVAL_FACTOR` / `HIVAL_DAYS` | 2 / 90 | High-value: last-90-day spend ≥ 2× own prior 90-day average |
| `BDAY_WINDOW` | 14 | Birthday suggestion fires within 14 days |
| `PAGE` | 15 | History page size |

Production note: this object becomes server configuration.

---

## 5. Rules — trends and suggestions

### `custTrends(cid)` → `[{id, text, why}]`
Rule set, each silent without evidence (Ivana c2 proves all of them
silent at once):

| id | Fires when | Example |
|---|---|---|
| `cadence` | `steady` | "Usually returns every 2 weeks." |
| `weekday` | top weekday ≥ MIN_WD_PCT | "Usually books on Fridays." |
| `daypart` | best 3-hour band ≥ MIN_BAND_PCT | "Prefers appointments between 14:00 and 17:00." |
| `employee` | top employee ≥ MIN_EMP_PCT | "80% of appointments are with Maria Petrovska." |
| `lapsed-{sid}` | per lapsed service | "Hasn't booked Medical taping in over 6 months…" |
| `trend` | cadence trend up/down | "Visit frequency has increased over the last 6 months." |

Every entry carries `why` — the numbers behind the sentence. The UI
renders it as a native `<details>` (no state needed).

### `custSuggestions(cid)` → `[{id, text, why, action}]`
`action` is `null` or `{kind:'offer'|'winback', label, sid?}`.
**Rule: no button without a real action behind it.** Overdue, high-value
and birthday are text-only because no messaging channel exists yet.

| id | Fires when | Action |
|---|---|---|
| `overdue` | steady + overdueDays | none (text) |
| `offer` | weekday OR daypart trend | **opens the offer drawer** (§7) |
| `winback` | lapsedServices non-empty | opens the offer drawer with `winbackSid` |
| `hivalue` | recent spend ≥ 2× own average | none (text) |
| `birthday` | `c.birthday` within 14 days | none (text) |

**Adding a rule:** append to the relevant function, give it an `id`, a
`why`, and a threshold in `CI`. It automatically appears in the
Trends/Suggestions cards **and** in the AI panel's "Recommended
actions" (same source). Add one `ok()` in the test for firing and one
for silence (use c2 or c6 for silence).

### `aiAnalysis(cid)` → `[paragraphs]`
V1 is a deterministic composer over `custStats` + `custTrends` +
`custSuggestions`. **The seam:** in production this function POSTs the
stats JSON to a model endpoint and returns its text — nothing else
changes, because the UI only knows "array of paragraphs". The demo
honesty line ("Generated from this customer's booking history") stays
until a real model is behind it.

---

## 6. UI surfaces

### 6.1 List screen (`viewCustomers`)
- **Sort pill** (`sortPop()`) — its own pill next to Filters; the
  13-aug single-dimension-filter decision is untouched. Options:
  Default / Most / Fewest visits / Highest / Lowest spend; spend
  options hidden without `customers.view_business`.
  **`Default` = original array order** — this is a deliberate
  zero-regression guarantee; don't make Default sort by name.
- Visits/Spend columns show **derived** numbers (custStats per row,
  with stored-field fallback for history-less customers).
- **View** button (`data-goprofile="{cid}"`) before Edit.

### 6.2 Customer page (`viewProfile` — existing route, no new screen)
Route `customers` + `state.param`; hash `#customers/c4/...` deep-links.

Layout top→bottom, right column:
1. **KPI rows** (`ciKpiBlock`) — full: Visits · Lifetime spend ·
   Average per visit · Last visit / Favorite service · Favorite
   product · Loyalty points · Prepaid. Non-full: visits/last
   visit/locations/consent (money never rendered).
2. **Insights** (`ciInsights`, full only):
   - normal mode: Trends card → Suggestions card → "Analytics" header
     with **Expand all** → three collapsible chart sections
     (`services`, `times`, `spend` incl. "Products at the till").
   - AI mode (`state.ciMode==='ai'`): everything above is replaced by
     the **fd-hero panel** (§6.3).
3. **Tab card** (existing) — Appointments tab now appends the paged
   seeded history (15/page, Load More, dimmed non-completed rows).

Left column: identity card (+ membership badge when full, Can book /
Booking blocked), note, **First visit** and **Last visit** cards
(`ciVisitCard`: per-row service · employee · time · amount, visit
total).

Toolbar: **✦ Analyse with AI** ↔ **Back to charts** (full only) ·
**Edit details** (opens `PANELS.customerEdit` — the same drawer as the
table's Edit button; General section carries the birthday field) ·
Book appointment.

### 6.3 AI panel styling
The panel reuses the flightdeck hero design system **verbatim**:
`.fd-hero` (accent tint + accent-deep border), `.fd-kicker` (uppercase
eyebrow) with `I.sparkle`, an `<h2>`, narrative `<p>`s, then a
**Recommended actions** block (the suggestions with their live
buttons), `fd-hero-actions` with Back to charts, and the honesty line.
No CI-specific CSS classes exist — restyle by touching `.fd-hero` and
you restyle both surfaces consistently (that's a feature; if they must
diverge, introduce `.ci-hero` alongside).

### 6.4 Charts
Hand-rolled divs via `ciBar(label, val, max, extraText)` — label column
180px, tinted track, accent fill (min-width 3% so tiny values stay
visible). No chart library. A heatmap for "Preferred times" is a
rendering swap inside that one section body.

---

## 7. The offer bridge — `openOfferFor(cid, kind, sid)`

The flightdeck pattern aimed at one person. What it does:
1. Location = the customer's last visit location.
2. Date = next occurrence of the preferred weekday (if the weekday
   rule fires), else tomorrow.
3. `offerDraftInit(loc,date)` as always; empty capacity → toast + stop.
4. Draft additions: `person:{cid,name}`, `publicOn:false` (a personal
   offer never goes public afterwards), `winbackSid` when
   `kind==='winback'`.
5. Capacity pre-selection filtered to the preferred 3-hour band when
   one exists and yields ≥1 slot; otherwise all slots stay picked.
6. `state.edOpen={}` + `openPanel(PANELS.offerNew(),'offerNew')`.

Drawer differences when `dr.person` is set:
- Panel ident: "Personal offer for {name} · {loc} · {date}".
- Early-access section pill shows the name instead of the VIP group.
- Audience is a **read-only** field ("{name} — personal offer").
- `saveOffer` phase 1: `audience:'SPECIFIC_CUSTOMERS'`,
  `customerIds:[cid]`, empty `customerGroupIds`; `publicOn:false` →
  single-phase offer.

The booking gate needed **zero** changes: `phaseAllows` (note: not
"phaseApplies") already resolved `SPECIFIC_CUSTOMERS` via
`ph.customerIds`. `AUDIENCE_V1` now includes it.

**V1 boundary:** win-back does *not* restrict `eligibleVariantIds` to
the lapsed service — the offer is on all services, the lapsed one is
named in the suggestion text. To enforce it, map `sid` → its variant
ids and set `eligibleVariantIds` in `saveOffer` when `dr.winbackSid`.

---

## 8. State, handlers, DOM hooks

### View-state (in the global `state` object)
| Key | Meaning | Reset |
|---|---|---|
| `customerSort` | `'default'\|'visitsDesc'\|'visitsAsc'\|'spendDesc'\|'spendAsc'` | persists |
| `sortMenu` | sort popover open | scrim/outside click, filters toggle |
| `ciMode` | `null` or `'ai'` | on `data-goprofile` |
| `ciOpen` | `{services,times,spend}` bools (lazy via `ciOpenDefault()`, default services only) | on `data-goprofile` |
| `ciPage` | history page index | on `data-goprofile` |

`sortMenu` participates in `barScrim()` and the global outside-click
closer — if you add another popover, wire it into both, same pattern.

### Data attributes (all registered in the delegated-click selector —
**adding a new `data-…` button requires adding it to that selector
string**, or clicks silently do nothing):

| Attribute | On | Handler does |
|---|---|---|
| `data-sortmenu` | sort pill | toggles popover |
| `data-custsort="{key}"` | popover rows | sets sort, closes |
| `data-goprofile="{cid}"` | View buttons | resets CI state, `go('customers',cid)` |
| `data-ciai` / `data-ciback` | toolbar + AI panel | enter/leave AI mode |
| `data-cisec="{key}"` | chart section headers | toggle one section |
| `data-ciexpand` | Analytics header | open all three |
| `data-cimore` | history footer | `ciPage++` |
| `data-cioffer="{cid}\|{kind}\|{sid}"` | suggestion + AI-panel buttons | `openOfferFor(...)` |
| `data-civisit="first\|last"` | visit cards | (marker only, no handler) |
| `data-ciaipanel`, `data-citrends`, `data-cisugs`, `data-cicard="{key}"`, `data-cibar`, `data-cihist` | markers for tests/styling | none |

### Permissions
One permission does all the gating: `customers.view_business`
(`full`). It hides: spend sort options, all money KPIs, the entire
insights block (trends/suggestions/charts/AI — business data), the AI
toolbar button. Visits, visit cards and appointment history stay
visible for `customers.view_location` roles (e4/front desk is the test
persona). **No new permission keys were introduced** — keep it that
way unless a real role need appears.

---

## 9. Seeded demo data (prototype only)

Fixed-LCG IIFE right after the demo customers; deterministic, so tests
assert exact numbers. `custHistory` is **separate from
`appointments[]`** so the calendar and booking gate never see it.

| Persona | Design intent | Exact numbers (asserted in tests) |
|---|---|---|
| **Marija c4** | The showcase: every rule fires | 98 visits, 268,800 MKD, median gap 14, steady, trend **up**, 80% e1, Fridays + 14–17 band, s5 lapsed (23 bookings, last >210d), fav product p2, birthday in 9 days, 123 history rows (incl. 2 cancelled) |
| **Katerina c1** | Overdue reminder | 38 visits, median 35, steady, **17 days overdue**, trend flat, 75% e1, 1 no-show, birthday 120 days out (silent) |
| **Ivana c2** | Thresholds stay silent | 21 visits, gaps 16/65 alternating → not steady, rotating emp/svc/times → **0 trends, 0 suggestions** |
| **c3, c5, c6** | Fallback + empty states | no history; `seeded:false`, stored visits/spend shown |

**Seeder traps (learned the hard way — see handover pitfalls):**
- Gap steps that are **multiples of 7** put every visit on the same
  weekday and falsely fire the weekday rule (bit Katerina at 35 and
  Ivana at 14/70 in draft one — hence 33–37 jitter and 16/65).
- A persona that must claim **both** a weekday **and** a steady cadence
  needs exact 7/14-day steps; snapping-with-jitter blows the IQR gate.
- Birthdays are stored as fixed-year + `addDays(TODAY,n).slice(4)` so
  the demo fires regardless of the real date it runs on.

---

## 10. Production upgrade path (.NET / MSSQL)

Swap the inside of two functions; everything else is UI:

1. **`GET /api/customers/{id}/insights`** → the §3 shape.
   Aggregate server-side from appointments + order lines; drop
   `seeded`. Cache per customer, invalidate on appointment completion
   and till checkout. The `CI` thresholds move to configuration.
2. **`GET /api/customers/{id}/history?page=n&size=15`** →
   `{rows, hasMore, total}`, all statuses, newest first.
3. **List sort** → `GET /api/customers?sort=visits_desc|spend_desc|…`
   (replace the in-memory sort in `viewCustomers`).
4. **AI analysis** → `aiAnalysis` POSTs the insights JSON to the model
   endpoint. The V1 composer shows exactly what the prompt payload must
   contain; keep the deterministic composer as the offline/failure
   fallback.
5. **Personal offers** → the saved offer object already has the final
   shape (`phases[0].audience='SPECIFIC_CUSTOMERS'`,
   `customerIds:[…]`); the server needs the audience resolution that
   `phaseAllows` demonstrates.

SQL sketch for the insights aggregation (matches the invariants):
visits = `COUNT(DISTINCT CAST(date AS date)) WHERE status='completed'`;
gaps via `LAG(date) OVER (ORDER BY date)` on distinct dates, median via
`PERCENTILE_CONT(0.5)`; per-visit dimensions (hour/weekday/employee)
from the first row per date; product favorites/spend from the order
lines joined to same-day completed visits.

---

## 11. How to make the likely upgrades

- **Change a threshold** → edit `CI` only; update the matching exact
  assertion in `test-customerci.js` if the demo numbers shift.
- **Add a trend/suggestion rule** → §5 "Adding a rule". Nothing else:
  cards and AI panel pick it up automatically.
- **Add a chart** → new `ciSection('mykey', …)` in `ciInsights`, add
  `'mykey'` to the `data-ciexpand` handler's array and to
  `ciOpenDefault()` if it should start open; add a collapse test.
- **Restyle the AI panel** → it's `.fd-hero`; shared with the
  flightdeck by design. Diverge only by introducing a new class.
- **Give overdue/birthday a button** → the moment a messaging channel
  exists, set `action:{kind:'message',…}` on the rule and add a
  `kind==='message'` branch where `data-cioffer` is handled. Keep the
  no-button-without-a-real-action rule until then.
- **Add a KPI** → `ciKpiBlock` only; the numbers must come from
  `custStats` (extend §3 if the stat doesn't exist yet — that's an API
  change, note it in the handover).
- **Change history page size** → `CI.PAGE`; the Load More label and
  tests adapt (`total` assertions stay valid).
- **New sort option** → `sortPop()` options array + one branch in the
  sort comparator in `viewCustomers` + the permission filter if it's a
  money sort.
- **Meta row on the AI panel** (the screenshot's "Potential / Time
  needed" line) → add an `fd-hero-meta` div under the `<h2>`; honest
  candidates: `{trends.length} patterns found · {sugs.length} suggested
  actions`.

## 12. Working discipline (unchanged)
md5sum + `wc -l` before every patch and after every delivery; scripted
uniqueness-asserted replacements; suites run with cwd
`/home/claude/velnes`; `test-customerci.js` (126) + full regression
before handing anything over. Current chain is in
`HANDOVER-CI-18aug.md`.
