-- migrate:up

-- Auth (credentials + rotating refresh tokens) and the audit log.
--
-- Auth is pre-tenant by nature: login starts from an email, before
-- any tenant context exists. The login lookup runs under an explicit
-- narrow mode (SET LOCAL app.auth = 'login') that unlocks SELECT on
-- employees + credentials for that transaction only — the one
-- deliberate, visible door through tenant isolation. Refresh tokens
-- carry their tenant and are looked up by hash.

CREATE TABLE user_credentials (
  employee_id   uuid PRIMARY KEY REFERENCES employees(id),
  tenant_id     uuid NOT NULL REFERENCES businesses(id),
  password_hash text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credentials FORCE ROW LEVEL SECURITY;
-- Written under tenant context (invites, password change); reads for
-- login use the explicit login mode below.
CREATE POLICY tenant_isolation ON user_credentials
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY auth_login_lookup ON user_credentials FOR SELECT
  USING (current_setting('app.auth', true) = 'login');
CREATE POLICY auth_login_lookup ON employees FOR SELECT
  USING (current_setting('app.auth', true) = 'login');

CREATE TABLE refresh_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES businesses(id),
  employee_id   uuid NOT NULL REFERENCES employees(id),
  token_hash    text NOT NULL UNIQUE,   -- sha256; never the token itself
  family_id     uuid NOT NULL,          -- rotation chain; reuse revokes family
  expires_at    timestamptz NOT NULL,
  rotated_at    timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family ON refresh_tokens (tenant_id, family_id);
-- Pre-tenant surface: the refresh call authenticates BY the token.
-- Possession of an unguessable 256-bit token hash is the credential,
-- so the API may look rows up without tenant context.
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY token_access ON refresh_tokens
  USING (true) WITH CHECK (true);

CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES businesses(id),
  ts            timestamptz NOT NULL DEFAULT now(),
  actor_employee_id uuid REFERENCES employees(id),
  actor_name    text NOT NULL,
  role_name     text NOT NULL DEFAULT '',
  business_name text NOT NULL DEFAULT '',
  location_name text NOT NULL DEFAULT '—',
  action        text NOT NULL,
  object        text NOT NULL,
  before        text NOT NULL DEFAULT '—',
  after         text NOT NULL DEFAULT '—',
  source        text NOT NULL DEFAULT '',
  reason        text NOT NULL DEFAULT ''
);
CREATE INDEX audit_log_tenant ON audit_log (tenant_id, ts DESC);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
-- Append + read within the tenant; no UPDATE/DELETE policies exist,
-- so audit rows are immutable for the API role.
CREATE POLICY tenant_read ON audit_log FOR SELECT
  USING (tenant_id = app.current_tenant());
CREATE POLICY tenant_append ON audit_log FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant());

-- migrate:down

DROP TABLE audit_log;
DROP POLICY auth_login_lookup ON employees;
DROP TABLE refresh_tokens;
DROP TABLE user_credentials;
