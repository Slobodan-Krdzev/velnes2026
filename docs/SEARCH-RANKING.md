# §5 — Search & ranking

The answers that unblock Phase B of consumer discovery. Phase A shipped
the listing: a category card opens onto every treatment published in
that category, in a fixed, impersonal order (bookable first, then
cheapest, then alphabetically). This document says what replaces that
order, and — as importantly — what does not.

Written as a proposal with defaults already chosen, so it can be argued
with rather than filled in. The handful of choices that genuinely change
the shape of the thing are collected at the end under **Open decisions**;
everything else is a recommendation you can simply accept.

Scope: ordering service results inside one category, which is the door
Phase A built. Free-text search is a later question and reuses the same
scoring; nothing here is category-specific.

---

## 1. The three parties

A marketplace ranking is never only about relevance. Three parties have
a claim on the order, and naming them stops the weights from drifting
into whatever felt right that week.

- **The customer** wants the treatment they would have chosen anyway,
  near them, at a time they can take.
- **The salon** wants a fair chance to be seen. A ranking that always
  shows the same four salons is one that quietly decides who gets a
  business.
- **The platform** wants results it can defend: no pay-to-win, no
  ordering it cannot explain to a salon that asks why it is eighth.

Everything below is a compromise between those three. Where they
conflict, the resolution is stated rather than averaged away.

---

## 2. Shape of the answer

Ranking runs in three stages. Keeping them separate is what makes the
result explainable: a salon that is absent was **excluded** and can be
told why; a salon that is low was **scored** and can be shown the
components; a salon that was pushed down a page was **diversified** and
that is a platform rule, not a judgement about them.

```
admission  →  score  →  diversify
(hard)        (0..1)     (re-order)
```

### Stage 1 — Admission

Hard filters. A result that fails any of these is absent, never merely
demoted. Nothing here is a matter of degree.

| Rule | Status |
| --- | --- |
| Business is marketplace-listed | live (Phase A) |
| Service is `active` and `online` | live (Phase A) |
| Location lifecycle is `ACTIVE` | **to build** — the spec's "location admission happens only on lifecycle ACTIVE (idempotent, audited)" |
| Within the radius, when the viewer set one | **to build** |
| Above the quality floor | **inert** — no reviews exist, so nothing is below any floor yet |

The quality floor is declared and does nothing. That is deliberate: the
shape is in place so that turning reviews on later is a data change, not
a ranking rewrite. It must not be faked with a proxy like "has photos".

### Stage 2 — Score

Six components, each normalised to `0..1`, combined as a weighted sum.
Weights live in the Search-lab config (§6), not in code.

| # | Component | What it measures | v1 |
| --- | --- | --- | --- |
| 1 | `proximity` | how far the salon is from the viewer | **yes** |
| 2 | `affinity` | the viewer's own history with this treatment/salon | **yes** |
| 3 | `availability` | how soon you could actually get in | **reduced** |
| 4 | `value` | price position within the category | **yes** |
| 5 | `quality` | reliability and rating | **inert** |
| 6 | `exposure` | how much this result has been shown lately | **deferred** |

**Default weights**

```
proximity    0.30
affinity     0.25
availability 0.20
value        0.10
quality      0.10
exposure    -0.05     (subtracted)
```

When a component is unavailable for a given viewer — no location, no
history, signed out — it is **dropped and the remaining weights are
renormalised**, never substituted with a neutral 0.5. Substituting a
midpoint silently moves every result toward the middle and makes the
other components weaker for no stated reason; renormalising keeps the
components that do apply at full strength.

#### 2.1 `proximity`

```
proximity = exp(-distance_km / D)      D = 5 km (config)
```

Exponential rather than linear: the difference between 1 km and 3 km
matters to somebody choosing where to go on a Tuesday; the difference
between 40 km and 60 km does not. At D = 5 km a salon 5 km away scores
0.37, one 10 km away 0.14.

