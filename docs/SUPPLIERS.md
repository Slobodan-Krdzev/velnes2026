# The Supplier Chain & Portal (Phase 10)

supplier catalog → own catalog → stock per location → consumption or
sale → order → delivery. Every step writes into the same records.

## The model

**Suppliers are platform entities** — one supplier serves many
salons. `suppliers`, `supplier_products` and `supplier_promotions`
carry no tenant and are readable by every tenant context; the
supplier's own people read through `app.supplier_id` — the same
explicit-mode pattern as `app.auth`, `app.public` and `app.hq`.

**The relationship is per tenant**: `supplier_connections` holds the
salon's status (`pending → connected/declined`), customer number,
share flags and participating locations. RLS gives the supplier read
and decide rights on exactly its own connections; a supplier never
sees a salon until the salon asks.

**Orders** (`purchase_orders` + lines) are tenant rows with a
supplier read/progress policy that excludes drafts and
internal-approval states — the supplier sees an order when the salon
submits it, not while it is being thought about. `poTransition` is
the status field's only writer, and each side owns its own edges:
the salon walks draft → approval → submitted (and receives at the
end); the supplier walks submitted → accepted/partial → processing →
shipped with the tracking number.

**Ordering rules at the door**: per-product MOQ, the supplier's
minimum order at submit, samples refused from ordering (they are
requested), and the live buy-X-get-Y promotion adding its free units
by itself — the owner never types an offer twice.

**Receiving counts what actually arrived**: only confirmed
quantities go into stock — a `stock_movements` 'delivery' row plus
the location counter, through the salon product linked by
`products.supplier_product_id`. Damaged and missing units never
reach stock; a shortage keeps the order open as *partially
delivered* until the rest arrives. Every step lands in the salon's
audit trail — the supplier's steps as `Supplier · name`.

## The workspace screen

The prototype's SUP_TABS: the supplier list in its three honest
states, the supplier catalog (samples and in-your-catalog links
flagged), the orders table with internal approval and receive in
place, the order draft with the minimum gate on the submit button,
the counting screen for deliveries, and Academy's honest empty state
until the trainings engine lands.

## The portal (apps/supplier)

The supplier's own workspace with its own principals
(`supplier_users`) and its own 8-hour token — the tenant, HQ and
supplier claim shapes all reject each other by construction.
Dashboard (stats, connection requests, the read-only payments note —
configuration is HQ's, credentials never shown), salons, catalog
(stock/price/active edits every connected salon sees immediately),
orders (the supplier's side of the flow), promotions. Academy,
reports and settings say plainly which engine they wait for.
Trilingual like every other app.

## Tests

- `suppliers.test.ts` — connection states and the handshake under
  RLS, MOQ/minimum/sample refusals, the self-applying promotion, the
  portal's side of the flow with the wrong-side check, receiving with
  shortage (stock delta = good units only), and the token separation.
- `apps/workspace/.../Suppliers.test.tsx` and
  `apps/supplier/src/App.test.tsx` — both UIs against mocked doors.
- `e2e/supplier.spec.ts` — the chain across two real apps: submit
  with free units → portal accept/process/ship → receive with a
  shortage → partially delivered.

## Deferred honestly

Reorder advice (needs the consumption forecast over recipes), sample
requests, supplier source-updates (accept/keep-mine), academy
trainings and certificates, supplier team management, sell-through
reports, the HQ Supplier Intelligence pane.
