-- Supplier products stand on Velnes' shelves (Alex, 2026-10-07) — docs/SUPPLIERS.md.
--
-- A supplier product's category was free text. It is now one of the
-- platform's product categories (`product_categories`, HQ's taxonomy —
-- the same shelves a salon picks for its own products): `category_id`
-- is the link, `category` stays the denormalised name every reader
-- already shows and is kept in step when HQ renames a shelf. Existing
-- rows are matched by name, case-insensitively; a product whose text
-- matches no shelf keeps its text with no link and must be re-shelved
-- on its next edit — nothing is invented into HQ's taxonomy here.

-- migrate:up

ALTER TABLE supplier_products ADD COLUMN category_id uuid REFERENCES product_categories(id);
CREATE INDEX supplier_products_category ON supplier_products (category_id);

UPDATE supplier_products p
   SET category_id = c.id, category = c.name
  FROM product_categories c
 WHERE p.category_id IS NULL AND lower(p.category) = lower(c.name);

CREATE OR REPLACE FUNCTION app.sync_supplier_product_category() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE supplier_products SET category = NEW.name WHERE category_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_categories_rename AFTER UPDATE OF name ON product_categories
  FOR EACH ROW EXECUTE FUNCTION app.sync_supplier_product_category();

-- migrate:down

DROP TRIGGER product_categories_rename ON product_categories;
DROP FUNCTION app.sync_supplier_product_category();
DROP INDEX supplier_products_category;
ALTER TABLE supplier_products DROP COLUMN category_id;
