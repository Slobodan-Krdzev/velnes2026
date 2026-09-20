-- Phase C — persisted favourites. docs/FAVOURITES.md.
--
-- The heart on a salon card was component state: it filled in, and
-- forgot the moment you navigated away. This is where it goes instead —
-- the client's own list, across every salon, on their own account.
--
-- Three kinds, as the prototype's own section subtitle has it: "Salons,
-- pros & services".
--
-- No foreign key to businesses, services or employees, on purpose.
-- Those are tenant rows on their own lifecycle, and a hard key would put
-- a person's favourites inside the blast radius of a salon's
-- housekeeping. Phase B taught that the expensive way: search_config
-- carried an FK to hq_users, and the demo seed's
-- `TRUNCATE ... hq_users CASCADE` reached straight through it and
-- deleted the ranking config, so a seeded world came up with nothing in
-- force. The only key here is to client_users, because that is whose
-- data this is.
--
-- The cost of no key is orphans, and the answer to that is
-- `missing_since` rather than a nightly job:
--
--   missing_since IS NULL  — the target resolved the last time we looked
--   missing_since = <when> — the target was not there, first noticed then
--
-- which is a three-way distinction, and the middle one matters most:
--
--   * available   — resolves and is public. Shown.
--   * unavailable — resolves, but is unpublished right now: a service set
--                   to draft, a salon that cleared its listing, a pro on
--                   a team that is no longer shown. Hidden from the list
--                   and KEPT, because it can come back tomorrow and the
--                   person did not change their mind.
--   * gone        — does not resolve at all. Stamped, and swept only
--                   after a long grace period.
--
-- Nothing in the API hard-deletes a service, an employee or a business
-- today — they are soft-deleted by status — so `gone` comes from a seed
-- reset, a manual operation, or a delete feature that does not exist
-- yet. The column is here so that when it does happen, the row is
-- stamped rather than guessed at, and cleared again the moment the
-- target reappears.

-- migrate:up

CREATE TABLE client_favourites (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id uuid NOT NULL REFERENCES client_users(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('salon', 'service', 'pro')),
  -- The salon the target belongs to; for kind='salon' it is the target.
  -- Stored rather than looked up, because a service or a pro is only
  -- readable inside its own tenant's context: without this every read
  -- would begin with a lookup to find out where to look.
  tenant_id      uuid NOT NULL,
  -- business id, service id or employee id, by kind.
  ref_id         uuid NOT NULL,
  -- Null while the target resolves. Set the first time it does not.
  missing_since  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Favouriting twice is not two rows; it is the same row. The doors are
-- idempotent and this is what makes them so.
CREATE UNIQUE INDEX client_favourites_one
  ON client_favourites (client_user_id, kind, ref_id);
CREATE INDEX client_favourites_mine
  ON client_favourites (client_user_id, created_at DESC);
-- Sweeping asks "what has been gone a long time", so let it ask cheaply.
CREATE INDEX client_favourites_missing
  ON client_favourites (missing_since)
  WHERE missing_since IS NOT NULL;

ALTER TABLE client_favourites ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_favourites FORCE ROW LEVEL SECURITY;

-- The client's own, and nobody else's. Note what is absent: there is no
-- tenant policy of any kind. client_notifications has one because a
-- salon legitimately writes notifications to its customers; nothing a
-- salon does should ever touch this table, and a salon is never told who
-- favourited it.
CREATE POLICY fav_client ON client_favourites
  USING (client_user_id::text = current_setting('app.client_id', true))
  WITH CHECK (client_user_id::text = current_setting('app.client_id', true));

-- HQ reads, for support: answering "my favourites vanished" should not
-- require a database console. Read-only — HQ has no business editing
-- somebody's list.
CREATE POLICY fav_hq ON client_favourites FOR SELECT
  USING (current_setting('app.hq', true) = '1');

-- migrate:down

DROP TABLE client_favourites;
