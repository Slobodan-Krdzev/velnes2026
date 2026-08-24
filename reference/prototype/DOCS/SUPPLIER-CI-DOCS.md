# Supplier Intelligence — domain docs · 21 aug 2026

**Build:** `2515424bb93c292e34ff82cae80074e5` (20,433). Suite:
`test-supplierci.js`, 41 checks. Pattern: the Customer Intelligence
treatment applied to suppliers — seeded deterministic history → one
door → screens that only read.

## Seeded history (fixed LCG, seed 1712 — in production this block
does not exist)

Two layers, deliberately separated:
1. **Salon layer** — real `purchaseOrders` rows (`seeded:true`, ids
   `pog…`, refs below the existing numbering, `poSeq` untouched) for
   this salon. Order/delivery screens show them automatically.
   Delivered rows carry `deliveredOn` + full `recv`; disputed rows
   carry `dmg` (a dispute without damage is not a dispute — tested).
   Line prices sit on the hand-written MKD pack scale: known prices
   from po1–po4 are the anchor (sp1=550 etc.), the rest derives from
   `buy` at the same ratio; zero-buy items (samples, sp10) are
   excluded from ordering.
2. **Platform layer** — `platformOrders`: monthly volume per connected
   account (`salonAccounts`), stats-only, so salon screens never show
   another tenant's orders. In production this is the same PO table
   cross-tenant.
Personalities differ by design: sup1 dense/growing over 14 months,
sup2 thin over 6 — so trend flags measure something real.

## The door: `supStats(supId)`

Volume (gmv30/90, 14-month `series` oldest-first, orders, aov, open),
reliability (onTimeRate from `deliveredOn` vs `expected` + platform
onTime; disputeRate; dmgRate from `dmg`/`recv`), reach (activeAccts
90d, repeatRate), mix (topProducts by value, training seats), and
**sellThrough** — paid `merchantTransactions` attributed to the
supplier's legal entity: till retail counts, live (sell p2 and
BeautyPro's number moves — tested). Rates return `null`, never fake
zeros, when the rows to compute them don't exist.

**Flags, evidence-gated:** trend needs ≥6 months with volume
(else 'insufficient' — sup2 can never be 'Growing' on thin data);
Growing/Cooling at ±15% last-3 vs prev-3; 'Dispute pattern' at ≥2
disputes with one in 180d; 'Config incomplete' reuses `sellerReady`.

## Screens

- **HQ › Suppliers → supplier page** (`hqSupplierPage`, state `hqSup`,
  mirroring `hqBiz` — state-only, no address segment: deliberate
  deviation from the proposal for consistency with hqBusiness; HQ
  deep-linking is one addressing pass for both, later). Opened via
  the new **Open** row action; **Review** (the drawer) stays the edit
  door. Content: merchant-identity header + flags, stat row, 14-month
  bars, product performance, reliability kv, recent orders.
- **Portal dashboard** now reads the same door for Order value, Repeat
  orders, Training seats, and Best selling — '484.200 ден' and the
  hardcoded sold-counts are gone. HQ and the supplier see one truth.

## Pitfalls

- `money()` formats with a non-breaking space — tests comparing
  rendered text against `money()` output must normalize both sides.
- The generator's pick pool excludes `buy:0` items; don't reintroduce
  samples into ordering.
- `data-hqsup` lives in the env/hq registry string (next to
  data-hqbiz). Back-navigation is `data-hqsup=""`.
- Seeded refs count *down* from CEN-0040/AER-0030 — new hand-written
  POs keep counting up from `poSeq`.
