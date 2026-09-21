-- The Search lab's config document — §5, docs/SEARCH-RANKING.md.
--
-- Every constant the ranker uses is a knob: the six component weights,
-- the proximity decay distance, the recency half-life, the chain-dedup
-- cap, the new-salon window. Hard-coding them would make every tuning
-- decision a deploy, with no record of who changed what.
--
-- Versioned, never edited in place. A row is written once and then only
-- ever activated or deactivated, so the table IS the audit trail:
-- who wrote a version, when, who turned it on, and what the payload
-- said. That is a deliberate departure from the spec's "audited through
-- audit_log" — audit_log is tenant-scoped (tenant_id NOT NULL) and
-- ranking config belongs to no business, so recording it there would
-- mean inventing a tenant for a platform-level act. The immutable
-- version history answers the same question better.
--
-- Platform-level and HQ-only: a salon that could read the weights is a
-- salon that could game them, so unlike service_categories there is no
-- public read policy here. The ranker reads it from the API's own
-- privileged connection, not from a tenant or public context.
--
-- created_by / activated_by are HQ user ids with NO foreign key, on
-- purpose and for two reasons. An FK to hq_users would put this table in
-- the blast radius of the demo seed's `TRUNCATE ... hq_users CASCADE`,
-- which would leave a seeded world with no config in force and a ranker
-- with nothing to read. And an audit trail that loses its author the day
-- the author's account is deleted is a worse audit trail — the name is
-- kept alongside the id for exactly that reason, the same way audit_log
-- keeps actor_name next to actor_employee_id.

-- migrate:up

CREATE TABLE search_config (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Monotonic and human-quotable: "that order came from config v7".
  version      integer NOT NULL UNIQUE,
  payload      jsonb NOT NULL,
  -- Exactly one row may be active; enforced by the partial index below.
  active       boolean NOT NULL DEFAULT false,
  note         text NOT NULL DEFAULT '',
  created_by      uuid,
  created_by_name text NOT NULL DEFAULT 'Velnes',
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Null until this version has been switched on at least once.
  activated_by      uuid,
  activated_by_name text NOT NULL DEFAULT '',
  activated_at      timestamptz
);

-- One active version, always. A second activation has to deactivate the
-- first in the same transaction or the write is refused.
CREATE UNIQUE INDEX search_config_one_active ON search_config (active) WHERE active;
CREATE INDEX search_config_version ON search_config (version DESC);

ALTER TABLE search_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_config FORCE ROW LEVEL SECURITY;
CREATE POLICY hq_all ON search_config
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

-- v1: the defaults argued for in docs/SEARCH-RANKING.md §2, seeded
-- active so the ranker always has something to read. Weights that sum
-- to 1 before the exposure penalty; components a viewer cannot supply
-- are dropped and the rest renormalised, never replaced by a midpoint.
--
-- quality and exposure are present and zero on purpose. Their slots
-- exist so that reviews and an impressions counter become data changes
-- rather than a ranking rewrite, and so that a test can assert they
-- contribute exactly nothing in the meantime.
-- Seeded here and nowhere else: this is the one copy of the defaults
-- that a database actually comes up on, in production and in test
-- alike. packages/contracts carries DEFAULT_SEARCH_CONFIG as a plain
-- object so the ranker can be unit-tested without a database, and a
-- test asserts the row below equals it — so the two cannot drift apart
-- unnoticed.
INSERT INTO search_config (version, active, note, payload, activated_at, activated_by_name)
VALUES (
  1,
  true,
  'Defaults from docs/SEARCH-RANKING.md §2, settled 2026-09-20.',
  jsonb_build_object(
    'weights', jsonb_build_object(
      'proximity',    0.30,
      'affinity',     0.25,
      'availability', 0.20,
      'value',        0.10,
      'quality',      0.00,   -- inert: no reviews exist
      'exposure',     0.00    -- inert: no impressions counter
    ),
    'proximity', jsonb_build_object(
      'decayKm', 5
    ),
    'affinity', jsonb_build_object(
      'recencyHalfLifeDays', 180,
      'weights', jsonb_build_object(
        'bookedThisService',  1.00,
        'favourited',         0.90,
        'bookedAtThisSalon',  0.70,
        'bookedSimilar',      0.45,
        'bookedInCategory',   0.35
      ),
      -- "Similar" without tags: same category, duration within ±50%.
      'similarDurationTolerance', 0.5
    ),
    'diversity', jsonb_build_object(
      'maxPerBusinessInWindow', 2,
      'windowSize',             10,
      'newSalonWindowDays',     30
    )
  ),
  now(),
  'Velnes'
);

-- migrate:down

DROP TABLE search_config;
