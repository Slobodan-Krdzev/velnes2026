-- Quiet-time bonus (Alex, 2026-10-05) — docs/LOYALTY.md "Quiet slots".
--
-- A salon's quiet times, as the algorithm finds them: per location, per
-- weekday-and-start pair, how many of the last weeks the location was
-- open at that time and how many of those it was booked. The nightly
-- recompute rewrites a location's rows whole; the availability doors
-- read them and mark a free start with the bonus the platform pays
-- when a Velnes-app customer books it. Only locations with enough
-- history qualify (the run says so) — a young salon gets no tags.
--
-- The promise travels on the appointment (`quiet_bonus`), stamped at
-- booking from the pairs published that night, so a slot that stops
-- being quiet later still pays and one that becomes quiet later does
-- not. Any move of the visit clears it (Alex: no points after a
-- reschedule).

-- migrate:up

CREATE TABLE location_quiet_runs (
  tenant_id      uuid NOT NULL,
  location_id    uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  -- Completed visits in the location's whole history, the entry test.
  completed      integer NOT NULL,
  qualified      boolean NOT NULL,
  -- Pairs with enough open weeks to be judged, and the location's own
  -- fill rate over the window — what a quiet pair is measured against.
  open_pairs     integer NOT NULL,
  location_fill  numeric(6,4) NOT NULL,
  quiet_count    integer NOT NULL,
  PRIMARY KEY (tenant_id, location_id)
);
ALTER TABLE location_quiet_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_quiet_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON location_quiet_runs
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY hq_all ON location_quiet_runs
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

CREATE TABLE location_quiet_slots (
  tenant_id     uuid NOT NULL,
  location_id   uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  -- 0 = Monday … 6 = Sunday, the prototype's week.
  weekday       smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_min     integer NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  open_weeks    integer NOT NULL,
  booked_weeks  integer NOT NULL,
  fill          numeric(6,4) NOT NULL,
  PRIMARY KEY (tenant_id, location_id, weekday, start_min)
);
ALTER TABLE location_quiet_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_quiet_slots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON location_quiet_slots
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY hq_all ON location_quiet_slots
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

-- The bonus promised at booking; 0 for every visit that had none.
ALTER TABLE appointments ADD COLUMN quiet_bonus integer NOT NULL DEFAULT 0;

-- migrate:down

ALTER TABLE appointments DROP COLUMN quiet_bonus;
DROP TABLE location_quiet_slots;
DROP TABLE location_quiet_runs;
