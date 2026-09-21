-- Placeholder pins, at Alex's request (2026-09-19): the salons that
-- never went through the registration wizard have no coordinates, so
-- the consumer app's maps had nothing to draw for them.
--
-- These are DUMMY coordinates — a city centre plus a small spread so
-- the pins don't stack — not surveyed addresses. Each salon lands in
-- its own city rather than all in Skopje, because putting an Ohrid spa
-- on a Skopje street would be a wronger lie than a rough one; Skopje is
-- the fallback when the city is unknown. Any salon can correct its own
-- pin from Settings › Locations, and every future registration captures
-- a precise one.

-- migrate:up

UPDATE locations l
SET lat = c.lat + ((('x' || substr(md5(l.id::text), 1, 4))::bit(16)::int % 100) - 50) * 0.0004,
    lng = c.lng + ((('x' || substr(md5(l.id::text), 5, 4))::bit(16)::int % 100) - 50) * 0.0005
FROM (
  VALUES
    ('Skopje',        41.9981, 21.4254),
    ('Bitola',        41.0314, 21.3347),
    ('Ohrid',         41.1231, 20.8016),
    ('Prishtina',     42.6629, 21.1655),
    ('Pristina',      42.6629, 21.1655),
    ('Thessaloniki',  40.6401, 22.9444)
) AS c(city, lat, lng)
WHERE l.lat IS NULL
  AND c.city = coalesce(l.city, 'Skopje');

-- Anything left (an unknown or empty city) sits in central Skopje.
UPDATE locations l
SET lat = 41.9981 + ((('x' || substr(md5(l.id::text), 1, 4))::bit(16)::int % 100) - 50) * 0.0004,
    lng = 21.4254 + ((('x' || substr(md5(l.id::text), 5, 4))::bit(16)::int % 100) - 50) * 0.0005
WHERE l.lat IS NULL;

-- migrate:down

-- Only the placeholders go: a pin someone actually placed is theirs.
-- Registration-drafted pins are recoverable from registrations.draft,
-- so this clears every location that has no such draft.
UPDATE locations l
SET lat = NULL, lng = NULL
WHERE NOT EXISTS (
  SELECT 1 FROM registrations r
  WHERE r.business_id = l.tenant_id
    AND r.draft -> 'loc' ->> 'lat' IS NOT NULL
);
