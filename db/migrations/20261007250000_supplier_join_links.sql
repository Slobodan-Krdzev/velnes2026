-- migrate:up

-- Supplier join links (Alex, 2026-10-07).
--
-- An invited supplier user — HQ's bootstrap owner or a team member the
-- supplier invited — had no password and no door to set one: the invite
-- mail led to the plain login page. Now every invite carries a personal
-- link; opening it shows who is invited and asks for a password (and,
-- for the first owner, the company details) before signing them in.
-- Mirrors employee_sign_in_links: only a sha256 of the token is stored,
-- a link is single-use, expires after seven days, and minting again
-- revokes the old one.
CREATE TABLE supplier_join_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id       uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_user_id  uuid NOT NULL REFERENCES supplier_users(id) ON DELETE CASCADE,
  token_hash        text NOT NULL UNIQUE,   -- sha256; never the token itself
  created_by        text NOT NULL DEFAULT '',  -- 'hq' or the inviting supplier user's id
  expires_at        timestamptz NOT NULL,
  used_at           timestamptz,
  revoked_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX supplier_join_links_user ON supplier_join_links (supplier_id, supplier_user_id);
ALTER TABLE supplier_join_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_join_links FORCE ROW LEVEL SECURITY;
-- The supplier mints and revokes for its own team; the claim's writes
-- run under the link's own supplier context.
CREATE POLICY supplier_own ON supplier_join_links
  USING (supplier_id::text = current_setting('app.supplier_id', true))
  WITH CHECK (supplier_id::text = current_setting('app.supplier_id', true));
-- HQ mints (and re-mints) the bootstrap owner's link.
CREATE POLICY hq_bootstrap ON supplier_join_links
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');
-- Redeeming is pre-supplier, like login: the token is the credential.
CREATE POLICY auth_login_lookup ON supplier_join_links FOR SELECT
  USING (current_setting('app.auth', true) = 'login');

-- HQ may correct the name/email of a bootstrap owner nobody has claimed yet.
CREATE POLICY hq_bootstrap_update ON supplier_users FOR UPDATE
  USING (current_setting('app.hq', true) = '1' AND status = 'invited')
  WITH CHECK (current_setting('app.hq', true) = '1' AND status = 'invited');

-- migrate:down
DROP POLICY hq_bootstrap_update ON supplier_users;
DROP TABLE supplier_join_links;
