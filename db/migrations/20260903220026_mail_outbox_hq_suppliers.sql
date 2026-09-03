-- migrate:up

-- The mail outbox: every email the platform WOULD send, on the
-- record. The provider is undecided (likely Resend) — the mock
-- transport stamps rows 'mock_sent' so nothing pretends to deliver.
CREATE TABLE mail_outbox (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES businesses(id),  -- null = platform mail
  to_email    text NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL DEFAULT '',
  kind        text NOT NULL,
  ref_id      text,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','mock_sent','sent','failed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE INDEX mail_outbox_tenant ON mail_outbox (tenant_id, created_at);
ALTER TABLE mail_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_own ON mail_outbox
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY hq_all ON mail_outbox
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

-- HQ Supplier Intelligence: the platform operator reads the whole
-- supplier chain and manages the supplier records themselves.
CREATE POLICY hq_read ON supplier_connections FOR SELECT
  USING (current_setting('app.hq', true) = '1');
CREATE POLICY hq_read ON purchase_orders FOR SELECT
  USING (current_setting('app.hq', true) = '1');
CREATE POLICY hq_read ON purchase_order_lines FOR SELECT
  USING (current_setting('app.hq', true) = '1');
CREATE POLICY hq_write ON suppliers
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

-- migrate:down

DROP POLICY hq_write ON suppliers;
DROP POLICY hq_read ON purchase_order_lines;
DROP POLICY hq_read ON purchase_orders;
DROP POLICY hq_read ON supplier_connections;
DROP TABLE mail_outbox;
