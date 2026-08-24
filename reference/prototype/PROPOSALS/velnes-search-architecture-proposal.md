# Velnes Search & Recommendation — Architecture Proposal · 22 aug 2026

**Status: for Alex's review. This is a design document — no code.**
Written per brief §22 ("do NOT immediately implement"). Grounded in the
Salon Workspace prototype `1d9c58c6…` (20,824 lines); the consumer
frontend prototype is being built separately and was not available for
inspection — everywhere that matters, this is flagged.

---

## 0. What the inspection of the existing world found (§22 first half)

**Taxonomy.** The catalog is one level deep: `services` carry a `cat`
string (Manual therapy, Rehab, Recovery, Assessment); variants live
inside a service (`svcChoice` is the only resolution door); combos are
service bundles. There are no subcategories and no synonym layer —
those must be born in the platform taxonomy, not retrofitted per salon.

**Availability.** `availableSlots(loc, sid, emp, date)` is the door —
per-location, per-service, per-date, computed from the schedule chain
(`scheduleFor`, exceptions, split shifts). It is single-salon by
construction: correct for booking, unusable as-is for search across
hundreds of salons. This is the #1 backend-contract consequence (Q3).

**Customer identity/history.** Salon-side CI is rich (`custStats`,
seeded history, preferences, retention evidence) and *tenant-private
by design*. The booking flow already matches/creates customers by
phone/e-mail — a natural join key, and a dangerous one (see §7,
privacy). There is **no Velnes-level customer profile today.** The
Premium feature established the pattern for platform-owned layers
(`VELNES_HQ`, `VELNES_PLATFORM_MEMBERS`, projection discipline) — the
profile service is its sibling.

**Quality/ops data.** Per salon: ratings (reviews flow), completion
and no-show status on appointments, repeat behavior (CI), price
levels, and now merchant/registration verification state (`verified`,
`sellerReady`, HQ activation). All reusable as *aggregates*; none
exportable as raw tenant rows.

**Events.** `activityLog`/`auditLog` exist per tenant; there is no
impression/search event pipeline anywhere. It must be created (§9) —
and the brief is right that it is a first-class deliverable, not
instrumentation sprinkles.

---

## 1. The pipeline (brief §19, named in codebase style)

One request flows through eight doors, each pure, each logging its
contribution:

```
searchNormalize → candidatesFor → availabilityFor(batch)
  → relevanceScore → trendBoost → exposureAdjust
  → diversifyRank → explainResults
```

`SalonSearchScore = f(customer, salon-location, service, date/time,
place, marketplace signals)` — computed fresh per query, never stored
as "the salon's score" (§3: no permanent score exists anywhere).

---

## 2. Answers to §23, one by one

**Q1 — Query model.** A combination, resolved in this order: the UI
offers *typed selection* (platform taxonomy: category → service, with
synonyms — "massage" maps to the category, "sports massage" to a
service); free text is normalized *into* taxonomy ids by the
`searchNormalize` door (synonym table in the platform DB, per language
— MK/SQ/EN from day one, this is Macedonia). The engine itself only
ever sees ids: `{serviceId | categoryId, geo, date, timeWindow}`.
Free-text-to-taxonomy is a front-door concern; ranking never parses
strings.

