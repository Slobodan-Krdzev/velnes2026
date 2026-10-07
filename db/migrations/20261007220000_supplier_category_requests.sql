-- Suppliers ask HQ for a shelf (Alex, 2026-10-07) — docs/SUPPLIERS.md.
--
-- A supplier product stands on one of Velnes' product categories; when
-- the shelf it needs does not exist, the supplier asks for it the way a
-- salon does: a `category_requests` row with the same lifecycle
-- (pending → approved / declined), HQ's bell rung on the ask, the
-- answer rung back on the supplier's own bell. A request belongs to
-- exactly one of a salon or a supplier.

-- migrate:up

ALTER TABLE category_requests ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE category_requests ADD COLUMN supplier_id uuid REFERENCES suppliers(id);
ALTER TABLE category_requests ADD CONSTRAINT category_requests_one_asker
  CHECK ((tenant_id IS NULL) <> (supplier_id IS NULL));
CREATE INDEX category_requests_supplier ON category_requests (supplier_id, created_at);
CREATE POLICY supplier_own ON category_requests
  USING (supplier_id::text = current_setting('app.supplier_id', true))
  WITH CHECK (supplier_id::text = current_setting('app.supplier_id', true));

-- migrate:down

DROP POLICY supplier_own ON category_requests;
DROP INDEX category_requests_supplier;
ALTER TABLE category_requests DROP CONSTRAINT category_requests_one_asker;
DELETE FROM category_requests WHERE tenant_id IS NULL;
ALTER TABLE category_requests DROP COLUMN supplier_id;
ALTER TABLE category_requests ALTER COLUMN tenant_id SET NOT NULL;
