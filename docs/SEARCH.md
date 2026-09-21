# Velnes Search — the plan

One search bar. The customer types what they want; Velnes works out
whether that is a salon, a treatment or an intent, and answers
accordingly. Nobody should have to know how our database is arranged in
order to find a massage.

Decided 2026-09-20, **built 2026-09-21** — all eleven steps. This
document is the brief, and the build order in §12 carries what each step
actually settled, including the one place the implementation
deliberately left a question open for Alex.

---

## 1. What this extends, and what it must not become

Phases A–C shipped a discovery pipeline: one gatherer, hard admission
(listed · ACTIVE location · bookable), the Phase B ranker, diversity,
consent. Search is **a second entry point into that pipeline**, never a
second engine. Category cards and typed queries differ only in how
candidates are chosen; everything after that is shared code.

What search itself adds: normalization, entity recognition, synonyms,
candidate retrieval, text relevance, and autocomplete.

---

## 2. Reconciliation with the original Search Engine

`reference/prototype/` has a complete V1 search engine from 22 August —
docs, a companion architecture proposal, an implementation and 38
checks. It was missed during Phase B, and §5 re-decided several things
it had already settled. That is recorded plainly in
`docs/SEARCH-RANKING.md`; this document does not pretend otherwise.

**The most important finding, because it inverts an obvious assumption:
`intent` in the prototype is not text relevance.** It computes
`(area match) × (time proximity to the asked time)`. Q1 of the companion
proposal is explicit — free text is resolved into taxonomy *ids* by
`searchNormalize` before the engine runs, and *"ranking never parses
strings."* Porting an "intent weight" believing it to be text matching
would have been a straightforward mistake.

Their design needs no text relevance because their result unit is the
**salon**: once a query resolves to a category, every candidate matches
the text equally well. Phase A made results **services** at Alex's
explicit instruction, and that changes the arithmetic — if "deep tissue"
resolves only to the Massage category, every massage is textually equal
and Deep Tissue Massage may not surface first. **Service-level text
relevance is therefore a genuine extension**, required by a later
decision, not a contradiction of the older design.

| From the original engine | Verdict |
| --- | --- |
| `searchNormalize`; synonyms in the platform DB, per language | **Adopt** — precisely what we lack |
| Synonyms centrally managed, never parsed in the frontend | **Adopt as principle** |
| Widen once, and say so honestly | **Adopt**, in two forms (§8) |
| Exploration floored for top results | **Adopt** as a diversify improvement |
| `intent` as a weight | **Do not port** — it means something else |
| Salon as the result unit | **Superseded** by Phase A |
| Exposure, hard availability, quality/ratings, rotation, area/region, dual consent modes | **Remain deferred** |

---

## 3. Decisions

Settled by Alex, 2026-09-20, with what was rejected.

| # | Question | Decision |
| --- | --- | --- |
| 1 | Professionals searchable in v1 | **No.** No destination (the salon page has no `?employee=` link), not bookable alone, and a searchable index of staff names is a larger privacy step than a page you must visit |
| 2 | The static "Most chosen" label | **Make it real** from completed bookings — §10. Rejected: removing it |
| 3 | Search analytics | **Zero/low-result queries only**, normalized text, no identity, never touching ranking |
| 4 | Filters | **Full honest set** — radius, price band, category. Rejected: none, and radius-only |

Two of these chose more scope than recommended. That is recorded so the
size of the phase is nobody's surprise later.

---

## 4. The doors

```
POST /public/discovery/suggest   { q, lat?, lng? }
POST /public/discovery/search    { q, lat?, lng?, radiusKm?, priceBand?, categoryId? }
```

POST for both: the viewer's position travels in the body, never a URL
(§9). The existing category door remains and becomes a thin caller of
the same pipeline.

### The N+1 problem, and the projection

Services are tenant-scoped under RLS. Iterating every tenant per
keystroke is already unpleasant at thirteen salons and does not survive
growth. This is the same shape as the original proposal's Q3, which
answered it with a projection — so:

