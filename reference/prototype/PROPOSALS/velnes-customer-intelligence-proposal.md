# Customer Intelligence — architecture & product proposal
**Velnes Business prototype · proposal for approval · 18 aug 2026**
**Nothing in this document is built yet. Approval gates implementation.**

---

## 0. Principles carried over from the brief and from platform conventions

1. **One door per question.** Every derived number comes from a single helper
   family (`custStats`), the way availability has `scheduleFor()` and pricing
   has `priceFor()`. No screen computes a metric itself.
2. **Prototype computes what production will aggregate.** In the prototype,
   `custStats()` derives everything from `appointments[]` at call time. In
   production the same shape is returned by `GET /customers/:id/insights`;
   only the inside of the helper changes, no screen changes. The pagination
   boundary (history separate from insights) is drawn now so the API split
   is a swap, not a redesign.
3. **The stored `visits`/`spend` fields become read-fallbacks.** Where seeded
   history exists, derived numbers win; where it doesn't, the stored totals
   still show. Production drops the fallback.
4. **Permissions are the existing ones.** `customers.view_business` already
   gates Spend/Points in the list; the same permission gates every money
   figure on the detail page. No new permission keys.

---

## 1. Data seeding (prototype only)

A generated history block `custHistory[]` appended to the demo data —
**not** hand-typed rows, but a small seeded generator run once at startup so
the data stays plausible and dense:

- **Marija (c4, VIP, 96 visits)** — the showcase. ~3 years of history:
  strong Friday-afternoon pattern, 80% with one employee, a premium
  treatment that stops appearing ~6 months ago (feeds the win-back
  suggestion), slightly rising frequency.
- **Katerina (c1, 38 visits)** — regular ~5-week rhythm, currently
  2 weeks overdue (feeds the reminder suggestion).
- **Ivana (c2, 21 visits)** — moderate history, no strong pattern
  (proves trends stay silent when confidence is low).
- **c3, c5, c6** — thin or empty on purpose; every section must have an
  honest empty state ("Not enough history yet").

Generated appointments carry the real appointment shape (`sid`, `emp`,
`price`, `status:'completed'`, `date`, `start`) and live in a separate
array so the calendar and the booking gate never see them — they are
history, not schedule. `custStats` reads `appointments ∪ custHistory`.

Deterministic seed (fixed PRNG) so tests can assert exact numbers.

---

## 2. The helper family — `custStats(custId)`

One function, one return object, memoised per render pass:

```
custStats(cid) → {
  totals:   { visits, spend, avgSpend, firstDate, lastDate },
  services: [ { sid, name, count, pctOfCompleted, spend } ],  // sorted by count
  times:    [ { hour, count } ],                              // 24 buckets
  weekdays: [ { wd, count } ],
  employees:[ { empId, name, count, pct } ],
  cadence:  { medianGapDays, sampleSize, trend },  // trend: 'up'|'down'|'flat'|null
  overdueDays,        // null if no rhythm established
  lapsedServices,     // previously regular, absent last 6 months
  favoriteService,    // top of services[], null under MIN_VISITS
}
```

Rules mirror the timing engine's discipline:
- **Completed only.** `status:'completed'` counts; cancellations and
  no-shows are excluded from every metric (they remain visible in the
  history list, greyed).
- **Median, not mean, for cadence** — same reasoning as `effTreatment()`:
  robust against one long holiday gap.
- **Confidence thresholds** in one constant `CI` (analogous to `TIMING`):
  `MIN_VISITS:5` before a favorite/cadence is claimed, `MIN_EMP_PCT:.60`
  before an employee preference is claimed, `LAPSE_WINDOW:180` days,
  `OVERDUE_FACTOR:1.4` (overdue = gap > 1.4 × median).

`custHistoryPage(cid, page)` is deliberately a **separate** helper returning
`{rows, hasMore}` in pages of 15 — this is the production pagination
boundary. Load More appends a page; nothing ever loads the full history
into the DOM at once.

