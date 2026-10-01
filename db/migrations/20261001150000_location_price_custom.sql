-- A location's own price (Alex, 2026-10-01): a row in
-- location_catalog_services keeps its price or duration only once
-- someone set it FOR THAT LOCATION — the inline cell, the panel's
-- per-location table, the override door. Until then the row mirrors
-- the salon-wide value and follows every change to it. The old rule
-- ("follow when still equal to the old salon-wide value") could not heal
-- a row the earlier bug had already left behind; this flag can.
-- Backfill: nothing is custom — every row is a mirror until set.

-- migrate:up

ALTER TABLE location_catalog_services
  ADD COLUMN custom_price    boolean NOT NULL DEFAULT false,
  ADD COLUMN custom_duration boolean NOT NULL DEFAULT false;

-- migrate:down

ALTER TABLE location_catalog_services
  DROP COLUMN custom_price,
  DROP COLUMN custom_duration;
