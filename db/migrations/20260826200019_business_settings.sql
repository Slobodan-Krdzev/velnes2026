-- migrate:up

-- ══ The missing Settings sections (workspace parity) ═════════════
-- Company information, the public gallery, and one settings document
-- for the sections that are pure configuration: customer groups &
-- form flags, sales defaults, the marketplace listing (stored now,
-- honored when search/discovery starts), and the ranking criteria.

ALTER TABLE businesses
  ADD COLUMN address text,
  ADD COLUMN city text,
  ADD COLUMN phone text,
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN gallery jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN settings jsonb NOT NULL DEFAULT '{}';

-- migrate:down
ALTER TABLE businesses
  DROP COLUMN settings, DROP COLUMN gallery, DROP COLUMN description,
  DROP COLUMN phone, DROP COLUMN city, DROP COLUMN address;
