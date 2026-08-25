-- migrate:up

-- ══ Revelapps HQ + salon registrations ═══════════════════════════
-- Platform-level rows (no tenant): HQ staff accounts and the intake
-- queue every new salon passes through. HQ reads cross-tenant via an
-- explicit app.hq mode — the same pattern as app.auth and app.public,
-- never a SECURITY DEFINER function.

CREATE TABLE hq_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  role          text NOT NULL DEFAULT 'hq_support'
                CHECK (role IN ('hq_super','hq_onboard','hq_support','hq_tech','hq_audit')),
  password_hash text NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE hq_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE hq_users FORCE ROW LEVEL SECURITY;
CREATE POLICY hq_all ON hq_users
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');
CREATE POLICY hq_login_lookup ON hq_users FOR SELECT
  USING (current_setting('app.auth', true) = 'login');

-- The registration status machine (docs §4 Governance):
-- pending_review → under_review → changes_required → resubmitted →
-- active/declined. The full wizard draft is retained so
-- "request changes" reopens the same form — improve, not retype.
CREATE TYPE registration_status AS ENUM
  ('pending_review','under_review','changes_required','resubmitted','active','declined');

CREATE TABLE registrations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts                timestamptz NOT NULL DEFAULT now(),
  status            registration_status NOT NULL DEFAULT 'pending_review',
  draft             jsonb NOT NULL,
  -- Reserved for SMTP: tokens minted now, sending decided later.
  email_token       uuid NOT NULL DEFAULT gen_random_uuid(),
  email_sent_at     timestamptz,
  email_verified_at timestamptz,
  -- The applicant's own door back in: RLS-enforced token match.
  resubmit_token    uuid NOT NULL DEFAULT gen_random_uuid(),
  hq_reason         text,
  reviewed_by       text,
  reviewed_at       timestamptz,
  business_id       uuid REFERENCES businesses(id),
  log               jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX registrations_queue ON registrations (status, ts DESC);
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations FORCE ROW LEVEL SECURITY;
CREATE POLICY hq_all ON registrations
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');
-- Anyone may apply; nobody anonymous may read the queue.
CREATE POLICY public_apply ON registrations FOR INSERT
  WITH CHECK (current_setting('app.public', true) = '1');
-- The applicant reaches only their own row, by resubmit token.
CREATE POLICY applicant_by_token ON registrations FOR SELECT
  USING (resubmit_token::text = current_setting('app.reg_token', true));
CREATE POLICY applicant_resubmit ON registrations FOR UPDATE
  USING (resubmit_token::text = current_setting('app.reg_token', true))
  WITH CHECK (resubmit_token::text = current_setting('app.reg_token', true));

-- HQ reads across tenants: the queues and review cards need these.
-- Read-only — every write still happens through the tenant doors.
CREATE POLICY hq_read ON businesses FOR SELECT
  USING (current_setting('app.hq', true) = '1');
CREATE POLICY hq_read ON locations FOR SELECT
  USING (current_setting('app.hq', true) = '1');
CREATE POLICY hq_read ON legal_entities FOR SELECT
  USING (current_setting('app.hq', true) = '1');
CREATE POLICY hq_read ON payment_accounts FOR SELECT
  USING (current_setting('app.hq', true) = '1');
CREATE POLICY hq_read ON employees FOR SELECT
  USING (current_setting('app.hq', true) = '1');
CREATE POLICY hq_read ON audit_log FOR SELECT
  USING (current_setting('app.hq', true) = '1');
CREATE POLICY hq_read ON location_lifecycle_log FOR SELECT
  USING (current_setting('app.hq', true) = '1');

-- migrate:down
DROP POLICY hq_read ON location_lifecycle_log;
DROP POLICY hq_read ON audit_log;
DROP POLICY hq_read ON employees;
DROP POLICY hq_read ON payment_accounts;
DROP POLICY hq_read ON legal_entities;
DROP POLICY hq_read ON locations;
DROP POLICY hq_read ON businesses;
DROP TABLE registrations;
DROP TYPE registration_status;
DROP TABLE hq_users;
