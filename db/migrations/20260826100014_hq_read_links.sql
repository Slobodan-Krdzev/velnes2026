-- migrate:up

-- The HQ review card joins location → legal entity through the link
-- table; 0013 missed its read policy.
CREATE POLICY hq_read ON legal_entity_locations FOR SELECT
  USING (current_setting('app.hq', true) = '1');

-- migrate:down
DROP POLICY hq_read ON legal_entity_locations;
