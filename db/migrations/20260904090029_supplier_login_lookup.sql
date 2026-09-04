-- migrate:up

-- The portal login joins supplier_users to suppliers before any
-- supplier context exists; supplier_users already has its login-mode
-- policy, but suppliers did not, so RLS emptied the join and every
-- portal sign-in was refused. Mirror the auth_login_lookup pattern.
CREATE POLICY supplier_login_lookup ON suppliers FOR SELECT
  USING (current_setting('app.auth', true) = 'login');

-- migrate:down

DROP POLICY supplier_login_lookup ON suppliers;
