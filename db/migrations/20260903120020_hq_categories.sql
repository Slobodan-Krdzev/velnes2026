-- migrate:up

-- Categories become a Velnes-owned taxonomy (Alex, 2026-09-03):
-- RevelappsHQ defines them, salons pick from the list when they
-- create services and products. "Knee massage" is the salon's name;
-- "Massage" is the platform's shelf it stands on. Same for products.
--
-- The tables stay where every join expects them — they just stop
-- being per-tenant: duplicate names collapse into one platform row,
-- tenant_id goes, reads open to every context, writes only to HQ.

-- ── service_categories ────────────────────────────────────────
-- Collapse per-tenant duplicates onto one survivor per name.
UPDATE services s SET category_id = keep.id
FROM service_categories c
JOIN LATERAL (
  SELECT min(id::text)::uuid AS id FROM service_categories k WHERE k.name = c.name
) keep ON true
WHERE s.category_id = c.id AND c.id <> keep.id;
DELETE FROM service_categories c
WHERE c.id <> (SELECT min(id::text)::uuid FROM service_categories k WHERE k.name = c.name);

DROP POLICY tenant_isolation ON service_categories;
ALTER TABLE service_categories DROP CONSTRAINT service_categories_tenant_id_name_key;
DROP INDEX service_categories_tenant;
ALTER TABLE service_categories DROP COLUMN tenant_id;
ALTER TABLE service_categories ADD CONSTRAINT service_categories_name_key UNIQUE (name);

CREATE POLICY read_all ON service_categories FOR SELECT USING (true);
CREATE POLICY hq_write ON service_categories
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

-- ── product_categories ────────────────────────────────────────
UPDATE products p SET category_id = keep.id
FROM product_categories c
JOIN LATERAL (
  SELECT min(id::text)::uuid AS id FROM product_categories k WHERE k.name = c.name
) keep ON true
WHERE p.category_id = c.id AND c.id <> keep.id;
DELETE FROM product_categories c
WHERE c.id <> (SELECT min(id::text)::uuid FROM product_categories k WHERE k.name = c.name);

DROP POLICY tenant_isolation ON product_categories;
ALTER TABLE product_categories DROP CONSTRAINT product_categories_tenant_id_name_key;
DROP INDEX product_categories_tenant;
ALTER TABLE product_categories DROP COLUMN tenant_id;
ALTER TABLE product_categories ADD CONSTRAINT product_categories_name_key UNIQUE (name);

CREATE POLICY read_all ON product_categories FOR SELECT USING (true);
CREATE POLICY hq_write ON product_categories
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

-- ── The base Velnes taxonomy ──────────────────────────────────
-- Platform data, not tenant data: enough for the seeded world, the
-- registration templates, and the obvious wellness shelves. HQ
-- extends it through its own door.
INSERT INTO service_categories (name, sort) VALUES
  ('Assessment', 1), ('Manual therapy', 2), ('Rehab', 3), ('Recovery', 4),
  ('Massage', 5), ('Haircuts', 6), ('Skin care', 7), ('Nails', 8), ('Wellness', 9)
ON CONFLICT (name) DO NOTHING;
INSERT INTO product_categories (name, sort) VALUES
  ('Home exercise', 1), ('Recovery aids', 2), ('Supports', 3), ('Own use', 4),
  ('Hair care', 5), ('Skin care', 6)
ON CONFLICT (name) DO NOTHING;

-- migrate:down

DELETE FROM service_categories WHERE name IN ('Massage','Haircuts','Skin care','Nails','Wellness')
  AND NOT EXISTS (SELECT 1 FROM services s WHERE s.category_id = service_categories.id);
DELETE FROM product_categories WHERE name IN ('Hair care','Skin care')
  AND NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id = product_categories.id);

DROP POLICY read_all ON service_categories;
DROP POLICY hq_write ON service_categories;
ALTER TABLE service_categories DROP CONSTRAINT service_categories_name_key;
ALTER TABLE service_categories ADD COLUMN tenant_id uuid REFERENCES businesses(id);
CREATE POLICY tenant_isolation ON service_categories
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

DROP POLICY read_all ON product_categories;
DROP POLICY hq_write ON product_categories;
ALTER TABLE product_categories DROP CONSTRAINT product_categories_name_key;
ALTER TABLE product_categories ADD COLUMN tenant_id uuid REFERENCES businesses(id);
CREATE POLICY tenant_isolation ON product_categories
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