Distance is to the salon's pin — the one its owner dropped, which is
already required at registration and editable in Settings › Locations.
No coordinates are ever guessed from address text; a salon without a pin
has no proximity component (and so is ranked by the others).

#### 2.2 `affinity` — the personal part

This is what Alex asked for: "which service he booked the most, his
favourites, similar services". It is computed from the viewer's **own**
history, read across every salon through `withClient` (which already
does exactly this for the appointments list).

Sub-signals, each `0..1`, combined with **max, not sum**:

```
affinity = max(
  1.00 * booked_this_exact_service,
  0.90 * favourited_this_service_or_salon,
  0.70 * booked_at_this_salon,
  0.45 * booked_something_similar,
  0.35 * booked_in_this_category
) * recency
```

Max rather than sum, because the signals are nested — booking a service
implies booking at the salon implies booking in the category — and
summing them would let one loyal relationship swamp proximity entirely.

**Recency decay.** A haircut booked three years ago is not a preference.

```
recency = 0.5 ^ (days_since_last / 180)
```

A booking counts fully today, half at six months, a quarter at a year.
Applied to the most recent qualifying booking, not to each.

**"Similar services" — what we can honestly mean.** There is no tag
table, no attributes, no embeddings. Two services are similar in v1 if
they share an HQ category **and** their durations are within ±50% of one
another. That is a weak notion and is marked as such; anything better
needs a data decision (service tags on the HQ taxonomy), which is listed
under open decisions.

**Only completed appointments count.** A cancelled or no-show visit is
not a preference. Pending ones are not either, until they happen.

#### 2.3 `availability`

```
slot today        1.00
within 3 days     0.70
within 14 days    0.40
none / unknown    0.00
```

This is the expensive one. Computing a real first-free-slot means a
availability search per salon per request, which is the same work the
salon page does for one salon. **v1 reduces it** to what Phase A already
knows for free:

```
bookable (live widget)  1.00
not bookable            0.00
```

The full version needs a projection — a `next_free_slot` per
(location, category) refreshed on booking and on schedule changes —
which is its own piece of work. See open decisions.

#### 2.4 `value`

Not "cheapest wins". Cheapest-wins punishes exactly the salons a
wellness marketplace wants, and turns the whole category into a race.

```
value = clamp(0.5 + (median_price - price) / (2 * median_price), 0, 1)
```

Price relative to the median of that category. A service at the median
scores 0.5; at half the median, 0.75; at twice the median, 0.25. Capped
both ends, and weighted lightly (0.10) so it breaks ties rather than
deciding.

A salon that publishes no prices has no `value` component (renormalised
away), never a zero — hiding prices must not be a ranking penalty.

#### 2.5 `quality` — declared, inert

Reviews and ratings do not exist; no tables, and Phase A's docs already
record that every star from the prototype is omitted rather than
invented. `quality` is defined here so its slot exists:

```
quality = w_rating * rating_normalised
        + w_reliability * (1 - cancellation_rate)
        + w_completion * profile_completion
```

and contributes **nothing** until those inputs are real. It must not be
approximated. A "quality" score assembled from whether a salon uploaded
photos is not quality, and it would be the kind of invisible rule that
is impossible to defend to the salon it demotes.

#### 2.6 `exposure` — the fairness brake, deferred

The spec calls for exposure decay. The mechanism: a result shown many
times recently without being clicked gets a small negative nudge, so one
salon cannot own a category permanently.

```
exposure = min(impressions_7d / IMPRESSION_CAP, 1)      weight -0.05
```

It needs an impressions counter, which is a write on every result page —
a real cost and a real privacy surface (it is a log of what people
browsed). Deferred to v2, and listed as an open decision, because
"count what everyone looked at" deserves a deliberate yes rather than
arriving as a side effect of ranking.

Until it exists, **chain dedup below is the only fairness mechanism**,
and that is worth knowing.

### Stage 3 — Diversify

Applied to the scored list, in this order.

