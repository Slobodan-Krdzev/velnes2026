-- Locations get their real coordinates. The pin already exists: every
-- salon drops one on a real map during registration (RegistrationDraft
-- loc.lat/lng, the Leaflet step in the workspace wizard) — approval used
-- to throw it away and keep only the street text. The consumer app
-- renders real maps, so the pin becomes a first-class column and the
-- backfill recovers the ones already dropped.
--
-- Address text and pin are deliberately separate: the salon's written
-- address is what we print, the pin is where the map puts it. When they
-- disagree, the pin is the truth on the map (salons place it exactly).

-- migrate:up
ALTER TABLE locations ADD COLUMN lat double precision;
ALTER TABLE locations ADD COLUMN lng double precision;

-- Recover the pins from live registrations: match a registration to
-- the business it became, then to that business's location whose address
-- matches the drafted street (a business registers with one location).
UPDATE locations l
SET lat = (r.draft -> 'loc' ->> 'lat')::double precision,
    lng = (r.draft -> 'loc' ->> 'lng')::double precision
FROM registrations r
WHERE r.business_id = l.tenant_id
  AND r.status = 'active'
  AND r.draft -> 'loc' ->> 'lat' IS NOT NULL
  AND l.lat IS NULL;

-- migrate:down
ALTER TABLE locations DROP COLUMN lng;
ALTER TABLE locations DROP COLUMN lat;
