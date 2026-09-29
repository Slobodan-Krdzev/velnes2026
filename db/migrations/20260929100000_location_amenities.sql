-- migrate:up

-- Amenities: the facilities a customer can expect at a LOCATION (Alex,
-- 2026-09-29). One row per (location, key); the vocabulary of keys lives
-- in @velnes/contracts, validated at every door, so no definitions table
-- and no boolean columns. A location with no rows is the normal state.
CREATE TABLE location_amenities (
  tenant_id    uuid NOT NULL REFERENCES businesses(id),
  location_id  uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  key          text NOT NULL,
  PRIMARY KEY (tenant_id, location_id, key)
);
CREATE INDEX location_amenities_key ON location_amenities (tenant_id, key);
ALTER TABLE location_amenities ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_amenities FORCE ROW LEVEL SECURITY;
-- The tenant's own, like locations; HQ reads across tenants as it does
-- locations. Public surfaces read under the tenant's own context.
CREATE POLICY tenant_isolation ON location_amenities
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY hq_read ON location_amenities FOR SELECT
  USING (current_setting('app.hq', true) = '1');

-- migrate:down

DROP TABLE location_amenities;
