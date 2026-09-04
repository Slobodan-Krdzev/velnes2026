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

## The portal takes the prototype's shape — Phase A (2026-09-04)

The supplier app (`apps/supplier`) now wears the prototype's viewPortal
chrome: the left sidebar (Dashboard · Orders · Salons · Catalog ·
Promotions · Academy · Reports, with Settings in the foot) over the
shared `.shell`/`.topbar`, the avatar menu (signed-in, language, sign
out). The five data-backed tabs are pixel-faithful and real:

- **Dashboard** — the grid5 (connected salons, open orders, order
  value over 30 days, repeat-order rate, training seats), the
  read-only Payments card (the supplier's own legal entity + payment
  account via new `supplier_read` policies on `legal_entities`/
  `payment_accounts`; configuration stays HQ's, credentials never
  shown), New-connection-requests with accept/decline, Best-selling
  (top products by qty × price from real order lines) and
  Needs-attention (derived honestly: out-of-stock products, disputed
  orders, promotions ending soon — never the prototype's hard-coded
  three). Training seats read '—' until the academy engine lands.
- **Salons** — the connected-salon table with real order counts and
  value. Per Alex's call, the prototype's Segment and Account-manager
  columns are dropped (no backing in `supplier_connections`).
- **Catalog** — the full table (brand, article number, buy, advised
  retail, stock, use, active) with inline stock/active edits, the
  Add-product drawer (real: publishes to `supplier_products`), Bulk
  update / Import as honest toasts (no engine).
- **Orders** — the prototype layout over our real transition flow
  (accept → process → ship with tracking); the order contract now
  carries salon + location names.
- **Promotions** — the rowcard list and the Add-promotion drawer
  (real: writes `supplier_promotions`).

The portal Add buttons follow the role's permissions (the prototype's
seedPortalRolePerms matrix, held in `portalScope` until Phase B moves
supplier roles into their own table): an Account Manager may add
promotions but not products; a Catalog Manager the reverse. Honest
deviation from the prototype: no topbar notices bell (suppliers have
no notices surface). Academy, Reports and Settings still show honest
'engine pending' states — Phases B (Settings: real team + roles) and
C (Academy shell + Reports) follow.

## The portal's Settings, Academy and Reports — Phases B & C (2026-09-04)

