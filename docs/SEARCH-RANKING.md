# §5 — Search & ranking

The answers that unblock Phase B of consumer discovery. Phase A shipped
the listing: a category card opens onto every treatment published in
that category, in a fixed, impersonal order (bookable first, then
cheapest, then alphabetically). This document says what replaces that
order, and — as importantly — what does not.

**Decided 2026-09-20.** Written first as a proposal with defaults
already chosen; the four choices that changed the shape of the thing
were settled by Alex on the same day and are recorded in §8 with the
reasoning, so a later reader can tell what was chosen from what was
merely inherited. Phase B builds what §4 lists.

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
| Location lifecycle is `ACTIVE` | live (Phase B) |
| **Bookable — a live widget answers** | live (Phase B) |
| Within the radius, when the viewer set one | live (Phase B step 5) |
| Above the quality floor | **inert** — no reviews exist, so nothing is below any floor yet |

The quality floor is declared and does nothing. That is deliberate: the
shape is in place so that turning reviews on later is a data change, not
a ranking rewrite. It must not be faked with a proxy like "has photos".

**Bookability is an admission rule, not a weight, and that is the
point.** This surface exists to be booked from. A weight can always be
out-argued by another weight — at `proximity` 0.30 against
`availability` 0.20 a nearby salon taking no online bookings really did
out-score a bookable one further away, and the ranker's own test still
records that, kept precisely to show what the rule is protecting
against. So the candidate never reaches the ranker. `availability`
survives as a weight for the day it means "how soon", rather than
"at all".

**The ACTIVE rule was enforced by fixing the data, not by bending the
rule.** Four imported demo salons were trading while parked on APPROVED,
because nobody had walked them through the last lifecycle step. A
migration moved them to ACTIVE the way `locTransition` would — online
true, an opened date, and a `location_lifecycle_log` row recording
APPROVED → ACTIVE with its reason — rather than the rule being relaxed
to accommodate them.

Worth recording, because an earlier note in this document guessed
otherwise: enabling the rule changed **no results at all**. Those four
salons were already absent from service discovery for two reasons that
predate it — none of their services is `active` and `online`, and none
has a live widget. The estimate that the rule would "remove 4 of 10
salons" was about the listed set, not about anything a person would have
seen, and the caution it produced was greater than the case deserved.
The repair was still right: the data was wrong, and is now correct.

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

**Default weights** — as seeded in `search_config` v1.

```
proximity    0.30
affinity     0.25
availability 0.20
value        0.10
quality      0.00     (0.10 once reviews exist)
exposure     0.00     (0.05 once impressions exist)
```

All weights are non-negative magnitudes; `exposure` is **subtracted**
rather than added, because it is the fairness brake and not a merit. The
sign lives in the ranker, not in the number — a config document where
one field silently means the opposite of its neighbours is a trap.

The set does not sum to 1 and does not need to: components a viewer
cannot supply are dropped and the rest renormalised, so only the ratios
matter. The two inert components are seeded at **zero** rather than at
their intended weight, so that "inert" is a fact about the data and not
a promise about the code.

There are two different kinds of "missing", and they are handled
differently. The distinction was sharpened while building the ranker,
because treating them the same is a real bug either way round.

**A component the _viewer_ cannot supply** — no location, no history,
signed out — is **dropped and the remaining weights renormalised**, never
substituted with a midpoint. Substituting one silently moves every result
toward the middle and weakens the components that do apply, for no stated
reason. This is a per-request decision, so every candidate is still
scored on the same denominator and the scores stay comparable.

**A component a _candidate_ has no input for** — a salon that publishes
no prices, or has no pin — keeps its weight and scores the **neutral
midpoint**. Scoring it zero would make hiding a price a ranking penalty,
which §2.4 explicitly rules out, and the same reasoning covers a missing
pin: absence of an input is not evidence against a salon. Renormalising
per candidate instead would be worse still — it changes the denominator
per row, so a salon missing two components could out-score a complete one
by having less to be judged on.

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
another. **Decided:** keep the weak notion for now rather than add
service tags to the taxonomy. It is cheap and honest, and the scorer
does not change when tags arrive — only this predicate does. It stays
marked as weak so nobody later mistakes it for real similarity.

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

