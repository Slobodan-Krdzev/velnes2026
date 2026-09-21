-- Consent for personalised search results — §5, docs/SEARCH-RANKING.md,
-- decided 2026-09-20: on by default for signed-in clients, with one
-- switch to turn it off.
--
-- Default true, which is only defensible because of what the setting
-- actually governs. Ranking uses the viewer's OWN bookings, server-side,
-- for the viewer's own eyes; no salon learns why it ranked where it did,
-- and nothing is shared, sold or shown. The client already sees this
-- history in My Velnes, so ordering their own results by it is not a new
-- disclosure to anybody. That argument holds only while two rules hold
-- with it — never another client's behaviour, and never any profiling of
-- signed-out visitors — and if either is relaxed this default has to be
-- reopened at the same time.
--
-- The rejected alternatives, for the record: opt-in, which would leave
-- the feature dormant for the great majority who never open settings;
-- and non-optional, which saves a column and removes a choice that costs
-- us almost nothing to offer.

-- migrate:up
ALTER TABLE client_users
  ADD COLUMN personalised_results boolean NOT NULL DEFAULT true;

-- migrate:down
ALTER TABLE client_users DROP COLUMN personalised_results;
