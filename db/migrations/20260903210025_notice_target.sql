-- migrate:up

-- A notice may speak to ONE salon (a declined category request goes
-- back to whoever asked). null = broadcast to the whole audience.
ALTER TABLE platform_notices
  ADD COLUMN tenant_id uuid REFERENCES businesses(id);

-- Reads scope with the target: a salon sees broadcasts and its own
-- mail, never another salon's; HQ sees everything.
DROP POLICY read_all ON platform_notices;
CREATE POLICY read_scoped ON platform_notices FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = app.current_tenant()
    OR current_setting('app.hq', true) = '1'
  );

-- migrate:down

DROP POLICY read_scoped ON platform_notices;
CREATE POLICY read_all ON platform_notices FOR SELECT USING (true);
ALTER TABLE platform_notices DROP COLUMN tenant_id;