A consequence worth stating outright, because it surprised the golden
test: at `proximity` 0.30 against `availability` 0.20, a salon on your
street that takes no online bookings **outranks** an equivalent one 70km
away that does. That follows from the weights and is not a bug. If
"bookable first, always" is what we want, it belongs in Stage 1 as an
admission rule, not as a heavier weight — a weight can always be
out-argued by another weight, which is exactly what a hard rule is for.
Left as a weight for now; a test pins the behaviour so the choice is
visible rather than incidental.

The full version needs a projection — a `next_free_slot` per
(location, category) refreshed on booking and on schedule changes —
which is roughly its own phase. **Decided:** ship the reduced version,
so Phase B is not held behind it. The consequence is stated plainly and
must stay stated: until the projection exists the app may not claim
"available today" on the strength of this component, because it only
knows the salon takes online bookings at all.

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
browsed). **Decided: deferred.** "Count what everyone looked at" should
be a deliberate yes, not something that arrives as a side effect of
ranking, and nothing yet demands it.

Until it exists, **chain dedup and the new-salon window are the only
fairness mechanisms**, which is worth knowing and worth watching: if one
salon visibly owns a category, this is the decision to revisit first.

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

**Decided: on by default for signed-in clients, with one switch off in
My Velnes › General.** The client already sees their own booking history
in the app; using it to order their own results is not a new disclosure
to anyone. The switch exists because some people simply do not want it,
and its state is a field on `client_users`.

Rejected, and why: opt-in, because personalisation would then never
happen for the great majority who never open settings, leaving
`affinity` as effectively dead code and Phase B's main feature dormant;
non-optional, because the switch costs almost nothing and removing the
choice buys only a column.

The default is only defensible while the two rules above hold — own
history only, and no profiling of signed-out visitors. If either is ever
relaxed, this default has to be reopened at the same time.

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
- Exactly one active version, enforced by a partial unique index, so
  "the config in force" cannot quietly become two rows.
- **The table is its own audit trail**, rather than writing to
  `audit_log`. Rows are written once and then only activated or
  deactivated, and each carries who wrote it, who switched it on and
  when. `audit_log` is tenant-scoped (`tenant_id NOT NULL`) and ranking
  config belongs to no business, so recording it there would mean
  inventing a tenant for a platform-level act. The author is kept as an
  id *and* a name, with no foreign key: an audit trail that loses its
  author the day that account is deleted is a worse audit trail.
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

## 8. Decisions

Settled by Alex, 2026-09-20. Recorded with what was rejected, because a
decision without its alternative is indistinguishable from an accident.

| # | Question | Decision | Consequence |
| --- | --- | --- | --- |
| 1 | Consent mode | **On by default**, switch to opt out | `client_users` gains one boolean; My Velnes › General gains one row |
| 2 | Availability in v1 | **Reduced** — the bookable flag | Phase B ships now; the app may not say "available today" on this component alone |
| 3 | Impressions / exposure decay | **Deferred** | No browsing log. Chain dedup + new-salon window are the only fairness brakes |
| 4 | Service tags | **Not now** — keep the weak notion | Similarity is "same category, duration ±50%" and stays labelled weak |

The default weight set in §2 and the 30-day new-salon window were
accepted as proposed. They are config, so they are the cheapest things
here to change later.

**What would reopen these.** Each decision is reversible and none is
load-bearing for the others:

- One salon visibly owning a category reopens #3.
- The app wanting to say "available today" honestly reopens #2.
- Reviews arriving makes `quality` live and may shift the weights.
- Relaxing "own history only" or "never profile signed-out visitors"
  reopens #1 on the spot.

---

## 9. Phase B build order

Each step is shippable on its own and leaves the app working. Definition
of done per the engineering guide: contract, migration, service,
endpoint, UI, tests, seed, docs note.

1. ~~**`search_config`**~~ — **done 2026-09-20.** Migration, versioned
   rows, one active (partial unique index), HQ-only RLS proven against
   the restricted `velnes_api` role, and the defaults from §2 seeded as
   v1. `packages/contracts/src/search.ts` carries the payload contract
   and `DEFAULT_SEARCH_CONFIG`; `activeSearchConfig()` reads and
   *validates* the active version, raising rather than ranking on a
   payload that has drifted. Seven tests, including that the two inert
   components really are zero.

   One thing this turned up: `search_config` must not carry a foreign
   key to `hq_users`, because the demo seed's
   `TRUNCATE ... hq_users CASCADE` reaches through it and a seeded world
   then comes up with no config in force at all. The columns keep the
   id and the name, and no FK.
