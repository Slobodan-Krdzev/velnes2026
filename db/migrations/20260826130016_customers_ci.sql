-- migrate:up

-- ══ Customers & customer intelligence (Phase 9) ══════════════════
-- The customer card grows what the prototype's profile shows;
-- Velnes Premium is a PLATFORM membership mirrored read-only here —
-- isPremium() is the one door that reads it, nobody stores their own
-- copy of the status.

ALTER TABLE customers
  ADD COLUMN birthday date,
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN premium jsonb;   -- {status,since,renews} — platform truth

-- The relationship's append-only log: actor/intent/ref on every line
-- so future funnel metrics ("5 sent, 4 opened, 3 booked") are a pure
-- read. Appointment history deliberately stays out — that is
-- operational truth with a life of its own.
CREATE TABLE customer_activity (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES businesses(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  ts          timestamptz NOT NULL DEFAULT now(),
  actor_employee_id uuid,
  type        text NOT NULL,          -- offer_created, offer_cancelled, note_added, …
  ref_type    text NOT NULL DEFAULT '',
  ref_id      text NOT NULL DEFAULT '',
  meta        jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX customer_activity_cust ON customer_activity (customer_id, ts DESC);
ALTER TABLE customer_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_activity FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON customer_activity FOR SELECT
  USING (tenant_id = app.current_tenant());
CREATE POLICY tenant_append ON customer_activity FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant());

-- A personal offer is a promise to ONE customer for ONE service.
-- 'expired' is never stored, only derived from valid_until — there is
-- no clock that flips fields overnight.
CREATE TABLE personal_offers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES businesses(id),
  customer_id   uuid NOT NULL REFERENCES customers(id),
  service_id    uuid NOT NULL REFERENCES services(id),
  variant_id    uuid REFERENCES service_variants(id),
  location_id   uuid NOT NULL REFERENCES locations(id),
  special_price integer NOT NULL CHECK (special_price >= 0),
  normal_price  integer NOT NULL,     -- what svcChoice said at creation
  valid_until   date NOT NULL,
  intent        text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'live'
                CHECK (status IN ('live','cancelled','redeemed')),
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX personal_offers_cust ON personal_offers (customer_id, status);
ALTER TABLE personal_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_offers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON personal_offers
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

-- migrate:down
DROP TABLE personal_offers;
DROP TABLE customer_activity;
ALTER TABLE customers DROP COLUMN premium, DROP COLUMN tags, DROP COLUMN birthday;
