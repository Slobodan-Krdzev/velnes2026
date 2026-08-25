-- migrate:up

-- ══ The supplier chain (Phase 10) ════════════════════════════════
-- supplier catalog → own catalog → stock per location → consumption
-- or sale → forecast → order → delivery. Every step writes into the
-- same records.
--
-- Suppliers are PLATFORM entities: one supplier serves many salons.
-- Platform rows carry tenant_id NULL and are readable by every
-- tenant; the supplier's own people read through app.supplier_id —
-- the same explicit-mode pattern as app.hq.

CREATE TABLE suppliers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  type       text NOT NULL DEFAULT 'Distributor',
  territory  text NOT NULL DEFAULT '',
  verified   boolean NOT NULL DEFAULT false,
  min_order  integer NOT NULL DEFAULT 0,      -- denars
  lead       text NOT NULL DEFAULT '',
  terms      text NOT NULL DEFAULT '',
  contact    text NOT NULL DEFAULT '',
  manager    text NOT NULL DEFAULT '',
  rating     numeric(3,1),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_read ON suppliers FOR SELECT
  USING (current_setting('app.tenant_id', true) IS NOT NULL
         OR current_setting('app.supplier_id', true) IS NOT NULL
         OR current_setting('app.hq', true) = '1');

CREATE TABLE supplier_products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  brand       text NOT NULL DEFAULT '',
  name        text NOT NULL,
  sku         text NOT NULL DEFAULT '',
  ean         text NOT NULL DEFAULT '',
  size        text NOT NULL DEFAULT '',
  pack        integer NOT NULL DEFAULT 1,
  buy         integer NOT NULL DEFAULT 0,     -- purchase price, denars
  rrp         integer NOT NULL DEFAULT 0,     -- recommended retail, denars
  vat         integer NOT NULL DEFAULT 18,
  moq         integer NOT NULL DEFAULT 1,
  stock       integer NOT NULL DEFAULT 0,     -- the supplier's stock
  lead        text NOT NULL DEFAULT '',
  use         text NOT NULL DEFAULT 'both',   -- pro | retail | both
  category    text NOT NULL DEFAULT '',
  descr       text NOT NULL DEFAULT '',
  sample      boolean NOT NULL DEFAULT false,
  own_size    integer,
  own_unit    text,
  active      boolean NOT NULL DEFAULT true
);
ALTER TABLE supplier_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_products FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_read ON supplier_products FOR SELECT
  USING (current_setting('app.tenant_id', true) IS NOT NULL
         OR current_setting('app.supplier_id', true) IS NOT NULL
         OR current_setting('app.hq', true) = '1');
CREATE POLICY supplier_write ON supplier_products
  USING (supplier_id::text = current_setting('app.supplier_id', true))
  WITH CHECK (supplier_id::text = current_setting('app.supplier_id', true));

-- The supplier's own people — like hq_users, their own principals.
CREATE TABLE supplier_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id   uuid NOT NULL REFERENCES suppliers(id),
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  role          text NOT NULL DEFAULT 'sr_account',
  password_hash text NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE supplier_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_users FORCE ROW LEVEL SECURITY;
CREATE POLICY supplier_own ON supplier_users
  USING (supplier_id::text = current_setting('app.supplier_id', true))
  WITH CHECK (supplier_id::text = current_setting('app.supplier_id', true));
CREATE POLICY supplier_login_lookup ON supplier_users FOR SELECT
  USING (current_setting('app.auth', true) = 'login');

-- ── Tenant side. ─────────────────────────────────────────────────

CREATE TABLE supplier_connections (
  tenant_id    uuid NOT NULL REFERENCES businesses(id),
  supplier_id  uuid NOT NULL REFERENCES suppliers(id),
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','connected','declined')),
  customer_no  text NOT NULL DEFAULT '',
  connected    date,
  share        jsonb NOT NULL DEFAULT '{}',  -- {orders,stock,sales,training}
  location_ids uuid[] NOT NULL DEFAULT '{}',
  note         text NOT NULL DEFAULT '',
  PRIMARY KEY (tenant_id, supplier_id)
);
ALTER TABLE supplier_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON supplier_connections
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY supplier_read ON supplier_connections FOR SELECT
  USING (supplier_id::text = current_setting('app.supplier_id', true));
CREATE POLICY supplier_decide ON supplier_connections FOR UPDATE
  USING (supplier_id::text = current_setting('app.supplier_id', true))
  WITH CHECK (supplier_id::text = current_setting('app.supplier_id', true));
