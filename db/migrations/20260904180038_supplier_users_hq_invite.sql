-- migrate:up
-- HQ registers a supplier, then needs to hand it its first keyholder.
-- supplier_users so far only opened to the supplier's own context
-- (app.supplier_id) and the login lookup; there was no door for HQ to
-- seed that first owner. This adds one: HQ (app.hq) may read the roster
-- and INSERT the bootstrap owner. The supplier's own app.supplier_id
-- policy still governs everything the supplier does afterwards.
CREATE POLICY hq_bootstrap ON supplier_users FOR SELECT
  USING (current_setting('app.hq', true) = '1');
CREATE POLICY hq_invite ON supplier_users FOR INSERT
  WITH CHECK (current_setting('app.hq', true) = '1');

-- migrate:down
DROP POLICY hq_invite ON supplier_users;
DROP POLICY hq_bootstrap ON supplier_users;
