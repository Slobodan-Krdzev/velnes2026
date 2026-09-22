-- migrate:up

-- Personal sign-in links for the employee app (Alex, 2026-09-23).
--
-- An invited employee has no password yet and nothing to accept an
-- invite with. The owner mints a link in Settings › Team (it also
-- rides in the invite mail); opening it on the phone signs that one
-- person into their own salon, activates them and asks for a password
-- once. Only a sha256 of the token is stored; a link is single-use,
-- expires after seven days, and minting a new one revokes the old.
CREATE TABLE employee_sign_in_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES businesses(id),
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,   -- sha256; never the token itself
  created_by    uuid REFERENCES employees(id) ON DELETE SET NULL,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_sign_in_links_employee ON employee_sign_in_links (tenant_id, employee_id);
ALTER TABLE employee_sign_in_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_sign_in_links FORCE ROW LEVEL SECURITY;
-- Minted and revoked under tenant context.
CREATE POLICY tenant_isolation ON employee_sign_in_links
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
-- Redeeming is pre-tenant, like login: the token is the credential and
-- the lookup runs under the same narrow login mode.
CREATE POLICY auth_login_lookup ON employee_sign_in_links FOR SELECT
  USING (current_setting('app.auth', true) = 'login');

-- migrate:down
DROP TABLE employee_sign_in_links;