**`search_documents`** — one platform-level, publicly readable row per
searchable entity: `kind`, `tenant_id`, `ref_id`, `display`, `norm`,
`lang`. Maintained by triggers on `services` and `businesses`, so no
code path can forget to update it.

It is a **matching index and never the authority on admission**. A
submitted search re-checks every candidate through the existing
`admittedBusinesses()` predicate. Autocomplete may briefly suggest
something unpublished a moment ago; that resolves itself on the next
click and is better than a stale second notion of who is admitted.

**Known cost:** `admittedBusinesses()` is O(N tenants). Fine for a
category page, too slow per keystroke. It needs memoising behind a short
TTL, and that is a work item rather than an afterthought.

---

## 5. Autocomplete

```
{ salons:    [{ id, slug, name, city }],
  services:  [{ id, name, salonName, salonSlug, categoryId }],
  categories:[{ id, name }],
  q, normalized }
```

Headings are informational. They are not controls, not filters, and not
a mode the customer selects — there is one input and it stays one input.

Debounce 200ms · minimum two characters · stale responses discarded by
sequence number · keyboard navigation (↑ ↓ Enter Escape) ·
`role="listbox"` with `aria-activedescendant` · loading and empty states
· and navigation by **replace**, so that typing never fills the back
button with keystrokes.

Selecting a salon opens that salon. Selecting a service or a category
opens results for it.

---

## 6. Entity recognition, and the direct-navigation rule

Recognition runs cheapest-first: exact normalized salon name → exact
category term including synonyms → exact service name → prefix → trigram
similarity above threshold. The highest-confidence class wins; ties
resolve toward category intent, because the results page is
service-first.

**Enter navigates straight to a salon only when all three hold:**

1. `normalize(query)` **equals** `normalize(salon.name)` — full
   equality, not a prefix, not a fuzzy match;
2. exactly **one** admitted salon matches;
3. the query is not also an exact category or service term.

Trigram and prefix matches never redirect. A typo must not be able to
send somebody to the wrong salon.

The current data already contains the case this protects: two salons
carry the byte-identical name *"Barber Shop Labi - Pristina, Banesat e
Arabve Kulla 3 - Prishtina | Fresha"*. Typing it in full matches two
salons and rule 2 refuses; typing "Barber Shop Labi" is a prefix and
rule 1 refuses. Both land on results, which is correct.

**Clicking a salon in autocomplete always navigates**, however loose the
match was. Choosing a row from a list is unambiguous intent; typing and
pressing Enter is not, and only the latter needs the strict rule.

---

## 7. Synonyms, language, and i18n

Synonyms live in the database, per language, as the original design
insists — never in React components.

**`service_category_terms(category_id, lang, term, kind)`**, where
`kind` is `name` or `synonym`. The `name` rows are the category's
display translation; every row feeds matching. **Translating the
taxonomy and teaching search a new word become the same act**, done once
by HQ.

That is also the answer on i18n. A synonym is *user input data*, not a
UI string, so it does not belong in `packages/i18n`. Category display
names do — and this table serves both, so the two cannot drift apart.

Cyrillic needs explicit rows: `unaccent` folds `Lumière → Lumiere` but
leaves `масажа` untouched, and no transliteration is attempted.
`SEARCH_CATS[].syn` in the prototype already carries MK/EN/Cyrillic
seeds and is where the first rows come from.

---

## 8. Fuzziness, relevance, widening

**Fuzzy** matching is `pg_trgm` similarity over the normalized column,
threshold ≈ 0.4, for *retrieval only*. No `fuzzystrmatch`: soundex and
metaphone are English-only and meaningless for Macedonian. **No
full-text search** — Postgres offers only `simple` and `english`
configurations here, and an English stemmer applied to Macedonian is
worse than no stemmer at all.