---

## 3. Screen structure

### 3.1 List screen — what changes
- **Sort control** next to the Filters pill (not inside it — the 13 aug
  single-dimension filter decision stands). Same popover idiom:
  `Sort ⌄` → Most visits · Fewest visits · Highest spend · Lowest spend ·
  Name (default). Spend sorts hidden without `customers.view_business`.
- **View button** per row, before Edit. Edit and its drawer are untouched.

### 3.2 New screen `customer` (full page)
- Route `go('customer', cid)`; `state.param` carries the id — the same
  mechanism other parameterised views use. Hash becomes `#customer/c4`,
  so a customer page is linkable.
- **Back to Customers** returns via `go('customers')`; filters, sort and
  scroll survive because they live in `state` and are never cleared.
- Registered in `NAV_PERM` under the same keys as the list
  (`customers.view_*`); router bounce via `denied()` as everywhere else.
- **Added to `test-screens`' enumeration immediately** — the documented
  pitfall (phantom flightdeck) exists precisely because a new screen was
  not on that list.

### 3.3 Page layout — single page, GX sections, no tabs (V1)
Header outside the accordion:
- Summary card: avatar, name, phone, email, group badge, membership,
  Can book status, "Customer since", "Last visit".
- KPI row (5 cards, flightdeck visual language): Visits · Total spend ·
  Avg per visit · Last visit · Favorite service. Money cards render as
  "—" without `customers.view_business`.
- **Analyse with AI** button, top right (see §6).

Sections (each with a GX pill stating its own status):
1. **Trends** — insight sentences (§4)
2. **Suggestions** — actionable cards (§5)
3. **Most booked services** — horizontal bar chart
4. **Preferred times** — hour-of-day bars + weekday strip
5. **Spending by service** — bars, highest→lowest, permission-gated
6. **Appointment history** — paged rows + Load More

**Every chart section expands and collapses individually** — this is
exactly `edOpen{}` + `data-edsec` from the section editor; the state
object and handler already exist, only the surface is new. `Expand all`
in the section header row, as on the editors.

Charts are hand-rolled HTML/SVG in house tokens (flightdeck precedent).
No library. Each bar row: label · bar · count · pct.

---

## 4. Trends — deterministic rules (V1)

Insights are sentences generated from `custStats`, each with its rule and
threshold; a rule that lacks confidence says nothing. Set:

| Rule | Fires when | Sentence pattern |
|---|---|---|
| Cadence | `medianGapDays` ≥ MIN_VISITS samples | "Usually returns every N weeks." |
| Weekday | one weekday ≥ 45% of visits | "Usually books on Fridays." |
| Daypart | one 3-hour band ≥ 50% | "Prefers appointments between 14:00 and 17:00." |
| Employee | top employee ≥ 60% | "82% of appointments are with Maria." |
| Lapsed service | regular before, absent LAPSE_WINDOW | "Hasn't booked a facial in 6 months, previously every N weeks." |
| Frequency trend | last-6-months median vs. prior median, ≥ 20% shift | "Visit frequency has increased over the last 6 months." |

Every sentence carries a small "why" affordance (the `data-fdwhy` collapse
pattern from the flightdeck hero) showing the numbers behind it.

---

## 5. Suggestions — actionable, honest, each with a reason

Rendered as cards: sentence · "Why this suggestion" collapse · action
button where a real action exists. V1 set:

1. **Overdue reminder** — cadence established and `overdueDays>0`.
   Action: none in V1 (no messaging channel exists — the brief's own
   rule: don't act on infrastructure we don't have). Text only.
2. **Personalised offer** — weekday+daypart pattern established.
   Action: **"Create offer for Marija"** → opens `PANELS.offerNew`
   preconfigured: audience `SPECIFIC_CUSTOMERS`, `customerIds:[cid]`,
   slots pre-filtered by `openCapacity()` to the customer's preferred
   window. `phaseApplies()` already resolves `SPECIFIC_CUSTOMERS`
   (line ~12065); `AUDIENCE_V1` gains it, drawer gets a read-only
   audience row when opened this way. **This is the flightdeck-hero
   pattern pointed at one person — the first place Customer
   Intelligence meets the yield engine.**