-- The portal shows the salon's name for its connections.
CREATE POLICY supplier_read ON businesses FOR SELECT
  USING (current_setting('app.supplier_id', true) IS NOT NULL
         AND id IN (SELECT tenant_id FROM supplier_connections
                    WHERE supplier_id::text = current_setting('app.supplier_id', true)));

CREATE TYPE purchase_order_status AS ENUM
  ('draft','approval','submitted','accepted','partial','processing',
   'shipped','partdelivered','delivered','cancelled','disputed');

CREATE TABLE purchase_orders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES businesses(id),
  ref         text NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  location_id uuid NOT NULL REFERENCES locations(id),
  status      purchase_order_status NOT NULL DEFAULT 'draft',
  created_by  uuid,
  by_name     text NOT NULL DEFAULT '',
  expected    date,
  offer_id    uuid,
  track       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_orders_tenant ON purchase_orders (tenant_id, status);
CREATE INDEX purchase_orders_supplier ON purchase_orders (supplier_id, status);
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_orders
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY supplier_read ON purchase_orders FOR SELECT
  USING (supplier_id::text = current_setting('app.supplier_id', true)
         AND status <> 'draft' AND status <> 'approval');
CREATE POLICY supplier_progress ON purchase_orders FOR UPDATE
  USING (supplier_id::text = current_setting('app.supplier_id', true)
         AND status <> 'draft' AND status <> 'approval')
  WITH CHECK (supplier_id::text = current_setting('app.supplier_id', true));

CREATE TABLE purchase_order_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES businesses(id),
  order_id            uuid NOT NULL REFERENCES purchase_orders(id),
  supplier_product_id uuid NOT NULL REFERENCES supplier_products(id),
  qty                 integer NOT NULL CHECK (qty > 0),
  price               integer NOT NULL,      -- per unit, denars
  free                integer NOT NULL DEFAULT 0,
  recv                integer NOT NULL DEFAULT 0,
  dmg                 integer NOT NULL DEFAULT 0,
  sort                integer NOT NULL DEFAULT 0
);
CREATE INDEX purchase_order_lines_order ON purchase_order_lines (order_id);
ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_order_lines
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY supplier_read ON purchase_order_lines FOR SELECT
  USING (EXISTS (SELECT 1 FROM purchase_orders o WHERE o.id = order_id
                 AND o.supplier_id::text = current_setting('app.supplier_id', true)
                 AND o.status <> 'draft' AND o.status <> 'approval'));

-- Supplier promotions, platform rows readable by connected salons.
CREATE TABLE supplier_promotions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  brand       text NOT NULL DEFAULT '',
  title       text NOT NULL,
  kind        text NOT NULL DEFAULT 'pct',   -- pct | bxgy | gift
  product_ids uuid[] NOT NULL DEFAULT '{}',
  starts      date NOT NULL,
  ends        date NOT NULL,
  min_order   integer NOT NULL DEFAULT 0,
  usage_limit integer NOT NULL DEFAULT 0,
  terms       text NOT NULL DEFAULT '',
  audience    text NOT NULL DEFAULT 'Connected salons only',
  value       integer NOT NULL DEFAULT 0,    -- pct: percent · bxgy: free per N
  per         integer NOT NULL DEFAULT 0,    -- bxgy: N bought
  active      boolean NOT NULL DEFAULT true
);
ALTER TABLE supplier_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_promotions FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_read ON supplier_promotions FOR SELECT
  USING (current_setting('app.tenant_id', true) IS NOT NULL
         OR current_setting('app.supplier_id', true) IS NOT NULL);
CREATE POLICY supplier_write ON supplier_promotions
  USING (supplier_id::text = current_setting('app.supplier_id', true))
  WITH CHECK (supplier_id::text = current_setting('app.supplier_id', true));

-- The link from the salon's own product to its supplier source.
ALTER TABLE products ADD COLUMN supplier_product_id uuid REFERENCES supplier_products(id);

-- migrate:down
ALTER TABLE products DROP COLUMN supplier_product_id;
DROP TABLE supplier_promotions;
DROP TABLE purchase_order_lines;
DROP TABLE purchase_orders;
DROP TYPE purchase_order_status;
DROP POLICY supplier_read ON businesses;
DROP TABLE supplier_connections;
DROP TABLE supplier_users;
DROP TABLE supplier_products;
DROP TABLE suppliers;
