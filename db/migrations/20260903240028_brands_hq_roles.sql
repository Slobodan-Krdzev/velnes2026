-- migrate:up

-- Brand, supplier and distributor are three different things, on
-- purpose (prototype). Brands are platform rows; supplier_brands
-- says who carries what.
CREATE TABLE brands (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name     text NOT NULL UNIQUE,
  owner    text NOT NULL DEFAULT '',
  country  text NOT NULL DEFAULT ''
);
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands FORCE ROW LEVEL SECURITY;
CREATE POLICY read_all ON brands FOR SELECT USING (true);
CREATE POLICY hq_write ON brands
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

CREATE TABLE supplier_brands (
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  brand_id    uuid NOT NULL REFERENCES brands(id),
  PRIMARY KEY (supplier_id, brand_id)
);
ALTER TABLE supplier_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_brands FORCE ROW LEVEL SECURITY;
CREATE POLICY read_all ON supplier_brands FOR SELECT USING (true);
CREATE POLICY hq_write ON supplier_brands
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

INSERT INTO brands (name, owner, country) VALUES
  ('Thera-Band', 'Performance Health', 'United States'),
  ('CureTape', 'Fysiotape BV', 'Netherlands'),
  ('Nordic Recovery', 'Nordic Recovery AB', 'Sweden'),
  ('OrthoPro', 'OrthoPro d.o.o.', 'Serbia')
ON CONFLICT (name) DO NOTHING;

-- The HQ role kit: the prototype's six standard roles as rows, and
-- room for custom ones. hq_users.role points here instead of a
-- hard-coded check.
CREATE TABLE hq_roles (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  descr           text NOT NULL DEFAULT '',
  customer_access text NOT NULL DEFAULT 'none' CHECK (customer_access IN ('write','read','none')),
  std             boolean NOT NULL DEFAULT false,
  locked          boolean NOT NULL DEFAULT false,
  sensitive       boolean NOT NULL DEFAULT false
);
ALTER TABLE hq_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE hq_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY hq_all ON hq_roles
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

INSERT INTO hq_roles (id, name, descr, customer_access, std, locked, sensitive) VALUES
  ('hq_super', 'HQ Super Admin', 'Everything in HQ, including platform settings and HQ users.', 'write', true, true, true),
  ('hq_onboard', 'Onboarding Specialist', 'Creates businesses and first locations, invites owners, helps with catalog imports.', 'write', true, false, false),
  ('hq_support', 'Support Agent', 'Answers customer questions. Opens a customer environment read-only.', 'read', true, false, false),
  ('hq_tech', 'Technical Support', 'Integrations, widget keys, synchronisation errors.', 'read', true, false, false),
  ('hq_finance', 'Finance Support', 'Invoices, payouts and platform fees. No calendar or customer data.', 'none', true, false, true),
  ('hq_audit', 'Read-only Auditor', 'Reads logs and configuration. Changes nothing, anywhere.', 'read', true, false, false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE hq_users DROP CONSTRAINT hq_users_role_check;
ALTER TABLE hq_users
  ADD CONSTRAINT hq_users_role_fkey FOREIGN KEY (role) REFERENCES hq_roles(id);

-- migrate:down

ALTER TABLE hq_users DROP CONSTRAINT hq_users_role_fkey;
ALTER TABLE hq_users ADD CONSTRAINT hq_users_role_check
  CHECK (role IN ('hq_super','hq_onboard','hq_support','hq_tech','hq_audit'));
DROP TABLE hq_roles;
DROP TABLE supplier_brands;
DROP TABLE brands;
