-- migrate:up

-- The HQ customers dashboard derives each account's onboarding steps
-- from the real tables (catalog filled? widget installed?), so HQ
-- needs the same read-only window on these that it already has on
-- locations, employees and payment_accounts.
CREATE POLICY hq_read ON services FOR SELECT
  USING (current_setting('app.hq', true) = '1');
CREATE POLICY hq_read ON products FOR SELECT
  USING (current_setting('app.hq', true) = '1');
CREATE POLICY hq_read ON widgets FOR SELECT
  USING (current_setting('app.hq', true) = '1');
CREATE POLICY hq_read ON integration_events FOR SELECT
  USING (current_setting('app.hq', true) = '1');

-- migrate:down

DROP POLICY hq_read ON services;
DROP POLICY hq_read ON products;
DROP POLICY hq_read ON widgets;
DROP POLICY hq_read ON integration_events;
