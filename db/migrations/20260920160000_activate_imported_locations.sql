-- The imported demo salons never finished the lifecycle they were
-- imported into: marketplace-listed, pinned, staffed and selling, but
-- left on APPROVED because nobody walked them through the last step.
--
-- §5 admits a salon to discovery only on lifecycle ACTIVE, and Alex's
-- instruction is explicit: the production rule does not bend to fit
-- demo data. So the data is corrected instead — these salons really are
-- open, and APPROVED was the lie.
--
-- What "correct" means here is exactly what locTransition does for
-- APPROVED → ACTIVE: lifecycle ACTIVE, online true, an opened date if
-- there was none, and a row in location_lifecycle_log so the step is
-- recorded rather than appearing to have always been so. The readiness
-- gate and the owner-only rule are properties of the door a person
-- comes through; this is the same destination reached by repair, and
-- the log says so in its reason.
--
-- Deliberately narrow: only locations that are APPROVED, already
-- pinned, and belong to a business publishing a marketplace listing. A
-- location still in DRAFT has not been approved by anybody and is not
-- this migration's business; nor is an approved location of a salon
-- that never asked to be listed. On a database without the imported
-- salons — the test database, a fresh production one — this matches
-- nothing and does nothing.

-- migrate:up

INSERT INTO location_lifecycle_log (tenant_id, location_id, from_state, to_state, actor_employee_id, reason)
SELECT l.tenant_id, l.id, 'APPROVED', 'ACTIVE', NULL,
       'Data repair: imported salon was trading but left on APPROVED (§5 admission)'
FROM locations l
JOIN businesses b ON b.id = l.tenant_id
WHERE l.lifecycle = 'APPROVED'
  AND l.lat IS NOT NULL AND l.lng IS NOT NULL
  AND b.slug IS NOT NULL
  AND COALESCE(b.settings->'marketplace'->>'listed', 'true') = 'true';

UPDATE locations l
SET lifecycle = 'ACTIVE',
    online    = true,
    opened    = COALESCE(l.opened, CURRENT_DATE)
FROM businesses b
WHERE b.id = l.tenant_id
  AND l.lifecycle = 'APPROVED'
  AND l.lat IS NOT NULL AND l.lng IS NOT NULL
  AND b.slug IS NOT NULL
  AND COALESCE(b.settings->'marketplace'->>'listed', 'true') = 'true';

-- migrate:down

-- Put back only what this migration moved, identified by the log row it
-- wrote, so a location activated by a person in between is left alone.
UPDATE locations l
SET lifecycle = 'APPROVED', online = false
WHERE EXISTS (
  SELECT 1 FROM location_lifecycle_log g
  WHERE g.location_id = l.id
    AND g.reason = 'Data repair: imported salon was trading but left on APPROVED (§5 admission)'
)
AND l.lifecycle = 'ACTIVE';

DELETE FROM location_lifecycle_log
WHERE reason = 'Data repair: imported salon was trading but left on APPROVED (§5 admission)';
