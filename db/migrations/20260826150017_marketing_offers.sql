-- migrate:up

-- ══ Last-minute offers & the Velnes Premium pipeline (Phase 9) ═══
-- One offer, several phases; the capacity snapshots travel with it —
-- today's gaps are not gaps tomorrow, and an offer must keep knowing
-- what it was about.

CREATE TABLE last_minute_offers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES businesses(id),
  location_id    uuid NOT NULL REFERENCES locations(id),
  date           date NOT NULL,
  slot_ids       text[] NOT NULL,
  slots          jsonb NOT NULL,          -- snapshot per slot id
  eligible_variant_ids uuid[] NOT NULL DEFAULT '{}',
  phases         jsonb NOT NULL,          -- [{startsAt,endsAt,audience,…}]
  status         text NOT NULL DEFAULT 'live' CHECK (status IN ('live','ended')),
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX last_minute_offers_loc ON last_minute_offers (location_id, date, status);
ALTER TABLE last_minute_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE last_minute_offers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON last_minute_offers
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

-- One recommendation from tomorrow's gaps — the same capacity source
-- as the flightdeck and the offer drawer, so there is no second truth.
CREATE TABLE member_recs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES businesses(id),
  location_id  uuid NOT NULL REFERENCES locations(id),
  date         date NOT NULL,
  start_at     text NOT NULL,            -- HH:MM
  end_at       text NOT NULL,
  service_id   uuid NOT NULL REFERENCES services(id),
  variant_id   uuid,
  employee_id  uuid,
  normal_price integer NOT NULL,
  rec_pct      integer NOT NULL,
  rec_price    integer NOT NULL,
  candidates   jsonb NOT NULL,           -- [{cid,name,score,why[]}]
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved','declined')),
  offer_id     uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE member_recs ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_recs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON member_recs
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

-- The staged life of one approved opportunity:
-- stage 1 = best member (priorityMin), 2 = member group
-- (escalationMin), 3 = public (only if the HQ rule allows), then done.
CREATE TABLE premium_offers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES businesses(id),
  rec_id       uuid REFERENCES member_recs(id),
  location_id  uuid NOT NULL REFERENCES locations(id),
  date         date NOT NULL,
  start_at     text NOT NULL,
  end_at       text NOT NULL,
  service_id   uuid NOT NULL REFERENCES services(id),
  variant_id   uuid,
  employee_id  uuid,
  normal_price integer NOT NULL,
  pct          integer NOT NULL,
  price        integer NOT NULL,
  candidates   jsonb NOT NULL,
  stage        integer NOT NULL DEFAULT 1,
  status       text NOT NULL DEFAULT 'live' CHECK (status IN ('live','done')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE premium_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE premium_offers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON premium_offers
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

-- migrate:down
DROP TABLE premium_offers;
DROP TABLE member_recs;
DROP TABLE last_minute_offers;
