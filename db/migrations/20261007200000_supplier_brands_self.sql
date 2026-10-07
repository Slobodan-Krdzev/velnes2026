-- Suppliers add brands themselves (Alex, 2026-10-07) — docs/SUPPLIERS.md.
--
-- Until now a brand was an HQ row and the supplier's product form only
-- offered what its own catalog already carried. From here a supplier
-- adds a brand from the product panel: a new name becomes a platform
-- `brands` row (source 'supplier', remembered by whom), the supplier is
-- linked as carrying it, and HQ hears about it through its notices —
-- a note, not an approval step. Every brand is then offered to every
-- supplier; a name is matched case-insensitively so "Davines" and
-- "DAVINES" are one brand.

-- migrate:up

ALTER TABLE brands
  ADD COLUMN source text NOT NULL DEFAULT 'hq' CHECK (source IN ('hq','supplier')),
  ADD COLUMN added_by_supplier_id uuid REFERENCES suppliers(id),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX brands_name_ci ON brands (lower(name));

-- A supplier may add a brand in its own name, and may link itself to any brand.
CREATE POLICY supplier_add ON brands FOR INSERT
  WITH CHECK (source = 'supplier' AND added_by_supplier_id::text = current_setting('app.supplier_id', true));
CREATE POLICY supplier_carry ON supplier_brands FOR INSERT
  WITH CHECK (supplier_id::text = current_setting('app.supplier_id', true));

-- migrate:down

DROP POLICY supplier_carry ON supplier_brands;
DROP POLICY supplier_add ON brands;
DROP INDEX brands_name_ci;
ALTER TABLE brands DROP COLUMN created_at, DROP COLUMN added_by_supplier_id, DROP COLUMN source;
