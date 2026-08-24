-- migrate:up

-- Tenant plumbing: the RLS anchor and the restricted role the API
-- connects as. Migrations run as an admin role (needs CREATEROLE);
-- the API NEVER connects as the table owner, so RLS always applies.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app;

-- The per-request tenant. The API sets this with
--   SET LOCAL app.tenant_id = '<uuid>'
-- inside a transaction; every RLS policy compares against it.
-- current_setting(..., true) returns NULL when unset -> policies
-- match nothing, so "no tenant context" means "no rows", never leaks.
CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- Restricted login role for the API. Dev password; ops rotates it in
-- production with ALTER ROLE velnes_api PASSWORD '...'.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'velnes_api') THEN
    CREATE ROLE velnes_api LOGIN PASSWORD 'velnes_api';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public, app TO velnes_api;
GRANT EXECUTE ON FUNCTION app.current_tenant() TO velnes_api;

-- Future tables/sequences created by the migration role are usable by
-- the API without per-table grants (RLS still restricts the rows).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO velnes_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO velnes_api;

-- migrate:down

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM velnes_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM velnes_api;
REVOKE ALL ON SCHEMA public, app FROM velnes_api;
DROP FUNCTION IF EXISTS app.current_tenant();
DROP SCHEMA IF EXISTS app;
-- The role is intentionally kept (other databases may share it).
