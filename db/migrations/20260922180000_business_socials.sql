-- migrate:up

-- A salon's social links (Alex, 2026-09-22): website, Instagram,
-- Facebook, TikTok. Stored as the owner typed them (a handle or a
-- URL); the public door normalises them to links. Empty strings mean
-- "none" — the shape is fixed, the keys are the four we show.
ALTER TABLE businesses
  ADD COLUMN socials jsonb NOT NULL DEFAULT '{}'::jsonb;

-- migrate:down

ALTER TABLE businesses DROP COLUMN socials;
