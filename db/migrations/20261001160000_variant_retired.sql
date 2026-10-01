-- A duration that was ever booked cannot be deleted (Alex, 2026-10-01:
-- removing one in the panel failed — appointments, personal offers and
-- measured pace reference it). It is RETIRED instead: gone from the
-- catalog, the booking page and the till; still there for the visits
-- that carry it. A duration nothing references is deleted as before.

-- migrate:up

ALTER TABLE service_variants ADD COLUMN retired_at timestamptz;

-- migrate:down

ALTER TABLE service_variants DROP COLUMN retired_at;