2. ~~**The ranker**~~ — **done 2026-09-20.**
   `(candidates, viewer, config, now) → ordered`, in
   `services/api/src/modules/search/rank.ts`. No database, no Fastify,
   and no clock it does not own — `now` is injected, so recency and the
   new-salon window are tested against a fixed date rather than the day
   the suite happens to run. Nineteen tests: the golden order, each
   component alone, affinity's decay and its max-not-sum rule, the inert
   pair proven inert by turning their weights to 1 and watching nothing
   move, renormalisation, chain dedup, and the cold-start promotion.
3. ~~**Consent**~~ — **done 2026-09-20.** `client_users
   .personalised_results`, default true; a switch in My Velnes › General
   that saves on the spot and invalidates the results cache, since the
   order it governs is on screen. Tested: on by default, the client can
   turn it off, it survives a re-read, and an unrelated profile edit
   does not quietly turn it back on — a consent setting that resets
   itself is not consent.
4. ~~**The door**~~ — **done 2026-09-20.** `POST
   .../categories/:id/services` takes the viewer context and answers
   with `rankVersion` and `personalised` alongside the rows; the `GET`
   stays as the unpersonalised form. Both doors share one gatherer, so
   they can never disagree about who is in the running — only about the
   order. Authentication is optional and a token that cannot be read is
   treated exactly like no token: being signed out is not an error on a
   key-free door. Steps 5 and 6 came with it — radius admission, and
   affinity read across salons through `withClient`.
5. ~~**Admission**~~ — **done 2026-09-20.** Location lifecycle `ACTIVE`,
   bookability, and radius when the viewer sets one. The first two are
   hard rules in one predicate shared by the shelf and both doors.
6. ~~**Affinity**~~ — **done 2026-09-20.** Read across every salon
   through `withClient`, using the same completed-visit predicate the
   Customer Insights engine already uses, with recency decay applied
   once to the most recent qualifying booking rather than compounded.
7. ~~**Diversify**~~ — **done 2026-09-20.** Chain dedup, the new-salon
   window and the stable tiebreak run inside the ranker, so both the
   unit tests and a door test hold them: no business takes more than two
   of the first ten, and nothing is dropped to achieve it.
8. ~~**The UI**~~ — **done 2026-09-20.** The results page sends a
   rounded position, shows `rankVersion` in development only, and says
   in one line what actually ordered the page — your bookings and where
   you are, or distance and price, or price and bookability. The old
   "carefully selected for you" was replaced: it was the kind of line
   that means nothing and sounds like it means something.
9. ~~**HQ Search lab**~~ — **done 2026-09-20.** Four doors under
   `/hq/search-config`: read the whole history, write a new version
   (optionally live), activate any version, and dry-run a draft against
   one real category. The HQ app's "search" tab, until now a coming-soon
   placeholder, is the lab: sliders for the six weights, the two decay
   constants, a dry run that shows every result's was/now/move and
   score, and the version history with a Make live button.

   Reading is open to every HQ role, including the read-only auditor —
   an auditor who cannot see the ranking rules cannot audit them.
   Writing is `hq_super` and `hq_tech` only: it decides what every
   consumer sees, and it is neither an onboarding nor a support
   decision. The dry run ranks the same candidates the real door ranks,
   because a preview of a different shape would be a comfortable lie,
   and it deliberately ranks without personalisation — a diff has to be
   reproducible, and "how it looks to one person's history" is not.

Steps 1–2 were built and tested with no user-visible change at all,
which made them the safe place to start. **All nine are done.**

What is still absent, and honestly so: favourites as an affinity signal
(Phase C), real first-free-slot availability, reviews behind `quality`,
impressions behind `exposure`, and free-text search. Each is listed in
§9 with what it waits on.

## 10. Honest deferrals

- **Reviews and ratings.** `quality` stays inert until they exist.
- **Favourites.** Not persisted anywhere; Phase C.
- **Real availability ranking.** Needs the slot projection.
- **Exposure decay.** Needs impressions.
- **Free-text search.** Same scorer, different admission stage.
- **Regions and areas.** `platform_salons` in the platform spec carries
  area/region and local momentum. Neither exists as a table; distance
  from a pin is doing that job for now, and does it well enough in a
  country the size of this one.
