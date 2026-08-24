# Proposal — Kassa + widget through `priceFor()` · 20 aug 2026

**Status: awaiting Alex's approval. No code has been changed.**
Base build: `51074cf62bd96bc0a5b92865dee23546` (19,899 lines).

## Why this milestone exists

Three features currently promise a price they cannot yet deliver:

1. **Personal offers** carry a `specialPrice`, but the till doesn't know
   about them. The bridge is the manual "Mark as redeemed" button — the
   code comments call it exactly that: *"de brug totdat kassa/widget via
   priceFor() de speciale prijs zelf toepassen."*
2. **Member offers** (`premiumOffers`) carry `sid`, `price`, and a
   `stage`, but neither the till nor the booking flow reads them.
3. **Slot offers** (last-minute) already flow through `priceFor()` — but
   only the *catalog* asks; the till adds lines from the tile's list
   price and the widget's checkout computes its own total.

The rule of the codebase is doors-not-screens. The price door exists;
this milestone makes the two money surfaces walk through it.

## What changes, by surface

### 1. `priceFor()` learns the two missing option kinds

Two new branches inside the door — nothing outside it computes:

- **`kind:'personal'`** — when `custId` has a live personal offer for
  this `sid` (status live, within validity window, matching variant
  where the offer names one), push
  `{kind:'personal',price:po.specialPrice,label:'Personal offer',
  poId:po.id,spends:false}`.
- **`kind:'member'`** — when a live `premiumOffers` row matches this
  `sid`+`slotId` and the customer may see the current stage
  (stage 1: first candidate only; stage 2: any candidate; stage 3:
  everyone when `publicFallback`), push
  `{kind:'member',price:o.price,label:stage label,pmoId:o.id,
  spends:false}`.

`best` selection is unchanged: cheapest non-spending option wins, the
struck-through base stays visible via the existing `priceTag()`.
Precedence needs no new rule — cheapest wins, and if a personal promise
is cheaper than a last-minute offer, the promise is honoured, which is
what "promise" means.

### 2. The till resolves lines through the door

`d.add` currently splits `id|name|price` from the tile and books that
price. Change: for service lines, after variant/modifier choice, the
line price comes from
`priceFor({sid,locId,variantId,custId:saleCustomer(...),slotId,
channel:'till'})` — with the modifier delta added on top, exactly as
`svcLine` composes it today. Products keep their list price (no offer
kinds apply). The basket line remembers `poId`/`pmoId` when a special
price was applied, so the receipt line can say why.

**Timing rule (the honest part):** the customer may be attached to the
sale *after* lines are added. So the till re-resolves service-line
prices whenever the sale's customer changes — one function,
`tillReprice()`, called from the attach/detach points. A manual line
discount entered by staff survives repricing (staff intent beats
automation), with the struck-through base updating underneath.

### 3. `finishSale()` settles the promises

When a line carries `poId`: mark that personal offer `redeemed`, write
the existing `offer_redeemed` activity event with the invoice number.
When a line carries `pmoId`: mark the member offer `booked`, write
`member_offer_redeemed` (new event name, same `activityLog` door).
This is what retires the manual buttons:

- **"Mark as redeemed"** on personal offers stays in the UI but is
  relabelled **"Redeem manually (admin override)"** and logs
  `offer_redeemed` with `{override:true}`. The normal path is the till.
- **"Advance stage · demo"** is unchanged this milestone — it simulates
  the clock, not the payment, and the clock is still simulated. Its
  retirement was always tied to a real clock, not to this milestone.

### 4. The booking flow (widget + link) prices through the door

`viewBook` step 5 currently computes `cfg.price − coupon`. Change: the
total starts from `priceFor({sid,locId,variantId,custId,slotId,
channel:'online'})` + modifier delta, with the offer label shown on the
summary ("Last-minute — 25% off", "Personal offer") and the base struck
through. Guest bookers have no `custId`, so they see list or public
slot-offer prices — correct by construction. `confirmReservation`
stores the applied `poId`/`pmoId` on the appointment so the *till*
settles the promise at checkout time (a booking reserves; paying
redeems). Deposit math keys off the effective price.

### 5. What explicitly does not change

- Velnes Premium still never touches price (access + points only).
- `svcChoice` stays the variant/duration door; `priceFor` composes it.
- Slot-offer semantics (phases, audiences, eligibility) untouched.
- No UI redesign of the till or booking flow — labels and struck
  prices only, using the existing `priceTag` visual language.

## Test plan

New suite `test-pricefor.js` (~35 checks):
- personal offer beats list at the till for its customer, not others;
  wrong service/expired/cancelled offers don't fire.
- attach-customer-after-lines reprices; detach restores; manual line
  discount survives repricing.
- finishSale marks the personal offer redeemed with invoice number;
  second sale cannot redeem it again.
- member offer prices stage-correctly (candidate 1 at stage 1; others
  only at stage 2; public at stage 3 with fallback on, never with it
  off); booking stores pmoId; till settles it.
- booking flow: guest sees list/public price; known customer sees the
  personal price; deposit computed on the effective price.
- cheapest-wins precedence when personal and slot offers overlap.

Regression: pos (112), timing (122), offers (46), customerci (183),
velnespremium (67), screens, flightdeck — the till suites encode the
old pricing, so **test-pos will need intentional updates** where it
asserts list prices for seeded customers with live offers; every such
change listed in the handover addendum.

## Risks / pitfalls to respect

- Pitfall 9: `saleCustomer` resolves via appointment lines — repricing
  must use the same resolution, never a parallel one.
- Pitfall 4: variants carry `label` not `name`; all resolution stays in
  `svcChoice`.
- Seeded personal/member offers must exist for tests — seed one of each
  deterministically (same seeded-history discipline as CI).
- `perOfferSeq`, `pmoSeq` are taken; no new top-level `let` without a
  grep.

## Definition of done

Till and booking flow show and charge the door's price; promises settle
themselves at payment with events; manual redeem is an override; all
suites green; md5 chain and addendum written.
