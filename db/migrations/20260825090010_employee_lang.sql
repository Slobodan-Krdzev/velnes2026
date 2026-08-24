-- migrate:up

-- UI language per employee: en | mk | sq. Salon-authored content
-- (service names etc.) is never translated — this is chrome language.
ALTER TABLE employees ADD COLUMN lang text NOT NULL DEFAULT 'en';

-- migrate:down

ALTER TABLE employees DROP COLUMN lang;