**Settings** is real. Migration 20260904130033 adds `supplier_roles`
(the prototype's seven roles seeded with the `seedPortalRolePerms`
matrix over PO_PERM_GROUPS × none/own/all; `sr_owner` locked),
binds `supplier_users.role` to it by FK, and widens the user-status
check to include `invited`. The tab wears the prototype's poSettings:
the read-only Company card (real `suppliers` row — verification and
fees stay HQ's), the role kit (`roleListCard`) with per-role
user-count popups, the People table, the Add pop (Team member /
Role), the invite/edit member drawer, and the role drawer whose
permission scopes move one select at a time. Everything is
owner-gated: `POST/PATCH/DELETE /portal/{team,roles}` require the
caller's role to hold `po.users` (only `sr_owner`), enforced live
from `supplier_roles`; an Account Manager gets 403. The last owner
can't be demoted or removed, nobody removes themselves, and a
standard/locked/occupied role can't be deleted. Team invites travel
through the outbox (`supplier_invite`, migration 20260904140034 lets
the supplier context insert its own tenant-less invite rows). The
seed now gives BeautyPro an owner (Bojan Cvetkov, `sr_owner`) so the
kit has a keyholder. Note: `po.promotions` is seeded `own` for
Account Managers even though it is a flat permission — the drawer
shows the stored value rather than snapping it to none/all.

**Academy** is the prototype's poAcademy shell — the toolbar,
Add button (owner/trainer), the full course table header and the
footer note — over an honest empty state: the trainings engine is
not built, so there are no rows and Add says so.

**Reports** is real where derivable (`GET /portal/reports`): order
value, order count, average order, repeat rate and the by-salon
table all computed from the supplier's own `purchase_orders`; the
promotion list is real. What has no source yet is honest — promotion
uptake reads '—' ("not tracked yet", the promo→order link doesn't
exist), and the Training card waits for the academy engine.

## Deferred honestly (updated)

The trainings/academy engine (courses, registrations, seats,
certificates) and the sell-through / promotion-uptake metrics remain
deferred — the portal renders their shells honestly. Custom supplier
roles are currently platform-wide rather than per-supplier (the
prototype's model); scoping them per supplier waits for a second
real supplier.

## The Orders screen gains a full order-detail view (2026-09-04)

Every order row is now clickable and carries a **Details** button that
opens an order-detail drawer built from the real order lines: the
header (ref, salon, location, placed date, status, ordered-by,
tracking, expected), a lines table (product + article number,
quantity, free units, damaged units when any, unit price and line
total) and the order total. The prototype's status actions land too:
finished orders (shipped/delivered/partdelivered) show **Invoice**
and disputed orders show **Credit note** — both open the same drawer
in an invoice or credit-note framing. The formal fiscal documents
themselves stay honest deferrals: the invoice view notes that a
numbered fiscal invoice with VAT breakdown and PDF export waits for
the fiscalization provider decision, and the credit-note view shows
the disputed/damaged units with a note that formal issuance waits for
the same decision (settle with the salon directly until then). No new
endpoint — the drawer renders the order the list already loaded.

## Orders: search and status filter (2026-09-04)

The Orders toolbar gains a search box (matches order ref/number,
salon, location, the person who placed it, or the order value —
"8460", "8,460" and "MKD 8,460" all match) and a status filter
(All statuses, then each status actually present — submitted,
accepted, partial, processing, shipped, partdelivered, delivered,
disputed, cancelled). Both are client-side over the already-loaded
list and compose; the toolbar count switches from "N open" to
"N shown" while a filter or search is active, and a no-match line
shows when nothing fits. Note there is no "paid" status: payment
state is not tracked per order, so the filter offers the fulfilment
lifecycle statuses only.

## Salons: the Export button is real (2026-09-04)

The prototype's poCustomers Export button only toasted "Exported";
in the portal it now downloads the connected-salon list as a real
CSV (Salon, Customer number, Connected date, Orders, Value in MKD,
Open orders, Status — the value raw for spreadsheets, the status
localised), UTF-8 with a BOM so Excel reads it correctly, named
`<supplier-slug>-salons-<date>.csv`. It is pure client-side over the
already-loaded list (no endpoint) and toasts how many rows it wrote.

## Catalog: bulk update, add/edit panels, delete, availability (2026-09-04)

The catalog is fully editable for owner/catalog-manager roles (read
only for the rest):

- **Availability toggle** per row removes a product from ordering
  (writes `active`), replacing the earlier inline stock field —
  stock is now edited in the panel, matching the prototype's
  read-only table.
- **Edit** opens the prototype's poProductEdit drawer with every
  official field prefilled (PATCH `/portal/catalog/:id`, now full
  fields), an honest "sends a proposal to every connected salon"
  note, and a **Delete product** action. Delete (DELETE
  `/portal/catalog/:id`) refuses a product with order history (409 —
  turn off availability instead); a salon that carried a deleted
  product keeps its own row and loses only the official link
  (migration 20260904150035 makes `products.supplier_product_id`
  ON DELETE SET NULL), and the product drops out of any promotions.
- **Bulk update** opens a panel that applies a ± percentage to buy
  and/or advised-retail across the whole catalog (POST
  `/portal/catalog/bulk`, rounded to the nearest MKD).
- **Add** publishes a new product (unchanged).

Every write is gated live by the role's `po.catalog` scope, so an
Account Manager sees the catalog read-only. Import-a-list stays an
honest toast (no engine).

## Portal notifications, order-placed mail, newest-orders card (2026-09-04)

When a salon submits a purchase order to a supplier — whether a
direct submit or an internal-approval draft reaching `submitted` —
`notifyOrderSubmitted` (inside the order's own transaction, under the
salon's tenant context) does two things: drops a row in the
supplier's feed (`supplier_notifications`, migration 20260904160036;
the salon's tenant context may INSERT, the supplier reads its own via
RLS) and queues an `order_placed` mail to the supplier's orders inbox
(the email parsed from `suppliers.contact`) through the outbox — mock
transport (`mock_sent`) until the SMTP provider is decided, the same
honest path as every other Velnes mail.

The portal grew a **notification bell** in the topbar (GET
`/portal/notifications`, unseen dot tracked by a localStorage
timestamp like HQ's notices; a click jumps to Orders) and a **Newest
orders** card on the dashboard (the five most recent orders, from
`recentOrders` on the dashboard payload, with a View-all link to the
Orders tab).

## Order accept / decline with a reason, surfaced back to the salon (2026-09-04)

The portal's order drawer carries **Accept** and **Decline** actions
(gated by the role's `po.orders` scope). Accept advances the order
along its normal supplier-side path. Decline opens a required-reason
field and only then transitions the order to `cancelled`: the service
(`poTransition`, supplier side → `cancelled`) refuses a decline with
no reason (422 `INVALID` — "A reason is required to decline an
order"), stamps the reason onto `purchase_orders.supplier_note`
(migration 20260904170037) and onto the transition's audit row.

The salon sees the outcome without leaving its own Suppliers → Orders
tab: a declined order renders in the `danger` tone and shows the
supplier's words inline under the order reference
(`sup.declinedReason` → "Declined by supplier: {{reason}}"), read from
`supplierNote` on the purchase-order contract. One door, one reason,
audited server-side and honestly shown on both sides of the connection.
