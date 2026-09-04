-- migrate:up

-- Supplier-portal team invites travel through the same outbox as
-- every other mail. Let the supplier context insert its own
-- (tenant-less) invite rows; it still cannot read or touch tenant mail.
CREATE POLICY supplier_write ON mail_outbox FOR INSERT
  WITH CHECK (current_setting('app.supplier_id', true) IS NOT NULL AND tenant_id IS NULL);

-- migrate:down

DROP POLICY supplier_write ON mail_outbox;
