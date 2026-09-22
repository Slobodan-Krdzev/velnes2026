-- migrate:up

-- A client's saved cards (Alex, 2026-09-22). Never the number: the
-- provider (mock today) hands back a reference, and what the account
-- keeps is the brand, the last four digits, the expiry and the name —
-- enough to recognise the card, nothing that could charge it without
-- the provider. Private to the client: their context alone reads and
-- writes it; HQ may read for support.
CREATE TABLE client_payment_methods (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id uuid NOT NULL REFERENCES client_users(id) ON DELETE CASCADE,
  brand          text NOT NULL,
  last4          text NOT NULL,
  exp_month      integer NOT NULL,
  exp_year       integer NOT NULL,
  holder         text NOT NULL DEFAULT '',
  provider       text NOT NULL DEFAULT 'mock',
  provider_ref   text NOT NULL,            -- the provider's token for this card
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_payment_methods_owner ON client_payment_methods (client_user_id, created_at DESC);

ALTER TABLE client_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_payment_methods FORCE ROW LEVEL SECURITY;
CREATE POLICY cards_client ON client_payment_methods
  USING (client_user_id::text = current_setting('app.client_id', true))
  WITH CHECK (client_user_id::text = current_setting('app.client_id', true));
CREATE POLICY cards_hq ON client_payment_methods FOR SELECT
  USING (current_setting('app.hq', true) = '1');

-- migrate:down

DROP TABLE client_payment_methods;
