-- migrate:up

-- The new-location wizard captures the full civic address; a foreign
-- country flags the holiday-calendar and fiscal-profile follow-ups.
ALTER TABLE locations
  ADD COLUMN zip text,
  ADD COLUMN country text NOT NULL DEFAULT 'North Macedonia';

-- migrate:down
ALTER TABLE locations DROP COLUMN country, DROP COLUMN zip;
