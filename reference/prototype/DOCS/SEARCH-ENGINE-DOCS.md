# Velnes Search & Recommendation — Engine Docs · 22 aug 2026
**The handoff document for the Velnes client (consumer) frontend.**
Build: `index.html` post-search delivery; suite `test-search.js`,
38 checks, all green. Companion: the architecture proposal
(`velnes-search-architecture-proposal.md`) — the *why*; this file is
the *what and how*.

## What is implemented, and where it lives

The complete V1 engine as **pure platform doors** inside the prototype,
plus the seeded market it runs on, plus the **HQ Search lab**
(HQ › Search lab) — the diagnostic surface showing every ranked result
*with its full explanation*. There is deliberately **no consumer UI
here**: that is the client frontend's job, and this document is its
brief. Everything the consumer app must do is: build the query, call
one door, render the results, and emit the funnel events.

## Alex's four decisions (22 aug), as built

1. **Consent — both modes, decision deferred.** `searchConfig.
   consentMode: 'opt-out' | 'opt-in'`. `consentAllows(profile)` is the
   only gate: opt-out ⇒ personal signals unless `consent==='denied'`;
   opt-in ⇒ only when `'granted'`. Tested in both modes; flipping the
   mode never breaks results (personal weight collapses to 0, the rest
   carries). The legal confirmation later is a one-field change.
2. **Multi-location:** one row per business — best-scoring location
   represents it, siblings appear in `alsoAt[]` ("also in Aerodrom").
   A chain can never occupy several positions with itself.
3. **Nearby times internal:** the engine searches ±`nearbyWindowMin`
   (60) around the asked time; the card says `Closest available:
   15:30` (`result.closest`, `result.exact`). Never expose the window
   as a control in V1.
4. **Trend granularity:** `localTrendFor(area,cat)` uses area-level
   when evidence ≥ `minLocalEvents`, else region, else platform — and
   *records which* (`explain.parts.trendGranularity`). Localizes
   automatically as volume grows; no code change needed.

## The one door the frontend calls

```js
searchRun(
  { categoryId|text, area, date, timeMin },   // the query
  custId | null,                              // guest = null
  { seedBucket }                              // optional; omit in prod
) → { results:[…], widened:bool, q }
```

Result shape (per card):
```js
{ pos, salonId, name, area, alsoAt:[areaIds],
  priceLevel:1–3, rating, closest:'15:30', exact:bool,
  badges:[max 2 strings],
  explain:{ base, parts:{intent,avail,location,personal,quality,
            ltrend,trendGranularity}, extra, penalty, final,
            config:'v2026-08.1', seedBucket } }
```
Render: name/area/rating/price-level, `alsoAt` as "also in …", the
badges verbatim, and `exact ? asked time : 'Closest available: '+
closest`. **Never render `explain`** to consumers — it exists for the
lab, support, and the future training set. Never invent a match
percentage.

Companion doors: `searchClick(custId,salonId)` on card click (logs +
marks the exposure engaged — clicks forgive faster).
`searchNormalize` maps free text through `SEARCH_CATS[].syn`
(MK/EN/Cyrillic seeds included) — extend synonyms in data, never parse
in the frontend.

## The pipeline (eight doors, all pure, all logged)

`searchNormalize → candidatesFor → availabilityBatch → relevanceScore
→ localTrendFor → exposurePenalty → (diversify inside searchRun) →
explanation/badges`.

**Stage A (hard constraints — personalization never rescues):**
verified salon, offers the category, area match (widens *once* to the
region when < `widenBelow` matches, returned as `widened:true` — say
"nearby areas included"), and **real availability** from the batch
summary. A favorite salon with no slots is simply absent (tested).

**Stage B scoring:** weighted components per `searchConfig.weights`
(intent 30 · avail 22 · location 14 · personal 14 · quality 12 ·
ltrend 5 · vtrend 3 — illustrative V1 values, HQ-tunable). Cold start
is a *confidence multiplier* on the personal term (bookings/10 capped
at 1), not a branch — guests and thin profiles degrade smoothly.
Quality is category-specific (`catQuality`) with salon-wide fallback.

**Diversification:** positions 1–3 strictly by base relevance
(exploration floored to zero — Best Match stays honest); 4+ ranked by
`base + exploration + rotation + newSalon − overexposure`, all
seed-driven and budget-capped. Exploration eligibility: base ≥
`thresholdRatio` (70%) of the #3 result AND no reliability flag —
the §24 rule: diversify among good answers, never manufacture bad
ones (the "Weak Corner" seed proves the floor).

**New salons:** boost from HQ activation (the registration gate is the
trigger), window `newSalonDays`/`newSalonBookings`, competes inside
the exploration budget, never buys #1 (tested).

**Exposure:** per (customer, salon), exponential decay with 7-day
half-life, penalty capped at `penaltyCapPct` (can demote in the list,
never out of it), entries age out at 30 days, engaged impressions
count 0.3×. Forgiveness is structural: decay + cap + click-reset.

**Determinism/pagination:** seed = hash(customer + normalized query +
10-minute time bucket). Same bucket ⇒ byte-identical order (page 2
continues page 1); across buckets the tail rotates while the top 3
stay on base. Tests pin `seedBucket`; production omits it.

## The event funnel (the frontend's other duty)

`searchRun` logs `search` + one `impression` per result (with
position and badges) automatically. The frontend must call
`searchClick` on card click and, in production, emit the rest of the
funnel per the proposal §Q12: salon view → service pick → slot pick →
booking started/abandoned/completed. Every explanation carries the
`config` version and `seedBucket`, so any ranking is replayable — this
log **is** the future training set.

## HQ ownership

`searchConfig` is the versioned tuning document (weights, budgets,
threshold, windows, half-life, caps, consent mode) — the HQ Search lab
displays it and the rule beneath it: *tuned here in production, never
per salon.* No per-salon override exists anywhere, including for HQ.

## Prototype boundaries (honest, one place)

- `platformSalons` + `availSummaryFor` are the seeded stand-ins for
  the cross-tenant salon table and the real availability
  summary cache. In production: the batch endpoint
  (`POST /availability/batch`) + the per-(location, duration-class,
  date) summary cache from the proposal — the *contract* is what the
  frontend codes against, and it's identical.
- `localTrendFor`'s evidence proxy (salon-count × 12) becomes real
  event counts once the funnel has volume.
- Time bucketing uses `Date.now()` in production and injected
  `seedBucket` in tests/lab.
- The Velnes profile (`velnesProfiles`) is seeded for one customer;
  production derives it from platform bookings only — salon-private CI
  never crosses (the Q4 line, restated in the proposal).

## Test map (`test-search.js`, 38)

World seeding & personalities · stage-A hard constraints · intent
dominance (no availability ⇒ absent) · quality floor blocks weak
exploration · seed determinism + page stability + cross-bucket
rotation · top-3 purity · chain dedup · new-salon never-#1 · ≤2
badges, honest closest-time, no percentages · consent both modes +
guest · exposure cap, 28-day decay, click-forgiveness · trend
widening with recorded granularity · widen-once honesty · full funnel
with positions · config version on every explanation · the lab
rendering base→final per card.

## For the client-frontend sprint, in order

1. Code against `searchRun`'s shapes above (they are the API draft).
2. Homepage modules (proposal §16) reuse the same doors with
   recommendation-weighted config — no second engine.
3. Emit the full funnel from day one; the engine's fairness is only as
   evidence-based as the events it gets.
4. Do not re-sort, filter, or dedupe results client-side — the order
   *is* the product (§18).