1. **Chain dedup by business.** At most **2** results from the same
   business in the first 10. Further ones are moved below that window
   rather than dropped — a salon with eight relevant treatments should
   not be hidden, but it should not be the whole page either. This is
   the spec's "chain dedup by business", and with exposure decay
   deferred it is doing that job alone.

2. **New-salon window.** A business within its `newUntil` window
   (proposed: **30 days** from its first ACTIVE location) is guaranteed
   one slot in the first page per category, if it was admitted at all.
   Without this, a new salon has no history, no reviews and no momentum,
   and ranks last forever — the cold-start trap that makes a marketplace
   impossible to join. Derived from `businesses.created_at`; no new
   column needed for v1.

3. **Stable tiebreak.** Equal scores order by `(name, id)`. Results must
   never shuffle between two identical requests — a page that reorders
   when you come back is one nobody trusts.

---

## 3. Consent — who gets personalised results

The part that is governance rather than engineering.

One fact shapes the whole answer: **personalisation here reveals nothing
to anybody.** It reorders a page using the viewer's own bookings, for
the viewer's own eyes, server-side. No salon learns why it ranked where
it did. No profile is shared, sold, or shown. This is not ad targeting
and should not inherit its ceremony.

The line this document draws, and proposes to keep permanently:

- **Only the viewer's own history.** Never "customers like you", never
  collaborative filtering across clients. The moment ranking uses other
  people's behaviour it becomes a profile of a person built from
  strangers, and the honesty argument above stops being true.
- **Signed-out visitors are never profiled.** No cookie-based history,
  no device fingerprint. A signed-out viewer gets proximity + value +
  availability, and that is a perfectly good page.
- **Location is not stored.** It is used to sort one response and is not
  written to any row. See §5.

**Proposed mode: on by default for signed-in clients, with one switch
off in My Velnes › General.** The client already sees their own booking
history in the app; using it to order their own results is not a new
disclosure to anyone. The switch exists because some people simply do
not want it, and its state is a field on `client_users`.

Alternatives, for the record: opt-in (personalisation then never happens
for the ~90% who never visit settings, and `affinity` is effectively
dead code); or non-optional (saves a column, and removes a choice that
costs us almost nothing to offer).

---

## 4. What Phase B actually builds

Honest split, so nothing is half-built and nothing is faked.

**In v1**

- `proximity`, with viewer location passed to the door (§5)
- `affinity` from completed appointments across salons, with recency
  decay — booked-this-service, booked-at-this-salon, booked-in-category
- `availability` reduced to the bookable flag Phase A already has
- `value` from category median price
- chain dedup (max 2 per business in the first 10)
- new-salon window from `businesses.created_at`
- the consent switch, and signed-out behaviour
- the Search-lab config document, read by the ranker (§6)
- `location lifecycle ACTIVE` admission

**Declared but inert in v1** — present in the config and the score,
contributing zero, each with a test asserting it contributes zero:

- `quality` — waits on reviews
- `exposure` — waits on an impressions decision

**Not in v1**

- favourites as an `affinity` signal. **Favourites do not exist**: the
  heart on a card is component state. A real one is a table, a door and
  a working heart — that is Phase C, and `affinity` reads it the day it
  lands.
- real first-free-slot availability. Needs the projection above.
- free-text search. Same scorer, different admission; later.
- service tags for a real similarity notion.

---

## 5. The location, and how it reaches the door

Phase A's door is `GET /public/discovery/categories/:id/services`.
Ranking needs the viewer's position, and a coordinate pair is personal
data, so:

- **Coordinates are rounded to 3 decimal places** (~110 m) in the
  browser before they are sent. That is far finer than ranking needs and
  coarse enough that the exact position never leaves the device.
- **They go in the request, not the URL.** A precise location in a query
  string ends up in access logs, proxy logs and referrers. Either the
  ranked door becomes a `POST` with a body, or the rounded pair travels
  as a header. Recommendation: `POST`, because the viewer context will
  grow (radius, filters, later free text) and a body is the honest place
  for it.
- **Nothing is written.** The position orders one response and is
  discarded. It is not stored on `client_users`, not logged with the
  request, not attached to an impression row.
