-- migrate:up

-- The timing engine's records: one pace/duration statement per
-- (employee, service, variant, location) — variant/location NULL
-- means "any". approvedMin is the working value the owner set;
-- Velnes keeps watching and re-proposes, but never writes it itself.

CREATE TYPE timing_status AS ENUM ('none','suggested','approved','dismissed');

CREATE TABLE emp_timings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES businesses(id),
  employee_id   uuid NOT NULL REFERENCES employees(id),
  service_id    uuid NOT NULL REFERENCES services(id),
  variant_id    uuid REFERENCES service_variants(id),
  location_id   uuid REFERENCES locations(id),
  observed_n    integer NOT NULL DEFAULT 0,
  observed_median_min integer,
  pace_factor   numeric(5,2),
  window_from   date,
  window_to     date,
  computed_at   date,
  recommended_min integer,
  status        timing_status NOT NULL DEFAULT 'none',
  dismissed_at_n integer NOT NULL DEFAULT 0,
  approved_min  integer,
  approved_by   text,
  approved_at   date,
  source        text NOT NULL DEFAULT 'observed',
  UNIQUE NULLS NOT DISTINCT (tenant_id, employee_id, service_id, variant_id, location_id)
);
CREATE INDEX emp_timings_tenant ON emp_timings (tenant_id, status);
ALTER TABLE emp_timings ENABLE ROW LEVEL SECURITY;
ALTER TABLE emp_timings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON emp_timings
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

-- migrate:down

DROP TABLE emp_timings;
DROP TYPE timing_status;
