-- Phase 0 of invoicing (Alex, 2026-10-06) — docs/INVOICING-PLAN.md J.0,
-- docs/TILL.md "Phase 0".
--
-- 1. The exact line amount. `invoice_lines.unit_price` has always been
--    the unit price AFTER the line discount, rounded (lineTotal ÷ qty),
--    and `line_discount` was stored beside it. Four readers then took
--    qty × unit_price − line_discount and subtracted the discount a
--    second time; and the rounding of unit_price lost up to qty−1
--    denars against the sale's own total. `amount` is the line's exact
--    total after its discount, written by the sale door and the only
--    thing a reader sums from now on. Historical rows are backfilled
--    with qty × unit_price — the best their stored figures allow (the
--    historic rounding cannot be undone); the double-subtraction they
--    suffered in reports is gone either way. unit_price keeps its
--    meaning so no old row changes sense.
--    The BEFORE INSERT trigger fills `amount` when a writer omits it
--    (the seeds, fixtures), so NOT NULL holds without touching them.
-- 2. Payment methods. The six values the apps emit become the only
--    ones a new row may carry. Existing rows are normalised where the
--    only difference is case or spacing; the CHECK is added NOT VALID,
--    so it binds new and updated rows and never refuses a historical
--    one — validate it once production's distinct values are confirmed.

-- migrate:up

ALTER TABLE invoice_lines ADD COLUMN amount integer;
UPDATE invoice_lines SET amount = qty * unit_price;
ALTER TABLE invoice_lines ALTER COLUMN amount SET NOT NULL;
COMMENT ON COLUMN invoice_lines.unit_price IS 'unit price after the line discount, rounded — informational; sum `amount`';
COMMENT ON COLUMN invoice_lines.amount IS 'the line total after its discount, exact — what every reader sums';

CREATE OR REPLACE FUNCTION app.invoice_line_amount_default() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount IS NULL THEN
    NEW.amount := NEW.qty * NEW.unit_price;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_lines_amount_default
  BEFORE INSERT ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION app.invoice_line_amount_default();

-- Payment methods: canonical spellings, then the fence for new rows.
UPDATE invoices SET method = CASE lower(btrim(method))
  WHEN 'cash' THEN 'Cash' WHEN 'card' THEN 'Card' WHEN 'gift card' THEN 'Gift card'
  WHEN 'bank transfer' THEN 'Bank transfer' WHEN 'online card' THEN 'Online card' WHEN 'apple pay' THEN 'Apple Pay'
  ELSE method END
  WHERE method <> CASE lower(btrim(method))
  WHEN 'cash' THEN 'Cash' WHEN 'card' THEN 'Card' WHEN 'gift card' THEN 'Gift card'
  WHEN 'bank transfer' THEN 'Bank transfer' WHEN 'online card' THEN 'Online card' WHEN 'apple pay' THEN 'Apple Pay'
  ELSE method END;
UPDATE merchant_transactions SET method = CASE lower(btrim(method))
  WHEN 'cash' THEN 'Cash' WHEN 'card' THEN 'Card' WHEN 'gift card' THEN 'Gift card'
  WHEN 'bank transfer' THEN 'Bank transfer' WHEN 'online card' THEN 'Online card' WHEN 'apple pay' THEN 'Apple Pay'
  ELSE method END
  WHERE method <> CASE lower(btrim(method))
  WHEN 'cash' THEN 'Cash' WHEN 'card' THEN 'Card' WHEN 'gift card' THEN 'Gift card'
  WHEN 'bank transfer' THEN 'Bank transfer' WHEN 'online card' THEN 'Online card' WHEN 'apple pay' THEN 'Apple Pay'
  ELSE method END;
ALTER TABLE invoices ADD CONSTRAINT invoices_method_check
  CHECK (method IN ('Cash','Card','Gift card','Bank transfer','Online card','Apple Pay')) NOT VALID;
ALTER TABLE merchant_transactions ADD CONSTRAINT merchant_transactions_method_check
  CHECK (method IN ('Cash','Card','Gift card','Bank transfer','Online card','Apple Pay')) NOT VALID;

-- migrate:down

ALTER TABLE merchant_transactions DROP CONSTRAINT merchant_transactions_method_check;
ALTER TABLE invoices DROP CONSTRAINT invoices_method_check;
DROP TRIGGER invoice_lines_amount_default ON invoice_lines;
DROP FUNCTION app.invoice_line_amount_default();
ALTER TABLE invoice_lines DROP COLUMN amount;
