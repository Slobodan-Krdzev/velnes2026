-- Suppliers may now update their OWN row from the portal (only their
-- avatar/logo today — the /portal/company door limits which columns
-- change; RLS limits which row). HQ-managed fields like terms and rating
-- stay behind the door, not RLS. Mirrors the platform pattern: RLS gates
-- rows, the service gates columns.

-- migrate:up
CREATE POLICY supplier_self_update ON suppliers FOR UPDATE
  USING (
    current_setting('app.supplier_id', true) IS NOT NULL
    AND id = current_setting('app.supplier_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.supplier_id', true) IS NOT NULL
    AND id = current_setting('app.supplier_id', true)::uuid
  );

-- migrate:down
DROP POLICY supplier_self_update ON suppliers;
