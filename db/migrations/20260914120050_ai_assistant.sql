-- migrate:up

-- The AI Assistant's server-side pending action. The structured draft is
-- the source of truth for a pending mutation (never the chat transcript).
-- Tenant-scoped, short-TTL; one active draft per user per app is enforced
-- in the service, not the schema.
CREATE TABLE assistant_drafts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES businesses(id),
  created_by  uuid REFERENCES employees(id),
  app         text NOT NULL,
  action_id   text NOT NULL,
  status      text NOT NULL,
  draft       jsonb NOT NULL,          -- the whole ActionDraft (args/preview/fingerprint)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL     -- TTL; expired drafts are ignored + swept
);
CREATE INDEX assistant_drafts_owner ON assistant_drafts (tenant_id, created_by, updated_at DESC);

ALTER TABLE assistant_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assistant_drafts
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

-- The structured record of an AI-assisted mutation: the ChangeSet diff, the
-- resolved action, the approver and the concurrency fingerprint. Additive to
-- (not a replacement for) the human-readable audit_log; append-only.
CREATE TABLE assistant_actions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES businesses(id),
  actor_employee_id uuid REFERENCES employees(id),
  app               text NOT NULL,
  action_id         text NOT NULL,
  draft_id          uuid,
  change            jsonb NOT NULL,     -- the ChangeSet: per-op before/after/impact
  fingerprint       jsonb,             -- the concurrency baseline used
  result            text NOT NULL,      -- 'success' | 'failed'
  reason            text,
  ts                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_actions_tenant ON assistant_actions (tenant_id, ts DESC);

ALTER TABLE assistant_actions ENABLE ROW LEVEL SECURITY;
-- Append-only for the API role: SELECT + INSERT only, no UPDATE/DELETE policy.
CREATE POLICY tenant_read ON assistant_actions
  FOR SELECT USING (tenant_id = app.current_tenant());
CREATE POLICY tenant_insert ON assistant_actions
  FOR INSERT WITH CHECK (tenant_id = app.current_tenant());

-- migrate:down
DROP TABLE assistant_actions;
DROP TABLE assistant_drafts;
