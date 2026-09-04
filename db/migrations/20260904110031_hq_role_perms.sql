-- migrate:up

-- HQ roles carry their permission scopes (the prototype's
-- HQ_PERM_GROUPS × none/read/write), so the role drawer can show and
-- edit what each role may reach instead of a bare access badge.
ALTER TABLE hq_roles ADD COLUMN perms jsonb NOT NULL DEFAULT '{}';

-- The prototype's seedHqRolePerms matrix, verbatim.
UPDATE hq_roles SET perms = v.perms::jsonb FROM (VALUES
  ('hq_super',   '{"hq.customers":"write","hq.enter":"write","hq.suppliers":"write","hq.finance":"write","hq.settings":"write","hq.team":"write","hq.audit":"write"}'),
  ('hq_onboard', '{"hq.customers":"write","hq.enter":"write","hq.suppliers":"read","hq.finance":"none","hq.settings":"none","hq.team":"none","hq.audit":"none"}'),
  ('hq_support', '{"hq.customers":"read","hq.enter":"read","hq.suppliers":"none","hq.finance":"none","hq.settings":"none","hq.team":"none","hq.audit":"read"}'),
  ('hq_tech',    '{"hq.customers":"read","hq.enter":"read","hq.suppliers":"none","hq.finance":"none","hq.settings":"write","hq.team":"none","hq.audit":"read"}'),
  ('hq_finance', '{"hq.customers":"read","hq.enter":"none","hq.suppliers":"none","hq.finance":"write","hq.settings":"none","hq.team":"none","hq.audit":"read"}'),
  ('hq_audit',   '{"hq.customers":"read","hq.enter":"none","hq.suppliers":"none","hq.finance":"read","hq.settings":"read","hq.team":"none","hq.audit":"read"}')
) AS v(id, perms) WHERE hq_roles.id = v.id;

-- migrate:down

ALTER TABLE hq_roles DROP COLUMN perms;
