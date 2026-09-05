-- migrate:up
-- A notice can point at the thing it speaks of, so a click in the bell
-- lands on it. Support notices carry the ticket id here; category
-- notices leave it null and still open their shelf by kind.
ALTER TABLE platform_notices ADD COLUMN ref_id text;

-- migrate:down
ALTER TABLE platform_notices DROP COLUMN ref_id;
