# Proposal — Supplier Intelligence in Revelapps HQ · 21 aug 2026

**Status: awaiting Alex's approval. No code has been changed.**
Base build: `b8da088708287be3d05b64bf700652c9` (20,190 lines).
Pattern source: the Customer Intelligence sprint (seeded deterministic
history → one stats door → screens that only read).

## Why

HQ can see *that* a supplier exists and whether its payment config is
complete — but not how the relationship is going. Today's transactional
depth: 4 purchase orders, 11 supplier products, and Portal dashboard
numbers that are hardcoded strings. The question "is BeautyPro growing,
stalling, or quietly losing salons?" has no answer in the system.
Customers had the same gap until the CI sprint; this proposal gives
suppliers the identical treatment, sized the same.

## A. Seeded deterministic history (the foundation)

A generator in the CI mold — seeded PRNG keyed per supplier, so every
boot and every test run sees the same world, and nothing about the four
hand-written POs changes:

- **~10–14 months of purchase orders** per *connected* supplier
  (sup1 dense across both locations; sup2 thinner, one location —
  their personalities differ so the analytics have contrast). Realistic
  cadence (weekly-ish for sup1), line items drawn from that supplier's
  real `supplierProducts`, statuses weighted (mostly delivered, some
  shipped, occasional disputed with `dmg`), values derived from real
  `price × qty`.
- Rows go into the existing `purchaseOrders` array with a `seeded:true`
  flag; `poSeq` respected; existing screens (orders lists, deliveries)
  automatically show the richer history — same free lift CI gave the
  appointment views.
- **Sell-through**: the multi-merchant layer already attributes till
  revenue to supplier entities (the arnica-oil transactions). The stats
  door reads `merchantTransactions` for platform-attributed retail —
  data customers' CI never had. Thin today, real, and it grows with
  every demo sale.

## B. One door: `supStats(supId)` (+ `supTrends`, `supFlags`)

Computed, cached like `custStats`, screens never compute:

- **Volume**: GMV via platform (last 30/90 days, 12-month series),
  order count, average order value, open-vs-delivered split.
- **Reliability**: on-time rate (expected vs delivered), dispute rate,
  damaged-line rate — the `dmg`/`recv` fields finally earn their keep.
- **Reach**: active salons (ordered in last 90 days), repeat-order
  rate, share of orders per location.
- **Mix**: top products by value, brand split, training seats filled
  (from `trainings`).
- **Flags** (evidence-gated, CI's retention-tag discipline): *Growing*
  / *Cooling* (trend of order value), *Dispute pattern*, *Config
  incomplete* (reuses `sellerReady`). No flag without the rows to
  prove it.

## C. The screen: HQ › Suppliers → supplier detail page

Mirrors `hqBusiness` (the salon-account detail), opened from a new
**"Open supplier"** row action; the Review drawer stays for editing —
viewing and editing stay different doors:

- **Header**: name, type, territory + the merchant identity block we
  just built (MID · entity · status) — answering Alex's "left side
  panel" instinct at page level too.
- **Stat row**: GMV 90d, active salons, on-time rate, open orders.
- **Order value trend** — 12-month bar, CI's chart language.
- **Orders table** — the supplier's POs (seeded + real), status-badged,
  linking to the existing order screens.
- **Product performance** — top lines by value with share bars.
- **Reliability card** — on-time / disputes / damage, with the flag
  chips.
- **Config health** — the sellerReady story; Aroma's page shows what
  incomplete looks like end to end.
- **Trainings** — seats filled per course.

Navigation state `hqSup` beside `hqBiz`, address-registered
(`#hq/suppliers` deep-linkable per the gotab lesson: the page gets its
own hash segment from day one).

**Portal honesty bonus (small, in scope):** the Portal dashboard's
hardcoded stats ("484.200 ден", best-seller counts) start reading from
the same door — the supplier sees the same truth HQ sees, scoped to
itself. That's brief §5's one-source-of-truth, now for analytics.

## D. Explicitly out of scope

No supplier-side benchmarking against other suppliers (comparative data
across tenants is a policy decision, not a screen); no merchant
*transaction* browsing UI (payment milestone); no editing anywhere new.

## E. Tests — `test-supplierci.js` (~45 checks)

Determinism (two boots → identical stats, byte-equal seeded rows);
generator hygiene (hand-written POs untouched, `poSeq` monotone, line
prices match catalog); door correctness on hand-checkable slices
(on-time rate from known rows, dispute rate counts po4); flags
evidence-gated (sup2 never "Growing" on thin data; Aroma flagged
config-incomplete); screen reads door (spot-check one rendered number
=== door output); Portal dashboard numbers === door output for sup1;
deep link lands; Review drawer unchanged. Regression: merchant (51),
screens, rolekits, headers, plus the orders/deliveries suites if any
encode PO counts — inspected before build, updates listed if needed.

## Sizing

Customer-Intelligence-class: generator + door + one full page + portal
rewire + suite. The largest single sprint since Velnes Premium; if
preferred I can split delivery into (1) generator + door + tests, then
(2) the page + portal rewire, with a green build after each.

## Definition of done

Deterministic history seeded; `supStats` door live; HQ supplier detail
page rendering from the door; Portal dashboard honest; flags
evidence-gated; all suites green; chain + `SUPPLIER-CI-DOCS.md` +
addendum.