**Text relevance** becomes a `textRelevance` component in
`search_config`, present only for text queries. Category-card entry
omits it and the existing renormalisation rule does the rest — the same
mechanism already built for components a viewer cannot supply. One
ranker, two entry points, versioned, and visible in the Search Lab.
Proposed shape: exact service name 1.0 · all query tokens present 0.85 ·
category matched through a synonym 0.6 · trigram 0.3–0.6 scaled.

**Widening** happens in two honest forms, each reported to the customer:
*semantic*, when a service query has too few hits and widens to its
category; and *geographic*, only when a radius was actually set, since
distance is otherwise a ranking signal and never a hard filter.

---

## 9. Location, personalisation, URLs

Location keeps the Phase B contract: rounded to ~110m in the browser,
carried in the body, never stored, never in a URL.

Personalisation is unchanged and inherits the existing consent switch.
Search creates no second consent mechanism.

`/search?q=massage&radius=5&price=2` is stable and shareable — the query
and the filters, never the position. Autocomplete replaces; submission
pushes exactly one history entry. Category cards keep `/s/:slug`, and
both routes render the same results component with different inputs.

---

## 10. Filters, and "Most chosen"

**Filters are server-side hard admission**, never a client-side re-sort:
the order is the product.

| Filter | Basis |
| --- | --- |
| Radius | The ranked door already accepts `radiusKm`; today nothing sends it |
| Price band | Terciles computed across the admitted candidates for *this* query, so a band means something within its category rather than across the platform |
| Category | Narrows a text query that spans several |

Removed rather than faked: **Now** (needs real availability, deferred)
and any rating filter (needs reviews, which do not exist). Leaving an
inert control is the same failure as a fake popularity label.

**"Most chosen"** becomes real, per decision 2: the categories with the
most **completed** appointments across the platform in the last 90 days.
Aggregate counts only — no personal data, no new tracking, and nothing
that a salon could read about another salon. Appointments are
tenant-scoped, so this is computed by iterating admitted tenants behind
a memoised read-through cache with a TTL, the same pattern
`admittedBusinesses()` needs; at scale it becomes a projection. **The
label appears only above a minimum volume** — on thin data it is absent
rather than misleading.

---

## 11. Search Lab

**Built.** `SearchPreviewRequestSchema` takes a category **or** a `q`,
and the lab shows normalization → interpretation → candidates →
admission → per-component scores → final order. It reuses
`previewRanking`, which for a text query calls `textCandidates()` — the
same function the consumer door calls, so the lab explains the search
people actually get rather than a second one built to be explainable.
Consumer responses continue to carry no explanations.

The miss log from §10 lives on the same screen, and a failed query can
be clicked straight into the query box: the two halves of the same
question, which is *why did this not work*.

---

## 12. Build order

Each step is shippable and testable alone.

1. ~~`pg_trgm` + `unaccent` extensions, `search_documents`, triggers,
   backfill.~~ — **done 2026-09-21.**
2. ~~`service_category_terms`, seeded from the prototype's synonyms.~~ —
   **done 2026-09-21.**
3. ~~`searchNormalize` and entity recognition — pure functions, no HTTP,
   unit-tested hardest.~~ — **done 2026-09-21.** Normalization lives in
   SQL (`search_norm`) so there is only ever one of it; `interpret()` is
   the rule set, and is pure.
4. ~~`POST /suggest`, plus the `admittedBusinesses()` memoisation.~~ —
   **done 2026-09-21.**
5. ~~Autocomplete UI.~~ — **done 2026-09-21.**
6. ~~`textRelevance` in `search_config` and in the ranker.~~ — **done
   2026-09-21.** Config v2; the component is inferred live, so a
   category card still renormalises without it.