3. **Win-back** — `lapsedServices` non-empty. Action: also the offer
   drawer, `eligibleVariantIds` pre-set to the lapsed service.
4. **High-value thank-you** — last-3-months spend ≥ 2× their own prior
   average. Text only in V1.
5. **Birthday** — requires a new optional `birthday` field on the
   customer (added to the Edit drawer, General section). Rule fires
   within 14 days. Without the field, the rule is silent — never guessed.

Architecture note: suggestions are produced by `custSuggestions(cid)`
reading only `custStats` output — the exact JSON a future AI
recommendation endpoint would receive. Rules and future AI share one
input contract.

---

## 6. Analyse with AI

Button in the header. On click:
- Chart sections collapse (one state flag `state.ciMode='ai'`),
- an **analysis panel** renders in their place: a flowing narrative
  about the customer, plus "Back to charts".

**V1 is honestly labelled.** The prototype has no model behind it, so the
narrative is composed deterministically from the same `custStats` +
`custSuggestions` data — full sentences, owner-facing tone, covering
profile, rhythm, preferences, money, risks, opportunities. The panel
carries the demo-honesty convention used on the flightdeck ("written
text" vs. live numbers): a quiet line "Generated from booking history".

**Production path is designed now:** `aiAnalysis(cid)` takes the stats
JSON and returns text. In production it POSTs that JSON to an LLM
endpoint; the prototype implementation is the deterministic composer.
Same input contract as §5 — one payload feeds rules, narrative, and
future AI.

---

## 7. Tests — `test-customerci.js`

- Sort popover: four orders + permission-hidden spend sorts.
- Routing: View → screen, Back preserves filter/sort state, hash
  `#customer/c4` deep-links, Elena (restricted role) bounces per
  `NAV_PERM`, money KPIs hidden without `customers.view_business`.
- `custStats` numbers against the fixed seed: exact visit counts,
  median gap, employee pct, lapsed detection, overdue math.
- Threshold behaviour: Ivana produces *no* cadence/employee claims;
  c6 renders every empty state.
- Suggestions: overdue fires for Katerina, offer button opens the
  drawer with `SPECIFIC_CUSTOMERS` + correct `customerIds`, birthday
  silent without the field, fires with it.
- Expand/collapse per section + Expand all.
- AI mode: charts hidden, narrative present, Back restores.
- History paging: 15 rows, Load More appends, never renders all.
- `test-screens` list extended in the same patch that adds the screen.

Estimate ~90 checks. Existing suites expected untouched except
`test-screens` (list) — the Edit drawer and list rendering don't change
shape.

---

## 8. Explicitly out of V1 (documented, shaped for later)

- Tabs (Overview/Appointments/Analytics) — single page first; the section
  structure converts to tabs without rework if volume demands it.
- Real messaging for the reminder suggestion.
- Real AI call behind Analyse (§6 contract is the seam).
- Heatmap for times — bars first; heatmap is a rendering swap.
- List-level sort by derived metrics in production will be a backend
  `?sort=` param; prototype sorts in memory.
- `GET /customers/:id/insights` + paged history endpoint — spec'd in the
  dev handover, mirrors `custStats`/`custHistoryPage` one-to-one.

---

## 9. Order of work (after approval)

1. Seeded history + `custStats`/`custHistoryPage` + `CI` constants — with
   tests, before any UI.
2. Sort control + View action + route + screen shell + header/KPIs.
3. Chart sections + expand/collapse.
4. Trends + Suggestions incl. offer-drawer preconfiguration + birthday
   field on the Edit drawer.
5. Analyse with AI mode.
6. Full suite run, md5/wc-l discipline throughout, handover update.

Each step is a separate patch with the md5 noted before and after,
per the 18 aug working agreement.
