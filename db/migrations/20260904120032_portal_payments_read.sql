-- migrate:up

-- The portal's read-only Payments card shows the supplier's own legal
-- entity and payment account (configuration stays HQ's; credentials
-- are never exposed). Give the supplier context a scoped window on
-- exactly its own rows.
CREATE POLICY supplier_read ON legal_entities FOR SELECT
  USING (
    owner_type = 'supplier'
    AND owner_id::text = current_setting('app.supplier_id', true)
  );
CREATE POLICY supplier_read ON payment_accounts FOR SELECT
  USING (
    legal_entity_id IN (
      SELECT id FROM legal_entities
      WHERE owner_type = 'supplier'
        AND owner_id::text = current_setting('app.supplier_id', true)
    )
  );

-- migrate:down

DROP POLICY supplier_read ON legal_entities;
DROP POLICY supplier_read ON payment_accounts;
