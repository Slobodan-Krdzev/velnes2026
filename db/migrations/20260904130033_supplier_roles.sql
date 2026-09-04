-- migrate:up

-- The supplier portal's own role kit — its own permission scopes
-- (PO_PERM_GROUPS × none/own/all), mirroring the HQ role table. The
-- portal Settings tab reads and edits these; supplier_users.role
-- points at a row here.
CREATE TABLE supplier_roles (
  id       text PRIMARY KEY,
  name     text NOT NULL,
  scope    text NOT NULL DEFAULT '',
  perms    jsonb NOT NULL DEFAULT '{}',
  std      boolean NOT NULL DEFAULT false,
  locked   boolean NOT NULL DEFAULT false
);
ALTER TABLE supplier_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_roles FORCE ROW LEVEL SECURITY;
-- Readable in supplier context (Settings) and by HQ; only HQ or the
-- portal's own owner writes (the API gates create/edit by po.users).
CREATE POLICY supplier_read ON supplier_roles FOR SELECT
  USING (current_setting('app.supplier_id', true) IS NOT NULL);
CREATE POLICY supplier_write ON supplier_roles
  USING (current_setting('app.supplier_id', true) IS NOT NULL)
  WITH CHECK (current_setting('app.supplier_id', true) IS NOT NULL);
CREATE POLICY hq_all ON supplier_roles
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

-- The prototype's supplierRoles + seedPortalRolePerms matrix, verbatim.
INSERT INTO supplier_roles (id, name, scope, std, locked, perms) VALUES
  ('sr_owner','Supplier Owner','Everything, including users and commercial terms',true,true,
   '{"po.catalog":"all","po.promotions":"all","po.terms":"all","po.salons":"all","po.orders":"all","po.disputes":"all","po.academy":"all","po.reports":"all","po.users":"all"}'),
  ('sr_account','Account Manager','Own salons: orders, promotions and contact',true,false,
   '{"po.catalog":"none","po.promotions":"own","po.terms":"none","po.salons":"own","po.orders":"own","po.disputes":"none","po.academy":"none","po.reports":"own","po.users":"none"}'),
  ('sr_catalog','Catalog Manager','Products, prices and availability. No customer data',true,false,
   '{"po.catalog":"all","po.promotions":"none","po.terms":"none","po.salons":"none","po.orders":"none","po.disputes":"none","po.academy":"none","po.reports":"all","po.users":"none"}'),
  ('sr_order','Order Manager','Orders, shipping and disputes for every salon',true,false,
   '{"po.catalog":"none","po.promotions":"none","po.terms":"none","po.salons":"all","po.orders":"all","po.disputes":"all","po.academy":"none","po.reports":"none","po.users":"none"}'),
  ('sr_trainer','Trainer','Training events and registrations only',true,false,
   '{"po.catalog":"none","po.promotions":"none","po.terms":"none","po.salons":"all","po.orders":"none","po.disputes":"none","po.academy":"all","po.reports":"none","po.users":"none"}'),
  ('sr_finance','Finance','Invoices, credit notes and payment terms',true,false,
   '{"po.catalog":"none","po.promotions":"none","po.terms":"all","po.salons":"none","po.orders":"none","po.disputes":"all","po.academy":"none","po.reports":"all","po.users":"none"}'),
  ('sr_analyst','Analyst','Read-only reporting, no salon contact details',true,false,
   '{"po.catalog":"none","po.promotions":"none","po.terms":"none","po.salons":"none","po.orders":"none","po.disputes":"none","po.academy":"none","po.reports":"all","po.users":"none"}');

-- A portal teammate can be invited before they can sign in.
ALTER TABLE supplier_users DROP CONSTRAINT supplier_users_status_check;
ALTER TABLE supplier_users ADD CONSTRAINT supplier_users_status_check
  CHECK (status IN ('active','invited','disabled'));

-- Bind the role to the kit (every seeded role id exists above).
ALTER TABLE supplier_users
  ADD CONSTRAINT supplier_users_role_fkey FOREIGN KEY (role) REFERENCES supplier_roles(id);

-- migrate:down

ALTER TABLE supplier_users DROP CONSTRAINT supplier_users_role_fkey;
ALTER TABLE supplier_users DROP CONSTRAINT supplier_users_status_check;
ALTER TABLE supplier_users ADD CONSTRAINT supplier_users_status_check
  CHECK (status IN ('active','disabled'));
DROP TABLE supplier_roles;
