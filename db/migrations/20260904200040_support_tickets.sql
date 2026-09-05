-- migrate:up
-- Support tickets: a salon (tenant) or a supplier opens a thread to
-- Revelapps HQ. One row per ticket; the conversation lives in a JSONB
-- thread so there is no second table to keep in RLS lockstep. Origin
-- columns are mutually exclusive — exactly one of tenant_id/supplier_id
-- is set — and each side reads only its own, while HQ reads them all.
CREATE TYPE support_status AS ENUM ('open','in_progress','resolved','closed');

CREATE TABLE support_tickets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin         text NOT NULL CHECK (origin IN ('tenant','supplier')),
  tenant_id      uuid REFERENCES businesses(id),
  supplier_id    uuid REFERENCES suppliers(id),
  subject        text NOT NULL,
  category       text NOT NULL DEFAULT 'other',
  status         support_status NOT NULL DEFAULT 'open',
  created_by     text NOT NULL,                 -- display name of the opener
  reply_to       text NOT NULL DEFAULT '',       -- opener's email, captured so HQ can answer by mail
  origin_name    text NOT NULL DEFAULT '',       -- salon or supplier name, for HQ's list
  messages       jsonb NOT NULL DEFAULT '[]',    -- [{authorKind,authorName,body,at}]
  last_actor     text NOT NULL DEFAULT 'origin', -- 'origin' | 'hq'
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((origin = 'tenant' AND tenant_id IS NOT NULL AND supplier_id IS NULL)
      OR (origin = 'supplier' AND supplier_id IS NOT NULL AND tenant_id IS NULL))
);
CREATE INDEX support_tickets_tenant ON support_tickets (tenant_id, updated_at);
CREATE INDEX support_tickets_supplier ON support_tickets (supplier_id, updated_at);
CREATE INDEX support_tickets_status ON support_tickets (status);

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets FORCE ROW LEVEL SECURITY;
-- The salon reads and writes its own tickets.
CREATE POLICY tenant_isolation ON support_tickets
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
-- The supplier reads and writes its own.
CREATE POLICY supplier_own ON support_tickets
  USING (supplier_id::text = current_setting('app.supplier_id', true))
  WITH CHECK (supplier_id::text = current_setting('app.supplier_id', true));
-- HQ sees and answers everything.
CREATE POLICY hq_all ON support_tickets
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

-- migrate:down
DROP TABLE support_tickets;
DROP TYPE support_status;
