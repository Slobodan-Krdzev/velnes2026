-- migrate:up

-- A changed email address must be confirmed again before it counts
-- (Alex, 2026-09-03). The timestamp is the state: set = verified,
-- null = confirmation pending. SMTP is still undecided, so nothing
-- sends — the pending state is modelled honestly, never faked.
ALTER TABLE customers ADD COLUMN email_verified_at timestamptz;

-- Standing customers with an email keep their footing: the address
-- was in use before verification existed.
UPDATE customers SET email_verified_at = now() WHERE email IS NOT NULL;

-- migrate:down

ALTER TABLE customers DROP COLUMN email_verified_at;
