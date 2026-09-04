-- migrate:up

-- The supplier portal's own notification feed. A salon placing an
-- order writes one here for the supplier (under its tenant context);
-- the supplier reads its own. HQ can write platform-wide ones later.
CREATE TABLE supplier_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  kind        text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  ref_id      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX supplier_notifications_feed ON supplier_notifications (supplier_id, created_at DESC);

ALTER TABLE supplier_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_notifications FORCE ROW LEVEL SECURITY;
-- The supplier reads its own feed.
CREATE POLICY supplier_read ON supplier_notifications FOR SELECT
  USING (supplier_id::text = current_setting('app.supplier_id', true));
-- A salon (any tenant context) may notify a supplier it is ordering from.
CREATE POLICY tenant_notify ON supplier_notifications FOR INSERT
  WITH CHECK (current_setting('app.tenant_id', true) IS NOT NULL);
CREATE POLICY hq_all ON supplier_notifications
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

-- migrate:down

DROP TABLE supplier_notifications;
