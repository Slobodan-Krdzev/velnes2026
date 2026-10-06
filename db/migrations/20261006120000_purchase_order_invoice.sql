-- Invoice PDF for a finished purchase order (Alex, 2026-10-06) —
-- docs/SUPPLIERS.md "The invoice as a PDF".
--
-- A delivered order is invoiced: it gets a number in the supplier's
-- own sequence (INV-<year>-<n>) and the moment, and from then on both
-- sides can open the same PDF. The document is rendered from the order
-- rows, which no longer change after delivery, so the number and the
-- moment are the only facts to keep. This is Velnes' invoice document,
-- not the fiscal receipt — that still waits for the fiscalization
-- decision.

-- migrate:up

ALTER TABLE purchase_orders
  ADD COLUMN invoice_no text,
  ADD COLUMN invoiced_at timestamptz;
-- Numbered per supplier across tenants (a supplier's sequence spans
-- every salon it serves), so this one index leads with supplier_id.
CREATE UNIQUE INDEX purchase_orders_invoice_no
  ON purchase_orders (supplier_id, invoice_no) WHERE invoice_no IS NOT NULL;

-- migrate:down

DROP INDEX purchase_orders_invoice_no;
ALTER TABLE purchase_orders DROP COLUMN invoiced_at, DROP COLUMN invoice_no;
