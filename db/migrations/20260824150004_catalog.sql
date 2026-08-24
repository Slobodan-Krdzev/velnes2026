-- migrate:up

-- Catalog: one master item per service (identity + shared content),
-- one per-location row with the commercial/operational values.
-- Never two records for the same "Rehab training".

CREATE TYPE service_status AS ENUM ('active','draft');
CREATE TYPE modifier_group_type AS ENUM ('single','multi');

CREATE TABLE service_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES businesses(id),
  name        text NOT NULL,
  parent_id   uuid REFERENCES service_categories(id),  -- reserved: tree
  sort        integer NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, name)
);
CREATE INDEX service_categories_tenant ON service_categories (tenant_id, sort);
ALTER TABLE service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON service_categories
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE services (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES businesses(id),
  name         text NOT NULL,
  category_id  uuid REFERENCES service_categories(id),
  duration_min integer NOT NULL,
  price        integer NOT NULL,           -- whole MKD denars, as the prototype
  vat          integer NOT NULL DEFAULT 18,
  status       service_status NOT NULL DEFAULT 'active',
  pos          boolean NOT NULL DEFAULT true,
  online       boolean NOT NULL DEFAULT true,
  prep_min     integer,                    -- NULL = default (0)
  reset_min    integer,                    -- NULL = default (10)
  sort         integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX services_tenant ON services (tenant_id, status, sort);
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE services FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON services
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE service_variants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES businesses(id),
  service_id   uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  label        text NOT NULL,
  duration_min integer NOT NULL,
  price        integer NOT NULL,
  std          boolean NOT NULL DEFAULT false,   -- the default choice
  sort         integer NOT NULL DEFAULT 0
);
CREATE INDEX service_variants_tenant ON service_variants (tenant_id, service_id, sort);
ALTER TABLE service_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_variants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON service_variants
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE service_modifier_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES businesses(id),
  service_id  uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name        text NOT NULL,
  type        modifier_group_type NOT NULL DEFAULT 'single',
  required    boolean NOT NULL DEFAULT false,
  sort        integer NOT NULL DEFAULT 0
);
CREATE INDEX service_modifier_groups_tenant ON service_modifier_groups (tenant_id, service_id, sort);
ALTER TABLE service_modifier_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_modifier_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON service_modifier_groups
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE service_modifier_options (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES businesses(id),
  group_id     uuid NOT NULL REFERENCES service_modifier_groups(id) ON DELETE CASCADE,
  name         text NOT NULL,
  price        integer NOT NULL DEFAULT 0,     -- may be negative (discount option)
  duration_min integer NOT NULL DEFAULT 0,
  sort         integer NOT NULL DEFAULT 0
);
CREATE INDEX service_modifier_options_tenant ON service_modifier_options (tenant_id, group_id, sort);
ALTER TABLE service_modifier_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_modifier_options FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON service_modifier_options
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE location_catalog_services (
  tenant_id    uuid NOT NULL REFERENCES businesses(id),
  location_id  uuid NOT NULL REFERENCES locations(id),
  service_id   uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  active       boolean NOT NULL DEFAULT true,
  price        integer NOT NULL,
  duration_min integer NOT NULL,
  online       boolean NOT NULL DEFAULT true,
  pos          boolean NOT NULL DEFAULT true,
  prep_min     integer,     -- NULL = inherit master
  reset_min    integer,     -- NULL = inherit master
  PRIMARY KEY (location_id, service_id)
);
CREATE INDEX location_catalog_services_tenant ON location_catalog_services (tenant_id, location_id, active);
ALTER TABLE location_catalog_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_catalog_services FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON location_catalog_services
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE location_catalog_variants (
  tenant_id    uuid NOT NULL REFERENCES businesses(id),
  location_id  uuid NOT NULL REFERENCES locations(id),
  variant_id   uuid NOT NULL REFERENCES service_variants(id) ON DELETE CASCADE,
  active       boolean NOT NULL DEFAULT true,
  price        integer,     -- NULL = inherit master variant
  duration_min integer,     -- NULL = inherit master variant
  PRIMARY KEY (location_id, variant_id)
);
CREATE INDEX location_catalog_variants_tenant ON location_catalog_variants (tenant_id, location_id);
ALTER TABLE location_catalog_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_catalog_variants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON location_catalog_variants
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE employee_skills (
  tenant_id    uuid NOT NULL REFERENCES businesses(id),
  employee_id  uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  service_id   uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, service_id)
);
CREATE INDEX employee_skills_tenant ON employee_skills (tenant_id, service_id);
ALTER TABLE employee_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_skills FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_skills
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

-- migrate:down

DROP TABLE employee_skills;
DROP TABLE location_catalog_variants;
DROP TABLE location_catalog_services;
DROP TABLE service_modifier_options;
DROP TABLE service_modifier_groups;
DROP TABLE service_variants;
DROP TABLE services;
DROP TABLE service_categories;
DROP TYPE modifier_group_type;
DROP TYPE service_status;
