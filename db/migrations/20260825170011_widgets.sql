-- migrate:up

-- The public booking surface: widgets with publishable keys and
-- per-domain CORS, the salon's hosted-page slug, and the integration
-- events log that makes widget debugging honest.

ALTER TABLE businesses ADD COLUMN slug text UNIQUE;

-- The hosted page and the widget resolve pre-auth by slug/key: one
-- explicit public-lookup mode, like the login door.
CREATE POLICY public_slug_lookup ON businesses FOR SELECT
  USING (current_setting('app.public', true) = '1');

CREATE TYPE widget_status AS ENUM ('live','draft');

CREATE TABLE widgets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES businesses(id),
  name          text NOT NULL,
  location_ids  uuid[] NOT NULL DEFAULT '{}',
  categories    text[] NOT NULL DEFAULT '{all}',
  lang          text NOT NULL DEFAULT 'en',
  theme         text NOT NULL DEFAULT 'light',
  btn_style     text NOT NULL DEFAULT 'rounded',
  cancel_policy text NOT NULL DEFAULT 'inherit',  -- 'inherit' | hours
  accent        text NOT NULL DEFAULT '#6f7357',
  radius        text NOT NULL DEFAULT '12',
  start_step    text NOT NULL DEFAULT 'location',
  deposit       text NOT NULL DEFAULT 'none',     -- none | percent | full
  status        widget_status NOT NULL DEFAULT 'draft',
  domains       text[] NOT NULL DEFAULT '{}',
  publishable_key text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX widgets_tenant ON widgets (tenant_id, status);
ALTER TABLE widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE widgets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON widgets
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY public_key_lookup ON widgets FOR SELECT
  USING (current_setting('app.public', true) = '1');

CREATE TABLE integration_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES businesses(id),
  widget_id  uuid REFERENCES widgets(id),
  level      text NOT NULL DEFAULT 'error',  -- ok | warn | error
  code       text NOT NULL,                  -- SERVICE_NOT_FOUND, …
  msg        text NOT NULL,
  fix        text NOT NULL DEFAULT '',
  ts         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX integration_events_tenant ON integration_events (tenant_id, ts DESC);
ALTER TABLE integration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON integration_events FOR SELECT
  USING (tenant_id = app.current_tenant());
CREATE POLICY tenant_append ON integration_events FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant());

-- migrate:down

DROP TABLE integration_events;
DROP TABLE widgets;
DROP TYPE widget_status;
DROP POLICY public_slug_lookup ON businesses;
ALTER TABLE businesses DROP COLUMN slug;