**Q2 — Geographic pool.** Geo resolution: named area (city/municipality
from the registration pin+address — the wizard already captures
lat/lng) or radius around a point. Candidate cap: **200 locations**
hard ceiling into stage B (Postgres + PostGIS `ST_DWithin` on the
locations table; at hundreds of salons the country fits in one index
scan). If the area yields more than the cap, tighten radius before
scoring — never score an unbounded pool. Edge (§21): if the pool is
tiny (< 5), widen radius once, labeled honestly ("nearby areas
included").

**Q3 — Availability without N+1.** The core backend decision, flagged
since the roadmap discussion. Three-layer answer:
(a) **Batch contract from v1**: `POST /availability/batch` accepting
`[{locId, serviceId, date, window}]` — the API resolves internally in
one query pass, never per-salon HTTP calls. The prototype's
`availableSlots` becomes the per-row kernel inside it.
(b) **Availability summary cache**: per (location, service-duration
class, date) precompute "has slots: morning/afternoon/evening + first
slot + slot count", refreshed on booking writes and every few minutes.
Stage A eligibility reads *only this summary* (cheap, cacheable ~60s).
(c) Exact slots are fetched **only for the page being rendered**
(top ~10), from the real resolver — summary for filtering, truth for
display. Rapid-change edge (§21): the result card's times are labeled
as of render; the booking flow re-verifies (it already does — the
widget re-asks `priceFor` and slot validity at confirm).

**Q4 — Global vs salon-private signals.** The line, explicitly:
*Global (Velnes profile, consent-gated):* bookings made **through the
platform** (which salon, which category, when, price band, completion,
weekday/time bands, areas), searches/clicks/impressions on the
consumer app, favorites. These are marketplace transactions Velnes is
party to.
*Salon-private (never crosses):* CI stats, notes, retention tags,
personal offers, in-salon till history for walk-ins, any record the
salon created about the person. The salon-side CI answers "what does
this salon know"; the profile answers "what has this person done on
Velnes." A platform rule (written, in HQ) states this; the phone/e-mail
match used by the booking flow may link *platform bookings* into one
profile but must never pull salon-created records across tenants. This
is the brief's §20 made concrete — and it needs one product decision
from you: whether profile personalization is opt-out or opt-in at
consumer signup (recommendation: on by default with a visible toggle,
stated at signup; GDPR-style basis documented).

**Q5 — Exploration threshold.** A salon may be exploration-promoted
only if (a) it passed *all* stage-A hard constraints (the §24 rule:
already a valid answer), and (b) its BaseRelevance ≥ **70% of the #3
result's** BaseRelevance for this query. Relative, not absolute — in a
weak field the bar adapts; in a strong field exploration can't smuggle
in a materially worse option. Plus quality floor: no active
reliability flag (chronic no-show/cancellation rate) — floors prevent
promotion, they don't erase eligibility.

**Q6/Q7 — Exposure decay and forgiveness.** Per (customer, salon) and
per (query-context, salon): impressions counted with **exponential
decay, ~7-day half-life**. OverexposurePenalty = capped function of
decayed impressions *without engagement* — shown-and-clicked resets
faster than shown-and-ignored. Forgiveness is structural: decay means
any penalty halves weekly on its own; additionally the penalty is
bounded (never more than the exploration budget itself, so it can
demote within the list but never push a top match out of eligibility),
and a booking anywhere in the salon clears that customer-salon pair.
No permanent memory: raw impressions age out of the counter entirely
after ~30 days.

**Q8 — New-salon boost.** Starts at **HQ activation** (the
registration gate we just built is the trigger — verified salons
only), lasts **60 days or first 25 platform bookings, whichever comes
first**, magnitude within the exploration budget (it competes for
exploration slots, never for Best Match), and only fires when the
salon passes Q5's threshold. Decays linearly over the window so there's
no cliff.

**Q9 — Multi-location businesses.** The result entity is the
**location** (the brief's own definition), but the list deduplicates by
business within one page: the best-scoring location represents the
business; siblings appear as "also in Aerodrom" on the card rather
than as separate rows, unless the query's geography genuinely
separates them (searching Skopje-Centar shouldn't show the Bitola
branch at all — stage A handles that). Prevents one chain occupying
three of the top five slots with itself.

**Q10 — Stable pagination, rotating searches.** Seed-based
determinism: each *search execution* gets a seed
(`hash(customerId + queryNorm + timeBucket)`, time bucket ~10 min).
Diversification and exploration draw from that seed → page 2 continues
page 1 exactly (same seed), no duplicates, no reshuffle mid-scroll;
a fresh comparable search minutes later gets a new bucket → rotation
between searches, stability within one. This one mechanism answers
both halves of the question and makes ranking **replayable in tests**
(the determinism discipline this codebase already lives by).

**Q11 — HQ-tunable settings.** A `searchConfig` document in HQ,
versioned like the Premium rules (`v2026-08.1`, audit-logged edits):
signal-group weights (intent / personal / location / availability /
quality / local trend / platform trend), exploration + rotation budget
percentages, Q5 threshold ratio, new-salon window and cap, exposure
half-life, penalty cap, candidate-pool cap, nearby-time window
minutes, badge thresholds. Explicitly *not* in HQ: any per-salon
score override — §18's "salons cannot edit their organic ranking"
applies to HQ favoritism too; the config tunes the game, never a
player.

**Q12 — Logging.** Two streams, both first-class tables:
(a) **Score explanations**: per query, per rendered result — every
pipeline stage's contribution `{intent, personal, location,
availability, quality, trends, exploration, rotation, penalty}`, the
config version, the seed. Answers "why did this rank #4" a year later
and *is* the future training set — the transparent-weights V1 (§17)
generates its own labeled data.
(b) **The event funnel** (§9 verbatim): search → impression(position,
badges) → click → salon view → service pick → slot pick → booking
started/abandoned/completed. The prototype's `activityLog` shape
scales to this; in production it's an append-only events table
(partitioned by month) feeding the trend services and the exposure
counters.

---

## 3. The scoring formula (V1, all weights from `searchConfig`)

```
BaseRelevance =
    w_intent    · IntentMatch        (exact service > category >
                                      synonym; exact time > ±30 > ±60)
  + w_avail     · AvailabilityQuality (exact slot, first-slot distance
                                      to asked time, viable-slot count,
                                      preferred-employee available)
  + w_location  · LocationFit        (distance decay + customer's
                                      known booking areas)
  + w_personal  · PersonalFit        (visited-before, category
                                      affinity, time-band affinity,
                                      price-band fit — profile-gated)
  + w_quality   · QualityForQuery    (service-specific repeat/
                                      completion/rating where data
                                      exists, salon-wide as fallback,
                                      shrunk toward the mean on thin
                                      data — the supStats/evidence-gate
                                      lesson)
  + w_ltrend    · LocalTrend + w_vtrend · VelnesTrend  (boosters only)

FinalRank = BaseRelevance + Exploration + Rotation + NewSalon
            − OverexposurePenalty          (last four: seed-driven,
                                            budget-capped per §7)
```

Cold-start customer (§11): `w_personal` degrades to zero smoothly with
profile thinness (a confidence multiplier, not an if/else), its weight
redistributing to intent/availability/quality — one formula covers
guest, new, and rich-history customers. Slotting (§8): positions 1–3
strictly by FinalRank with exploration terms floored at zero (Best
Match stays honest); the exploration/rotation terms shape 4+.

**Badges** (§14) are generated from the same explanation record —
thresholded, max two per card, priority-ordered (You've been here >
Available at your time > Recommended for you > Popular near you > New
on Velnes) — never a percentage, never the raw score.

---

## 4. What can start now vs what waits for the consumer prototype

**Now (platform side, independent of the consumer UI):**
- The batch availability contract + summary cache design → into the
  monorepo contracts package (this decision cannot wait; retrofitting
  batch onto a per-salon API is the unfixable latency floor).
- The Velnes customer-profile privacy rule → written into HQ next to
  the Premium rules; the Q4 line documented before any data flows.
- The event-funnel table shapes → contracts, so the consumer app
  emits correctly from its first build.
- `searchConfig` document shape + HQ screen (small; the Premium rules
  card is the template).

**With the consumer prototype (where the engine itself lives):**
- The eight-door pipeline against seeded multi-salon data (the
  supplier-CI generator pattern scales to "generate 40 salons around
  Gevgelija/Skopje with personalities" — dense, thin, new, excellent-
  at-one-thing).
- Deterministic tests per §22: fixed seed → byte-stable ranking;
  weight-change tests (raise w_avail, watch the exact-slot salon
  climb); diversification tests (same query, different time buckets →
  measurable rotation; same seed → identical pages); fairness tests
  (eligible-salon impression share, exposure concentration — §25's
  metrics as assertions).

**Explicitly later (V2+):** learned weights from the funnel data,
free-text embeddings, sponsored placement (if ever — separated and
labeled per §18).

---

## 5. Open decisions for Alex

1. Consumer profile consent: default-on with visible toggle, or
   opt-in? (Recommendation above; legal check advised — MK + EU
   customers.)
2. Result entity confirmation: location-with-business-dedup per Q9, or
   strict per-location rows?
3. Should "nearby time window" (±30/±60) be a customer-facing control
   or an engine internal? (Recommendation: internal in V1, shown
   honestly on the card — "closest: 15:30".)
4. Trend granularity for a small market: municipality-level local
   trends will be thin outside Skopje for a while — start with
   region-level and shrink as density grows?

With your answers, the next concrete artifact is the contracts-package
draft (batch availability + events + searchConfig) — the pieces that
must exist before either prototype can meet the other.