7. ~~`POST /search`, the direct-navigation rule, `/search?q=` route.~~ —
   **done 2026-09-21.** One door, reusing Phase A–C admission, ranker
   and consent whole; the only thing text adds to the ordering is
   `textRelevance`. Typing a salon's whole name navigates there and
   replaces the history entry, so Back returns to where the search was
   typed. A prefix or a near-miss never navigates — those salons are
   offered as choices instead, which is what stops a real salon name
   answering with an empty page. Every broadening the door reports
   (`widened: category | radius`) gets a sentence on the page, and the
   "Velnes thinks along with you" banner is hidden when nothing was
   ranked rather than claiming work that did not happen.
8. ~~Filters: radius, price band, category — doors, URL, UI; remove the
   inert chips.~~ — **done 2026-09-21.** One pure module
   (`modules/search/filters.ts`) both doors share, so "under 1.000 MKD"
   cannot mean two things depending on how somebody arrived. Bands are
   terciles of *this* answer, computed before any filter is applied so
   choosing one does not move the boundaries underneath the person
   choosing; absent entirely when fewer than six treatments carry a
   price, or when they carry too few different ones. Filters live in the
   URL (`price`, `cat`, `km`) so a narrowed answer is what gets shared
   and Back undoes one choice at a time; the position stays out of it,
   per §9. The **Now** chip and the inert **Filters** chip are gone
   rather than decorative — a dead control is the same failure as a fake
   availability badge. Two honesty lines were added: what a dropped
   radius did, and how many treatments a price band hid for publishing
   no price at all.

   **Left deliberately inconsistent, for a product decision:** the two
   doors treat a radius differently. Text search widens once and says so
   (§8); a category card keeps Phase B's contract, where a radius is
   hard and results outside it are simply absent. Phase B is closed, so
   its rule was not changed as a side effect of adding filters. Whether
   they should converge is Alex's call — `applyFilters` takes the
   behaviour as a parameter, so it is one argument either way.
9. ~~"Most chosen" from completed bookings, with its volume floor.~~ —
   **done 2026-09-21.** `GET /public/discovery/most-chosen`, memoised
   for ten minutes because it iterates every admitted tenant to build a
   ninety-day aggregate. "Completed" is not a status the lifecycle has,
   so it is inferred exactly as `viewerHistory` already infers it —
   booked or confirmed, kind `appointment`, finished before now — rather
   than invented a second time. Cancellations and no-shows are not
   choices anybody made and do not count.

   The door publishes **an order and never the counts**: a key-free
   surface carrying volumes would let one salon read another's trade
   straight out of it. Two floors — 40 completed visits platform-wide
   and 5 per category — and below them the answer is an empty list, so
   the panel renders nothing at all. That silence is the feature: the
   label was decoration before, and a label that cannot decline to
   appear is decoration still.

   It surfaces where the prototype put it: the panel that opens on an
   empty search box, tagged "Most chosen". The counting is tested
   against an independent implementation in SQL, so agreement means the
   window, the statuses, the ordering and both floors are right for a
   reason rather than by coincidence.
10. ~~Zero/low-result query logging.~~ — **done 2026-09-21.**
    `search_misses`, one row per normalized query per day carrying a
    counter. The privacy property is the *shape*, not a promise: there
    is no column for a client, a session or an address, and no timestamp
    finer than a day, so the table cannot answer "who searched this"
    because the data to answer it was never recorded.

    Written only through `log_search_miss()`, a SECURITY DEFINER
    function — the consumer search door is key-free, and an INSERT
    policy there would hand a pen to the internet. The function
    normalizes the text itself (`search_norm`, the same one the index
    uses, so a miss is replayable against what missed it) and refuses
    anything outside the search box's own bounds. Logging can never fail
    a search: every error is swallowed and the results go out.

    Recorded at zero results and at two or fewer, but **not** when the
    customer narrowed the query themselves — an empty answer to "under
    700 MKD within 2 km" is a filter doing its job, not a gap in what
    the platform sells. `how` is stored alongside, because "we did not
    understand it" is a synonym to add and "we understood it and have
    nothing" is a salon to recruit.

    Read at `GET /hq/search-misses`, HQ-only and enforced by RLS proved
    against `velnes_api` rather than the admin role. **It never touches
    ranking**, and nothing in the ranking code has heard of it.
