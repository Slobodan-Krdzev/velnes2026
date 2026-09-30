-- Velnes Loyalty (Alex, 2026-09-30) — docs/LOYALTY.md.
--
-- The PLATFORM points ledger: one balance per consumer account, earned
-- at any salon. Not the salon's loyalty card (loyalty_ledger, per
-- tenant, money the salon owes) — a second ledger, keyed to
-- client_users, that nothing in a salon's world can write.
--
-- Every point is a signed row with a typed reason and, for every
-- automatic award, a source. The partial UNIQUE on (account, type,
-- source) is the whole idempotency story: the welcome bonus once per
-- account, one award per visit, one per review, one reversal per visit
-- — whatever retries, restarts or races. The cached balance on the
-- account is recomputed from the ledger in the same transaction as
-- every insert, so it cannot drift; the ledger is the truth.
--
-- platform_features('loyalty') is the launch cutoff: no account
-- verified, no visit ended and no review written before it earns
-- anything — existing accounts and history are not back-filled
-- silently (a product decision, docs/LOYALTY.md §2.9).

-- migrate:up

CREATE TABLE client_loyalty_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id  uuid NOT NULL REFERENCES client_users(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN (
                    'registration_bonus', 'appointment_completed', 'review_submitted',
                    'appointment_reversal', 'product_return_reversal', 'reward_redeemed',
                    'promotion_bonus', 'manual_adjustment', 'points_expired')),
  points          integer NOT NULL CHECK (points <> 0),
  source_type     text,
  source_id       text,
  -- Where it was earned, when at a salon. No FK on purpose (a removed
  -- salon must not take a customer's history with it).
  tenant_id       uuid,
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  note            text,
  created_by      text NOT NULL DEFAULT 'system',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX client_loyalty_ledger_once
  ON client_loyalty_ledger (client_user_id, type, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX client_loyalty_ledger_account
  ON client_loyalty_ledger (client_user_id, created_at DESC);
ALTER TABLE client_loyalty_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_loyalty_ledger FORCE ROW LEVEL SECURITY;
-- The customer reads their own, and only reads: every award is written
-- by the platform, never on the customer's say-so.
CREATE POLICY loyalty_client ON client_loyalty_ledger FOR SELECT
  USING (client_user_id::text = current_setting('app.client_id', true));
-- The platform (the loyalty service, HQ support) reads and writes.
CREATE POLICY loyalty_hq ON client_loyalty_ledger
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

-- The cached balance: SUM(points) of the ledger, kept in step by the
-- one writer. A convenience for reads, never the source.
ALTER TABLE client_users ADD COLUMN loyalty_points integer NOT NULL DEFAULT 0;

INSERT INTO platform_features (key) VALUES ('loyalty') ON CONFLICT (key) DO NOTHING;

-- migrate:down

DELETE FROM platform_features WHERE key = 'loyalty';
ALTER TABLE client_users DROP COLUMN IF EXISTS loyalty_points;
DROP TABLE IF EXISTS client_loyalty_ledger;
