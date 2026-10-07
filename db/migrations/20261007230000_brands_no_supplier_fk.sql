-- Brands are platform data; the supplier that added one is a note, not
-- a dependency (2026-10-07). The foreign key from brands.added_by_supplier_id
-- to suppliers let `TRUNCATE suppliers CASCADE` (the test seed) take the
-- whole brands table with it. The column stays as a plain reference —
-- a supplier that is gone leaves the brand and the note behind — and the
-- base brands are put back where they were lost.

-- migrate:up

ALTER TABLE brands DROP CONSTRAINT brands_added_by_supplier_id_fkey;
INSERT INTO brands (name, owner, country) VALUES
  ('Thera-Band', 'Performance Health', 'United States'),
  ('CureTape', 'Fysiotape BV', 'Netherlands'),
  ('Nordic Recovery', 'Nordic Recovery AB', 'Sweden'),
  ('OrthoPro', 'OrthoPro d.o.o.', 'Serbia')
ON CONFLICT (name) DO NOTHING;

-- migrate:down

ALTER TABLE brands ADD CONSTRAINT brands_added_by_supplier_id_fkey FOREIGN KEY (added_by_supplier_id) REFERENCES suppliers(id);
