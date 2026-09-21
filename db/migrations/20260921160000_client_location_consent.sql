-- Location consent on a client account — docs/CONSUMER-APP.md.
--
-- What is stored is the DECISION and nothing else: whether this person
-- said Velnes may use their location. Never a position. Alex settled
-- that on 2026-09-21 — the app takes a fresh, precise fix at the moment
-- it is needed and forgets it, so the answer to "where was this customer
-- last week" is that nobody, including the platform, can say.
--
-- Three states, because "never asked" is not the same as "said no":
--   NULL  — never decided; the home page asks once.
--   true  — allowed; the app locates them on every visit to the home page.
--   false — refused; "Near me" is disabled, with a line saying how to
--           turn it on, and nobody is asked again.
--
-- Signed-out visitors keep the same decision in localStorage; a signed-in
-- customer's decision follows them across devices from here, and the
-- two are reconciled on sign-in.

-- migrate:up

ALTER TABLE client_users
  ADD COLUMN location_allowed boolean;

COMMENT ON COLUMN client_users.location_allowed IS
  'Whether the customer allowed location use. NULL = never asked. A decision only — no position is ever stored.';

-- migrate:down

ALTER TABLE client_users DROP COLUMN IF EXISTS location_allowed;
