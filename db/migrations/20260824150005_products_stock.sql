-- migrate:up

-- Products and transactional stock. Stock is a ledger
-- (stock_movements) plus a materialized quantity on the per-location
-- row, both written by the ONE stockMove door in one transaction.
-- Stock is never copied between locations — only moved.

CREATE TYPE stock_movement_kind AS ENUM
  ('adjustment','transfer_in','transfer_out','delivery','sale','own_use');

CREATE TABLE product_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES businesses(id),
  name        text NOT NULL,
  parent_id   uuid REFERENCES product_categories(id),  -- reserved: tree
  sort        integer NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, name)
);
CREATE INDEX product_categories_tenant ON product_categories (tenant_id, sort);
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_categories
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES businesses(id),
  name         text NOT NULL,
  category_id  uuid REFERENCES product_categories(id),
  sku          text,
  price        integer NOT NULL DEFAULT 0,   -- whole MKD denars; 0 for own-use
  cost         integer,                      -- purchase price (own-use costing)
  vat          integer NOT NULL DEFAULT 18,
  active       boolean NOT NULL DEFAULT true,
  own          boolean NOT NULL DEFAULT false,  -- own use: never sold
  use          text,                         -- e.g. 'pro'
  size_amount  integer,                      -- container size (own use)
  size_unit    text,                         -- e.g. 'ml'
  seller_legal_entity_id uuid REFERENCES legal_entities(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_tenant ON products (tenant_id, active);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON products
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE location_catalog_products (
  tenant_id     uuid NOT NULL REFERENCES businesses(id),
  location_id   uuid NOT NULL REFERENCES locations(id),
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  active        boolean NOT NULL DEFAULT true,
  price         integer NOT NULL,
  low_stock     integer NOT NULL DEFAULT 2,
  pos           boolean NOT NULL DEFAULT true,   -- own-use rows are never pos
  stock         integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  opened_amount integer NOT NULL DEFAULT 0,      -- open container (own use)
  PRIMARY KEY (location_id, product_id)
);
CREATE INDEX location_catalog_products_tenant ON location_catalog_products (tenant_id, location_id, active);
ALTER TABLE location_catalog_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_catalog_products FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON location_catalog_products
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE stock_movements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES businesses(id),
  location_id  uuid NOT NULL REFERENCES locations(id),
  product_id   uuid NOT NULL REFERENCES products(id),
  qty          integer NOT NULL,               -- signed delta
  kind         stock_movement_kind NOT NULL,
  ref          text,                           -- transfer pair id, invoice, order…
  note         text,
  actor_employee_id uuid REFERENCES employees(id),
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_tenant ON stock_movements (tenant_id, location_id, product_id, at);
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;
-- Append-only ledger: SELECT + INSERT, no UPDATE/DELETE policies.
CREATE POLICY tenant_read ON stock_movements FOR SELECT
  USING (tenant_id = app.current_tenant());
CREATE POLICY tenant_append ON stock_movements FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant());

-- migrate:down

DROP TABLE stock_movements;
DROP TABLE location_catalog_products;
DROP TABLE products;
DROP TABLE product_categories;
DROP TYPE stock_movement_kind;
