-- Step 6 of the Search phase — docs/SEARCH.md.
--
-- The scorer gains one component: how well a treatment answers what was
-- actually typed. Free-text search is the only thing that can supply it,
-- so on a category card it is simply absent and the existing
-- renormalisation carries the rest — the same mechanism already used for
-- a viewer who gave no location.
--
-- This is a NEW version rather than an edit to v1. search_config rows
-- are written once and then only activated or deactivated; that is what
-- makes the table its own audit trail, and rewriting a historical
-- payload to mention a component that did not exist when it was written
-- would be tidying away the truth. v1 stays exactly as it was: a config
-- from before text search, which is why the contract reads the weight as
-- optional. Activating v1 again rolls text relevance back to zero, which
-- is the honest meaning of that version.

-- migrate:up

-- The version in force steps down first. The partial unique index is
-- checked statement by statement, so "exactly one active" has to be true
-- between these two statements as well as after them.
UPDATE search_config SET active = false WHERE active;

INSERT INTO search_config (version, active, note, payload, activated_at, activated_by_name)
SELECT
  (SELECT max(version) + 1 FROM search_config),
  true,
  'Text relevance added for free-text search (docs/SEARCH.md step 6).',
  jsonb_build_object(
    'weights', jsonb_build_object(
      'proximity',     0.30,
      'affinity',      0.25,
      'availability',  0.20,
      'value',         0.10,
      'quality',       0.00,   -- inert: no reviews exist
      'exposure',      0.00,   -- inert: no impressions counter
      -- The heaviest component on a text query. Stated plainly: against
      -- proximity's 0.30 and a 5km decay, this means a treatment the
      -- customer named beats one merely in the right category until it
      -- is roughly nine kilometres further away.
      'textRelevance', 0.50
    ),
    'proximity', jsonb_build_object('decayKm', 5),
    'affinity', jsonb_build_object(
      'recencyHalfLifeDays', 180,
      'weights', jsonb_build_object(
        'bookedThisService',  1.00,
        'favourited',         0.90,
        'bookedAtThisSalon',  0.70,
        'bookedSimilar',      0.45,
        'bookedInCategory',   0.35
      ),
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
WHERE EXISTS (SELECT 1 FROM search_config);


-- migrate:down

-- Put the previous version back in force and drop the one this added,
-- rather than leaving nothing active.
UPDATE search_config SET active = false
 WHERE version = (SELECT max(version) FROM search_config);
DELETE FROM search_config
 WHERE note = 'Text relevance added for free-text search (docs/SEARCH.md step 6).';
UPDATE search_config SET active = true
 WHERE version = (SELECT max(version) FROM search_config);
