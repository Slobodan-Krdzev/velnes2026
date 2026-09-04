-- migrate:up

-- When a supplier declines (cancels) an order it must say why; the
-- reason lives on the order so the salon can see it, and also lands
-- in the audit trail.
ALTER TABLE purchase_orders ADD COLUMN supplier_note text NOT NULL DEFAULT '';

-- migrate:down

ALTER TABLE purchase_orders DROP COLUMN supplier_note;