- The signed-in client's own saved city, if we ever add one, is a
  separate and better default for people who decline the browser prompt.

Radius: proposed as a **soft signal by default** — "Near me" sorts, it
does not hide. It becomes a hard admission filter only when the viewer
explicitly picks a radius. A "near me" toggle that silently hides a
salon 6 km away is a bug report waiting to happen.

---

## 6. The Search lab — tuning without deploys

Every constant above is a knob: the six weights, `D`, the recency
half-life, the dedup cap, the new-salon window, the impression cap.
Hard-coding them means every tuning decision is a deploy, and no record
of who changed what.

Proposal, following the versioned-config pattern the platform already
uses elsewhere:

- One `search_config` document, versioned. Columns as the other
  versioned config: id, version, payload `jsonb`, `active`, author,
  `created_at`.
- Exactly one active version. Activating a version is audited through
  `audit_log`, like every other lifecycle transition.
- The ranker reads the active version and stamps its `version` onto the
  response as `rankVersion`, so a result set can always be explained
  after the fact: "that order came from config v7".
- HQ edits it in the HQ app. No tenant can see or touch it — ranking
  config is platform-level, and a salon being able to read the weights
  is a salon being able to game them.
- A dry-run mode: score a category under a draft version and diff the
  order against the active one, so a weight change can be *looked at*
  before it is live.

**Pay-to-win, explicitly ruled out.** Nothing in the config buys
position. Premium and offers may affect what a salon can *do*, never
where it appears in a ranked list. If that is ever to change it must be
a separate, deliberate, disclosed decision — and results that are paid
for must be labelled as such.

---

## 7. Testing a thing that has no obviously right answer

Ranking is where test suites usually give up. What is checkable:

- **Golden order.** A fixed fixture — salons, services, a viewer with a
  history, a position — produces one exact order, asserted in full. Any
  weight change breaks it loudly, which is the point.
- **Component isolation.** Each of the six scores tested alone: same
  everything, one signal varied, assert the direction of the move.
- **Inert means inert.** `quality` and `exposure` are asserted to
  contribute exactly zero, so an accidental wiring shows up as a failure
  rather than a mystery reorder.
- **Determinism.** The same request twice returns the same order. This
  test exists already, from Phase A, and must keep passing.
- **Renormalisation.** A viewer with no location and no history gets a
  sensible order, not everything bunched at 0.5.
- **Dedup and cold start.** A business with eight matching services
  takes at most two of the first ten; a salon created yesterday appears
  on the first page.
- **Consent.** With the switch off, the response is identical to the
  signed-out one for the same position.

---

## 8. Open decisions

Everything above is a recommendation. These four change the work
materially, and are yours.

1. **Consent mode.** On by default for signed-in clients with an off
   switch (recommended), opt-in only, or non-optional?
2. **Availability in v1.** Ship the reduced version (bookable flag), or
   build the `next_free_slot` projection now and have real "available
   today" ranking from the start? The projection is roughly its own
   phase.
3. **Impressions, and therefore exposure decay.** Counting what every
   viewer was shown is the only way to make exposure fairness real, and
   it is a browsing log. Build it, or leave chain dedup as the sole
   fairness brake for now?
4. **Service tags.** "Similar services" is weak without them — same
   category and a duration band is all v1 can honestly claim. Add tags
   to the HQ taxonomy, or accept the weak notion for now?

Two smaller ones, where accepting the default is fine: the weight set in
§2, and the 30-day new-salon window.

---

## 9. Honest deferrals

- **Reviews and ratings.** `quality` stays inert until they exist.
- **Favourites.** Not persisted anywhere; Phase C.
- **Real availability ranking.** Needs the slot projection.
- **Exposure decay.** Needs impressions.
- **Free-text search.** Same scorer, different admission stage.
- **Regions and areas.** `platform_salons` in the platform spec carries
  area/region and local momentum. Neither exists as a table; distance
  from a pin is doing that job for now, and does it well enough in a
  country the size of this one.
