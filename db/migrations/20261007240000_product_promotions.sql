-- Product promotions (Alex, 2026-10-07) — docs/CATALOG.md.
--
-- A salon puts one of its own products on promotion for a period: a
-- percentage off, or a promo price. One live-or-scheduled promotion per
-- product at a time; ending it early is a lifecycle step (active →
-- false, ended_at), never a delete, so the history of what was offered
-- when stays. The effective price is computed in ONE place
-- (`promoPrice` in contracts, applied by `prodAt`) and is what the
-- till charges, what a booking takes home, and what the public salon
-- page shows beside the crossed-out regular price.

-- migrate:up

CREATE TABLE product_promotions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES businesses(id),
  product_id       uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('pct','price')),
  value            integer NOT NULL CHECK (value > 0),           -- pct: 1..90 · price: whole denars
  starts           date NOT NULL,
  ends             date NOT NULL,
  active           boolean NOT NULL DEFAULT true,                -- false once ended early
  note             text NOT NULL DEFAULT '',
  created_by       uuid REFERENCES employees(id),
  created_by_name  text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  ended_at         timestamptz,
  CHECK (ends >= starts),
  CHECK (kind <> 'pct' OR value <= 90)
);
CREATE INDEX product_promotions_tenant_product ON product_promotions (tenant_id, product_id, ends DESC);
CREATE UNIQUE INDEX product_promotions_one_live ON product_promotions (tenant_id, product_id) WHERE active;
ALTER TABLE product_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_promotions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_promotions
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY hq_read ON product_promotions FOR SELECT
  USING (current_setting('app.hq', true) = '1');
-- No DELETE policy: a promotion ends, it is not erased.

-- migrate:down

DROP TABLE product_promotions;
