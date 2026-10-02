-- Products read off a salon's web shop carry a short description (Alex,
-- 2026-10-02); the panel can edit it, the shelf and the app show it.

-- migrate:up

ALTER TABLE products ADD COLUMN description text;

-- migrate:down

ALTER TABLE products DROP COLUMN description;
