-- migrate:up

-- A small product photo for the catalog rows and the till tiles.
-- Data URL — the file is the storage, like the business gallery.
ALTER TABLE products ADD COLUMN img text;

-- migrate:down

ALTER TABLE products DROP COLUMN img;
