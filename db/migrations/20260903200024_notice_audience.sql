-- migrate:up

-- Notices grow an audience: 'salons' (HQ speaks to every salon) or
-- 'hq' (the platform rings HQ — e.g. an incoming category request).
ALTER TABLE platform_notices
  ADD COLUMN audience text NOT NULL DEFAULT 'salons'
  CHECK (audience IN ('salons','hq'));

-- A tenant may ring HQ's bell, and only HQ's bell.
CREATE POLICY tenant_ring_hq ON platform_notices FOR INSERT
  WITH CHECK (audience = 'hq');

-- migrate:down

DROP POLICY tenant_ring_hq ON platform_notices;
ALTER TABLE platform_notices DROP COLUMN audience;
