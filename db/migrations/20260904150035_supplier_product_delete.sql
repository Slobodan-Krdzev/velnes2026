-- migrate:up

-- When a supplier deletes an official catalog product, a salon that
-- carried it keeps its own product row and simply loses the official
-- link. Order history still pins the product (its FK stays RESTRICT,
-- so a product that was ever ordered cannot be deleted).
ALTER TABLE products DROP CONSTRAINT products_supplier_product_id_fkey;
ALTER TABLE products
  ADD CONSTRAINT products_supplier_product_id_fkey
  FOREIGN KEY (supplier_product_id) REFERENCES supplier_products(id) ON DELETE SET NULL;

-- migrate:down

ALTER TABLE products DROP CONSTRAINT products_supplier_product_id_fkey;
ALTER TABLE products
  ADD CONSTRAINT products_supplier_product_id_fkey
  FOREIGN KEY (supplier_product_id) REFERENCES supplier_products(id);
