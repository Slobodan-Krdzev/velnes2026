-- The AI Assistant is a per-salon entitlement, owned by RevelApps HQ.
-- Off for everyone by default; HQ turns it on per business (a controlled
-- pilot). Mirrors the existing timing_enabled per-tenant flag. The
-- workspace reads it (to show/hide the launcher) AND the server enforces
-- it (assistant endpoints refuse when off) — hiding a button is not
-- security on its own.

-- migrate:up
ALTER TABLE businesses ADD COLUMN assistant_enabled boolean NOT NULL DEFAULT false;

-- migrate:down
ALTER TABLE businesses DROP COLUMN assistant_enabled;
