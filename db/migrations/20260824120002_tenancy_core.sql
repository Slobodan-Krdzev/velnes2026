-- migrate:up

-- Tenancy core: businesses (tenant root), locations with a real
-- lifecycle, legal entities + payment accounts, employees, roles.
-- Every tenant table: tenant_id NOT NULL, RLS forced in the same
-- migration, every index starts with tenant_id.

CREATE TYPE location_lifecycle AS ENUM (
  'DRAFT','SUBMITTED','UNDER_REVIEW','CHANGES_REQUIRED',
  'RESUBMITTED','APPROVED','ACTIVE','SUSPENDED','CLOSED');
CREATE TYPE legal_entity_owner AS ENUM ('salon','supplier');
CREATE TYPE legal_entity_status AS ENUM ('pending','verified');
CREATE TYPE payment_account_status AS ENUM ('active','incomplete');
CREATE TYPE employee_access AS ENUM ('owner','manager','staff','desk');
CREATE TYPE employee_status AS ENUM ('active','invited');

CREATE TABLE businesses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  country       text NOT NULL,
  vat           text,
  plan          text NOT NULL DEFAULT 'Business',
  since         date,
  owner_employee_id uuid,           -- FK added after employees exists
  timing_enabled boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON businesses
  USING (id = app.current_tenant())
  WITH CHECK (id = app.current_tenant());

CREATE TABLE roles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES businesses(id),
  name          text NOT NULL,
  std           boolean NOT NULL DEFAULT false,
  locked        boolean NOT NULL DEFAULT false,
  base_role_id  uuid REFERENCES roles(id),
  description   text NOT NULL DEFAULT '',
  perms         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON roles
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE employees (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES businesses(id),
  name          text NOT NULL,
  role_title    text NOT NULL DEFAULT '',
  email         text NOT NULL,
  phone         text,
  access        employee_access NOT NULL DEFAULT 'staff',
  role_id       uuid REFERENCES roles(id),
  bookable      boolean NOT NULL DEFAULT false,
  status        employee_status NOT NULL DEFAULT 'invited',
  twofa_enabled boolean NOT NULL DEFAULT false,  -- reserved; 2FA not built
  color         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Global uniqueness: login is by email alone, so it must be
-- unambiguous across tenants.
CREATE UNIQUE INDEX employees_email_global ON employees (lower(email));
CREATE INDEX employees_tenant ON employees (tenant_id, status);
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employees
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

ALTER TABLE businesses
  ADD CONSTRAINT businesses_owner_fk
  FOREIGN KEY (owner_employee_id) REFERENCES employees(id);

CREATE TABLE locations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES businesses(id),
  name          text NOT NULL,
  city          text,
  address       text,
  tz            text NOT NULL DEFAULT 'Europe/Skopje',
  phone         text,
  rooms         integer NOT NULL DEFAULT 1,
  inv_prefix    text,
  online        boolean NOT NULL DEFAULT false,
  cancel_hours  integer NOT NULL DEFAULT 24,
  opened        date,
  hours         jsonb,                    -- weekly hours; NULL = not set
  payments      jsonb,                    -- {cash,card,online,rounding,tip}
  lifecycle     location_lifecycle NOT NULL DEFAULT 'DRAFT',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX locations_tenant ON locations (tenant_id, lifecycle);
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON locations
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE location_lifecycle_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES businesses(id),
  location_id   uuid NOT NULL REFERENCES locations(id),
  from_state    location_lifecycle NOT NULL,
  to_state      location_lifecycle NOT NULL,
  actor_employee_id uuid REFERENCES employees(id),
  reason        text,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX loc_lifecycle_log_tenant ON location_lifecycle_log (tenant_id, location_id, at);
ALTER TABLE location_lifecycle_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_lifecycle_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON location_lifecycle_log
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE employee_locations (
  tenant_id     uuid NOT NULL REFERENCES businesses(id),
  employee_id   uuid NOT NULL REFERENCES employees(id),
  location_id   uuid NOT NULL REFERENCES locations(id),
  PRIMARY KEY (employee_id, location_id)
);
CREATE INDEX employee_locations_tenant ON employee_locations (tenant_id, location_id);
ALTER TABLE employee_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_locations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_locations
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

-- Legal entities: salon-owned entities belong to a tenant.
-- Supplier-owned entities (Phase 10) are platform-level: tenant_id is
-- NULL and they are readable by every tenant (checkout routing needs
-- the seller entity), writable by none but HQ/supplier surfaces later.
CREATE TABLE legal_entities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES businesses(id),
  owner_type    legal_entity_owner NOT NULL,
  owner_id      uuid,
  is_default    boolean NOT NULL DEFAULT false,
  name          text NOT NULL,
  tax_id        text,
  vat_reg       text,
  currency      text NOT NULL DEFAULT 'MKD',
  status        legal_entity_status NOT NULL DEFAULT 'pending',
  fiscal_profile_id text,             -- reserved; fiscalization undecided
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT salon_entities_have_tenant
    CHECK (owner_type <> 'salon' OR tenant_id IS NOT NULL)
);
CREATE INDEX legal_entities_tenant ON legal_entities (tenant_id, status);
ALTER TABLE legal_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_entities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_entities
  USING (tenant_id = app.current_tenant() OR tenant_id IS NULL)
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE legal_entity_locations (
  tenant_id     uuid NOT NULL REFERENCES businesses(id),
  legal_entity_id uuid NOT NULL REFERENCES legal_entities(id),
  location_id   uuid NOT NULL REFERENCES locations(id),
  PRIMARY KEY (legal_entity_id, location_id)
);
CREATE INDEX legal_entity_locations_tenant ON legal_entity_locations (tenant_id, location_id);
ALTER TABLE legal_entity_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_entity_locations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON legal_entity_locations
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE payment_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES businesses(id),  -- NULL = platform-level (supplier)
  legal_entity_id uuid NOT NULL REFERENCES legal_entities(id),
  provider      text,                 -- honest emptiness: NULL until chosen
  merchant_id   text,
  settlement_ref text,
  status        payment_account_status NOT NULL DEFAULT 'incomplete',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_accounts_tenant ON payment_accounts (tenant_id, legal_entity_id);
ALTER TABLE payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_accounts
  USING (tenant_id = app.current_tenant() OR tenant_id IS NULL)
  WITH CHECK (tenant_id = app.current_tenant());

-- migrate:down

DROP TABLE payment_accounts;
DROP TABLE legal_entity_locations;
DROP TABLE legal_entities;
DROP TABLE employee_locations;
DROP TABLE location_lifecycle_log;
DROP TABLE locations;
ALTER TABLE businesses DROP CONSTRAINT businesses_owner_fk;
DROP TABLE employees;
DROP TABLE roles;
DROP TABLE businesses;
DROP TYPE employee_status;
DROP TYPE employee_access;
DROP TYPE payment_account_status;
DROP TYPE legal_entity_status;
DROP TYPE legal_entity_owner;
DROP TYPE location_lifecycle;