11. ~~Search Lab extension, and docs.~~ — **done 2026-09-21.**
    `SearchPreviewRequestSchema` takes a category **or** a query, never
    both and never neither, and the lab gained a query box beside the
    category picker.

    The important part is what it runs: the consumer door's own
    candidate builder, extracted to `textCandidates()` and called by
    both. A lab with its own retrieval would be explaining a search
    nobody performs, which is the failure this phase was told to avoid.

    It reports the half of the story the lab could not previously tell —
    normalization, how the text was read, every way it met the platform
    with scores, which categories that resolved to, and how many
    treatments were gathered against how many survived admission. That
    last gap is usually the answer to "why is this not showing". The
    step 10 miss log is surfaced in the same screen, and clicking a
    failed query drops it into the box.

    Consumer responses still carry no explanations: weights and
    component scores stay inside HQ, and a test asserts the public
    response contains neither.

Steps 1–3 are invisible to customers. Steps 4–5 are useful before any
ranking changes.

---

## 13. Tests

Normalization, synonyms, Cyrillic and diacritics · the direct-navigation
rule, including the identical-Labi pair · fuzzy retrieves but never
redirects · **one pipeline** — the same category reached by card and by
text yields the same admitted set · `textRelevance` absent on category
entry and correctly renormalised · both widenings reported honestly ·
consent off removes personal signals from search too · suggestions never
include an unadmitted salon · stale responses discarded in order ·
filters admit rather than re-sort · "Most chosen" silent below its floor
· `EXPLAIN` proves the trigram index is used.

The identical-Labi pair is covered as a unit test of `interpret()`
rather than through the door, and deliberately: neither of those two
imported salons has a live widget, so Phase B's bookable admission keeps
them out of consumer discovery entirely and the door never sees the
pair. The rule they exist to prove is still the one under test — it is
just tested where it lives.

---

## 13a. The results page, after the fact

Three things Alex asked for on 2026-09-21, once the phase was built and
he had used it:

**The results-page search bar is a real one.** It was `readOnly` — a
label showing what had been asked. It now carries the same suggestions,
the same keyboard handling and the same Enter behaviour as the home
page, because they are literally the same code: `useSearchBox()`, which
both pages call. Asking a second question no longer means going home
first. On a phone it opens the full-screen sheet the home page opens,
since typing into a strip under a sticky header is not the same feature.

**The map zooms to the wheel**, wherever the map is interactive. A
static thumbnail still does not, because a thumbnail that resized under
the page scroll would be a trap.

**A pin opens a card before it opens a salon.** One tap to look, one to
go: the salon's photograph if it has one, where it is, whether it can be
booked, the cheapest treatment there, and a button. The link is a real
`href` so it can be middle-clicked, with a plain click intercepted to
stay inside the app.

**Tapping "Search" opens a search screen, not a search.** It briefly
opened whichever category sorted first, so a phone ran a query for
"Assessment" that nobody typed — a different answer every time the
taxonomy changed. `/search` with no query is now a real landing: the
field, and every category on offer ordered by what the platform actually
books most (the same aggregate behind "Most chosen", which is the only
ordering here that is not arbitrary). The map is absent, because a
screen with no answer has nothing to put on one.

**There is no rating on that card, and this is deliberate.** Alex asked
for one; reviews do not exist on this platform (§14 below, and
`docs/CONSUMER-APP.md`), so the only way to show a rating today is to
invent it. Stars nobody earned are exactly what the honest-emptiness
rule exists to prevent, and the slot is waiting for the reviews
subsystem rather than being filled with a number. Everything else on the
card is real.

---

## 14. Deliberately not in this phase

Professionals as a searchable entity · impressions and exposure decay ·
real next-free-slot availability and any "available today" claim ·
reviews and quality scoring · ten-minute result rotation · the old
area/region geography, superseded by lat/lng · the old dual consent
modes · salon-unit results.
