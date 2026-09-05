-- migrate:up
-- A combo (the till calls it a Package) bundles services and products
-- into one sellable line. The items live as JSONB — each entry points
-- at a real service or product id with a quantity — so a combo can
-- never become a text-only line; the server validates every reference
-- against the tenant's own catalog before it will save.
CREATE TYPE combo_status AS ENUM ('active','draft');

CREATE TABLE combos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES businesses(id),
  name        text NOT NULL,
  category    text,                              -- display grouping, like the prototype's cat
  descr       text NOT NULL DEFAULT '',
  validity    text NOT NULL DEFAULT '12 months',
  regular     integer NOT NULL,                  -- combined regular price, whole MKD
  price       integer NOT NULL,                  -- combo sale price
  vat         integer NOT NULL DEFAULT 18,
  status      combo_status NOT NULL DEFAULT 'active',
  pos         boolean NOT NULL DEFAULT true,     -- for sale in the till
  online      boolean NOT NULL DEFAULT false,
  items       jsonb NOT NULL DEFAULT '[]',       -- [{type,id,qty}]
  sort        integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX combos_tenant ON combos (tenant_id, sort);
ALTER TABLE combos ENABLE ROW LEVEL SECURITY;
ALTER TABLE combos FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON combos
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
-- The public booking surface reads the tenant's online combos.
CREATE POLICY public_read ON combos FOR SELECT
  USING (current_setting('app.public', true) = '1' AND online = true AND status = 'active');

-- migrate:down
DROP TABLE combos;
DROP TYPE combo_status;
