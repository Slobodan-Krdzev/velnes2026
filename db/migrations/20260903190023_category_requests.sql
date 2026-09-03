-- migrate:up

-- A salon cannot invent a Velnes category, but it can ASK for one
-- (Alex, 2026-09-03). The request is a row with a lifecycle: pending
-- → approved/declined. HQ's queue is the notification surface, like
-- the registrations intake.
CREATE TABLE category_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES businesses(id),
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('services','products')),
  note        text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  hq_reason   text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
CREATE INDEX category_requests_tenant ON category_requests (tenant_id, created_at);
ALTER TABLE category_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_own ON category_requests
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY hq_all ON category_requests
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

-- Platform notices: HQ speaks, every salon reads. An approved
-- category lands here so all salons hear about the new shelf.
CREATE TABLE platform_notices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE platform_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_notices FORCE ROW LEVEL SECURITY;
CREATE POLICY read_all ON platform_notices FOR SELECT USING (true);
CREATE POLICY hq_write ON platform_notices
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

-- migrate:down

DROP TABLE platform_notices;
DROP TABLE category_requests;
