# Velnes Search — the plan

One search bar. The customer types what they want; Velnes works out
whether that is a salon, a treatment or an intent, and answers
accordingly. Nobody should have to know how our database is arranged in
order to find a massage.

Decided 2026-09-20. **Steps 1–8 built 2026-09-21**; steps 9–11 remain.
This document is the brief, and the build order in §12 carries what is
done and what each step actually settled.

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

`SearchPreviewRequestSchema` gains an optional `q`, and the lab gains a
query box showing normalization → interpretation → candidates →
admission → per-component scores → final order. It reuses
`previewRanking`. Consumer responses continue to carry no explanations.

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
9. "Most chosen" from completed bookings, with its volume floor.
10. Zero/low-result query logging.
11. Search Lab extension, and docs.

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

## 14. Deliberately not in this phase

Professionals as a searchable entity · impressions and exposure decay ·
real next-free-slot availability and any "available today" claim ·
reviews and quality scoring · ten-minute result rotation · the old
area/region geography, superseded by lat/lng · the old dual consent
modes · salon-unit results.
