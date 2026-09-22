-- migrate:up

-- A discount code can be paused without being deleted (Alex,
-- 2026-09-22): the switch every surface reads through validateCode —
-- the till, the Velnes app, the marketing table.
ALTER TABLE discount_codes ADD COLUMN active boolean NOT NULL DEFAULT true;

-- migrate:down

ALTER TABLE discount_codes DROP COLUMN active;
