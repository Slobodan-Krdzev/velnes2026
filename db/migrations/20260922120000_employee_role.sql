-- migrate:up

-- Every tenant is born with two roles: Owner and a basic Employee who
-- books appointments and takes payments at their own location, and
-- nothing else (Alex, 2026-09-22). The perm map mirrors
-- STANDARD_ROLES.employee in @velnes/contracts — every key spelled
-- out, so "missing" never has to mean "none".
CREATE TEMP TABLE employee_kit AS SELECT '{
  "appointments.view_own": "own",
  "appointments.view_location": "none",
  "appointments.create": "location",
  "appointments.edit": "location",
  "appointments.cancel": "location",
  "customers.view_assigned": "none",
  "customers.view_location": "none",
  "customers.view_business": "none",
  "customers.edit": "none",
  "customers.export": "none",
  "pos.checkout": "location",
  "pos.discount": "none",
  "pos.refund": "none",
  "pos.view_invoices": "none",
  "cash_drawer.close": "none",
  "payments.manage": "none",
  "catalog.view": "none",
  "catalog.edit": "none",
  "inventory.view": "none",
  "inventory.adjust": "none",
  "inventory.transfer": "none",
  "suppliers.manage": "none",
  "marketing.personal_offers": "none",
  "reports.view_own": "none",
  "reports.view_location": "none",
  "reports.view_business": "none",
  "users.manage": "none",
  "roles.manage": "none",
  "locations.manage": "none",
  "integrations.manage": "none",
  "widget.manage": "none",
  "ranking.manage": "none"
}'::jsonb AS perms;

-- Tenants created before the kit existed get their Employee role here.
INSERT INTO roles (tenant_id, name, std, locked, description, perms)
SELECT b.id, 'Employee', true, false,
       'Books appointments and runs the till at their location. Nothing else.',
       (SELECT perms FROM employee_kit)
FROM businesses b
WHERE NOT EXISTS (
  SELECT 1 FROM roles r WHERE r.tenant_id = b.id AND r.name = 'Employee'
);

-- A standard Employee role that already existed is reset to the basic
-- kit — "anything other must be removed for the normal employee". It
-- stays unlocked: an owner who wants more for their staff edits it, or
-- creates a role of their own. Custom roles are not touched.
UPDATE roles
SET perms = (SELECT perms FROM employee_kit),
    description = 'Books appointments and runs the till at their location. Nothing else.'
WHERE name = 'Employee' AND std = true;

DROP TABLE employee_kit;

-- migrate:down

DELETE FROM roles
WHERE name = 'Employee' AND std = true
  AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.role_id = roles.id);
