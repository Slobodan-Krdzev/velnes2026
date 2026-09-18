-- The fourth principal: client users — the ordinary people who book
-- through the consumer app. Unlike `customers`, which are per-tenant
-- rows a salon owns, a client user is platform-level: one person, one
-- email, one password, visible across every salon they visit.
--
-- The bridge is `client_customer_links`. Registering does NOT make
-- anybody a customer of any salon; BOOKING does. The first booking at a
-- salon creates (or adopts) that salon's own `customers` row and links
-- it, so the salon sees a real customer in its workspace while the
-- person keeps one account across the platform.
--
-- RLS: `app.client_id` is the client's own context (their row, their
-- links, their notifications, their appointments). `app.auth` gains the
-- 'client_login' mode — the narrow pre-session lookup by email, same
-- pattern the employee/HQ/supplier logins already use.

-- migrate:up

CREATE TABLE client_users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL,
  password_hash      text NOT NULL,
  first              text NOT NULL DEFAULT '',
  last               text NOT NULL DEFAULT '',
  phone              text,
  dob                date,
  lang               text NOT NULL DEFAULT 'en',
  avatar             text,
  -- Email verification: real SMTP is still a development task, so the
  -- code is generated and queued through mail_outbox (mock transport).
  -- The pending state is honest — a null verified_at cannot log in.
  email_verified_at  timestamptz,
  email_code         text,
  email_code_sent_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- Email is the sign-in identity: one account per address, case-folded.
CREATE UNIQUE INDEX client_users_email ON client_users (lower(email));

ALTER TABLE client_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_users FORCE ROW LEVEL SECURITY;
-- The client reads and edits their own row.
CREATE POLICY client_self ON client_users
  USING (id::text = current_setting('app.client_id', true))
  WITH CHECK (id::text = current_setting('app.client_id', true));
-- The narrow pre-session doors: register (insert) and login/verify
-- (lookup by email), nothing else.
CREATE POLICY client_signup ON client_users FOR INSERT
  WITH CHECK (current_setting('app.auth', true) = 'client_login');
CREATE POLICY client_login_lookup ON client_users FOR SELECT
  USING (current_setting('app.auth', true) = 'client_login');
CREATE POLICY client_login_verify ON client_users FOR UPDATE
  USING (current_setting('app.auth', true) = 'client_login')
  WITH CHECK (current_setting('app.auth', true) = 'client_login');
CREATE POLICY client_users_hq ON client_users
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

-- One person ↔ one salon's customer record. Created on first booking.
CREATE TABLE client_customer_links (
  client_user_id uuid NOT NULL REFERENCES client_users(id) ON DELETE CASCADE,
  tenant_id      uuid NOT NULL REFERENCES businesses(id),
  customer_id    uuid NOT NULL REFERENCES customers(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_user_id, tenant_id)
);
CREATE INDEX client_links_tenant ON client_customer_links (tenant_id, customer_id);

ALTER TABLE client_customer_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_customer_links FORCE ROW LEVEL SECURITY;
-- The salon sees the links into its own customers; the client sees
-- their own; the booking door (tenant context) creates them.
CREATE POLICY links_tenant ON client_customer_links
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY links_client ON client_customer_links FOR SELECT
  USING (client_user_id::text = current_setting('app.client_id', true));
CREATE POLICY links_hq ON client_customer_links
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

-- The client's own bell feed. Written by the salon side (tenant
-- context) when something happens to their appointment, and by the
-- client's own actions; read by the client.
CREATE TABLE client_notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id uuid NOT NULL REFERENCES client_users(id) ON DELETE CASCADE,
  kind           text NOT NULL,
  title          text NOT NULL,
  body           text NOT NULL DEFAULT '',
  -- Where a click should land: an appointment, the account, …
  ref_type       text,
  ref_id         text,
  read_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_notifications_feed
  ON client_notifications (client_user_id, created_at DESC);

ALTER TABLE client_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notif_client ON client_notifications
  USING (client_user_id::text = current_setting('app.client_id', true))
  WITH CHECK (client_user_id::text = current_setting('app.client_id', true));
-- A salon may notify a client it has an appointment with.
CREATE POLICY notif_tenant ON client_notifications FOR INSERT
  WITH CHECK (current_setting('app.tenant_id', true) IS NOT NULL);
CREATE POLICY notif_hq ON client_notifications
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

-- The verification email is platform mail (no tenant), written from the
-- narrow signup context — the same shape the supplier portal's own
-- invite mail uses.
CREATE POLICY client_signup_mail ON mail_outbox FOR INSERT
  WITH CHECK (current_setting('app.auth', true) = 'client_login' AND tenant_id IS NULL);

-- Notifications go both ways. The salon's own bell (platform_notices)
-- accepted only salon → HQ rings from a tenant context; a client
-- booking or cancelling is news the salon itself must hear, written
-- while we are already inside that salon's context.
CREATE POLICY tenant_ring_self ON platform_notices FOR INSERT
  WITH CHECK (audience = 'salons' AND tenant_id = app.current_tenant());

-- An appointment remembers which client account booked it, so "my
-- appointments" is one query across every salon instead of a join
-- through per-tenant customers.
ALTER TABLE appointments ADD COLUMN client_user_id uuid REFERENCES client_users(id);
CREATE INDEX appointments_client ON appointments (client_user_id, date DESC);
-- The client reads their own appointments across tenants — read-only:
-- every write still goes through the salon's own doors.
CREATE POLICY client_own_appointments ON appointments FOR SELECT
  USING (client_user_id::text = current_setting('app.client_id', true));

-- migrate:down

DROP POLICY tenant_ring_self ON platform_notices;
DROP POLICY client_signup_mail ON mail_outbox;
DROP POLICY client_own_appointments ON appointments;
DROP INDEX appointments_client;
ALTER TABLE appointments DROP COLUMN client_user_id;
DROP TABLE client_notifications;
DROP TABLE client_customer_links;
DROP TABLE client_users;
