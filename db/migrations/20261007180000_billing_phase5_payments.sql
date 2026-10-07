-- Invoicing phase 5 (Alex, 2026-10-07) — docs/INVOICING-PLAN.md J.5,
-- docs/INVOICING.md "Phase 5" and "Phase 4 follow-up".
--
-- Two things.
--
-- 1. The renderer binding (phase 4 follow-up). An issued document's
--    canonical PDF is bound to the renderer version that produced it:
--    `pdf_renderer` is written together with `pdf_sha256`, once, and
--    from then on neither may change or be cleared — not through the
--    API, not by an UPDATE. A later layout is a new renderer version;
--    old documents keep rendering with their own. The documents that
--    already carry a hash were all rendered by the only version that
--    has ever existed, so they are bound to it here.
--
-- 2. The payment ledger. `billing_payments` is the one source of truth
--    for money received against an issued document: append-only rows
--    (no UPDATE, no DELETE, for anyone), positive amounts only (a
--    reversal is phase 6's credit note, never a negative payment), in
--    the invoice's currency, with an explicit SOURCE beside the method:
--    `sale` (the originating till sale's own tender, imported by the
--    issue workflow — evidence of a payment that already happened, not
--    a payment Velnes processed), `manual` (a staff member recorded a
--    payment received outside Velnes), `provider` (reserved: a real
--    payment provider's verified event, later). The invoice's
--    `paid_minor` is a cache of the ledger, maintained under the
--    invoice's row lock and CHECKed never to exceed the gross; the
--    state (unpaid / partially paid / paid) is derived, never stored.
--
-- Issued documents that came from a paid till sale are backfilled
-- below from the sale's own figures, only where the sale still exists,
-- is Paid, and reconciles exactly with the document; anything else is
-- left unpaid for a person to look at.

-- migrate:up

-- ── 1. Renderer binding ───────────────────────────────────────────────
ALTER TABLE billing_invoices ADD COLUMN pdf_renderer text;

CREATE OR REPLACE FUNCTION app.billing_invoice_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable text[] := ARRAY['paid_minor','pdf_sha256','pdf_renderer','fiscal_receipt_ref','efaktura_euid','efaktura_status','updated_at','updated_by','updated_by_name'];
BEGIN
  IF OLD.status = 'issued' THEN
    IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
      RAISE EXCEPTION 'issued accounting invoice % is frozen', OLD.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- The canonical PDF, once established, is permanent: no clearing, no
  -- re-establishing, no other renderer.
  IF OLD.pdf_sha256 IS NOT NULL AND NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256 THEN
    RAISE EXCEPTION 'the canonical PDF hash of % is permanent', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.pdf_renderer IS NOT NULL AND NEW.pdf_renderer IS DISTINCT FROM OLD.pdf_renderer THEN
    RAISE EXCEPTION 'the renderer binding of % is permanent', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- Everything hashed so far came from the one renderer there has been.
UPDATE billing_invoices SET pdf_renderer = '2026.10.07-1' WHERE pdf_sha256 IS NOT NULL AND pdf_renderer IS NULL;
ALTER TABLE billing_invoices ADD CONSTRAINT billing_invoices_pdf_binding
  CHECK ((pdf_sha256 IS NULL) = (pdf_renderer IS NULL));

-- ── 2. The ledger ─────────────────────────────────────────────────────
CREATE TABLE billing_payments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES businesses(id),
  invoice_id             uuid NOT NULL REFERENCES billing_invoices(id),
  amount_minor           bigint NOT NULL CHECK (amount_minor > 0),
  currency               text NOT NULL,
  method                 text NOT NULL CHECK (method IN ('Cash','Card','Gift card','Bank transfer','Online card','Apple Pay')),
  source                 text NOT NULL CHECK (source IN ('sale','manual','provider')),
  paid_at                timestamptz NOT NULL,          -- when the money was received
  paid_on                date NOT NULL,                 -- that moment as the location's business day
  reference              text NOT NULL DEFAULT '',      -- a transfer id, a receipt number, later a provider's id
  provider               text,                          -- reserved: 'stripe', …
  provider_payment_id    text,                          -- reserved
  origin_sale_id         uuid REFERENCES invoices(id),  -- source 'sale': the till sale whose tender this is
  origin_key             text,                          -- idempotency: 'sale:<id>:tender', 'sale:<id>:gift', 'manual:<key>'
  note                   text NOT NULL DEFAULT '',
  recorded_by            uuid REFERENCES employees(id),
  recorded_by_name       text NOT NULL DEFAULT '',
  created_at             timestamptz NOT NULL DEFAULT now(),  -- when Velnes learned of it
  CHECK (source <> 'provider' OR provider IS NOT NULL),
  CHECK (source <> 'sale' OR origin_sale_id IS NOT NULL)
);
CREATE INDEX billing_payments_tenant_invoice ON billing_payments (tenant_id, invoice_id, paid_at);
CREATE UNIQUE INDEX billing_payments_origin ON billing_payments (tenant_id, origin_key) WHERE origin_key IS NOT NULL;
CREATE UNIQUE INDEX billing_payments_provider ON billing_payments (tenant_id, provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;
ALTER TABLE billing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON billing_payments FOR SELECT
  USING (tenant_id = app.current_tenant());
CREATE POLICY tenant_insert ON billing_payments FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY hq_read ON billing_payments FOR SELECT
  USING (current_setting('app.hq', true) = '1');
-- Append-only for everyone: a wrong payment is corrected by a later
-- document (phase 6), never by editing history.
CREATE OR REPLACE FUNCTION app.billing_payments_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'billing_payments is append-only' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER billing_payments_append_only BEFORE UPDATE OR DELETE ON billing_payments
  FOR EACH ROW EXECUTE FUNCTION app.billing_payments_append_only();
-- A payment belongs to an issued document in its own currency.
CREATE OR REPLACE FUNCTION app.billing_payment_fits() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE inv RECORD;
BEGIN
  SELECT status, currency INTO inv FROM billing_invoices WHERE id = NEW.invoice_id;
  IF inv.status IS DISTINCT FROM 'issued' THEN
    RAISE EXCEPTION 'a payment is recorded against an issued document only' USING ERRCODE = 'check_violation';
  END IF;
  IF inv.currency <> NEW.currency THEN
    RAISE EXCEPTION 'a payment is recorded in the document''s currency (%)', inv.currency USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER billing_payments_fit BEFORE INSERT ON billing_payments
  FOR EACH ROW EXECUTE FUNCTION app.billing_payment_fits();

-- The cache never exceeds the document.
ALTER TABLE billing_invoices ADD CONSTRAINT billing_invoices_paid_within
  CHECK (paid_minor >= 0 AND paid_minor <= gross_minor);

-- ── Backfill: sale-origin evidence for documents issued before the ledger ─
-- Only where the sale exists, is still Paid, and reconciles exactly with
-- the document (gross = total − tip − service charge + gift, in minor).
-- Idempotent: the origin keys are unique and existing rows are skipped.
INSERT INTO billing_payments (tenant_id, invoice_id, amount_minor, currency, method, source, paid_at, paid_on, origin_sale_id, origin_key, recorded_by_name)
SELECT b.tenant_id, b.id, s.gift_amount * 100, b.currency, 'Gift card', 'sale', s.created_at,
       (s.created_at AT TIME ZONE l.tz)::date, s.id, 'sale:' || s.id || ':gift', 'Velnes'
  FROM billing_invoices b
  JOIN invoices s ON s.id = b.origin_sale_id
  JOIN locations l ON l.id = b.location_id
 WHERE b.status = 'issued' AND b.kind = 'invoice' AND s.status = 'Paid' AND s.gift_amount > 0
   AND b.gross_minor = (s.total - s.tip - s.service_charge + s.gift_amount) * 100
   AND NOT EXISTS (SELECT 1 FROM billing_payments p WHERE p.invoice_id = b.id)
ON CONFLICT DO NOTHING;
INSERT INTO billing_payments (tenant_id, invoice_id, amount_minor, currency, method, source, paid_at, paid_on, origin_sale_id, origin_key, recorded_by_name)
SELECT b.tenant_id, b.id, (s.total - s.tip - s.service_charge) * 100, b.currency, s.method, 'sale', s.created_at,
       (s.created_at AT TIME ZONE l.tz)::date, s.id, 'sale:' || s.id || ':tender', 'Velnes'
  FROM billing_invoices b
  JOIN invoices s ON s.id = b.origin_sale_id
  JOIN locations l ON l.id = b.location_id
 WHERE b.status = 'issued' AND b.kind = 'invoice' AND s.status = 'Paid' AND (s.total - s.tip - s.service_charge) > 0
   AND s.method IN ('Cash','Card','Gift card','Bank transfer','Online card','Apple Pay')
   AND b.gross_minor = (s.total - s.tip - s.service_charge + s.gift_amount) * 100
   AND NOT EXISTS (SELECT 1 FROM billing_payments p WHERE p.invoice_id = b.id AND p.origin_key = 'sale:' || s.id || ':tender')
ON CONFLICT DO NOTHING;
UPDATE billing_invoices b
   SET paid_minor = x.paid
  FROM (SELECT invoice_id, sum(amount_minor) AS paid FROM billing_payments GROUP BY invoice_id) x
 WHERE x.invoice_id = b.id AND b.paid_minor <> x.paid;

-- ── billing.record_payment ────────────────────────────────────────────
-- Owner-shaped roles at business; roles that take money at the till
-- (pos.checkout) may record money received at the same scope — the
-- desk that takes a card today records a bank transfer tomorrow.
UPDATE roles
   SET perms = perms || '{"billing.record_payment": "business"}'::jsonb
 WHERE perms->>'users.manage' = 'business'
   AND coalesce(perms->>'billing.record_payment', 'none') = 'none';
UPDATE roles
   SET perms = perms || jsonb_build_object('billing.record_payment', perms->>'pos.checkout')
 WHERE perms->>'pos.checkout' IS NOT NULL AND perms->>'pos.checkout' <> 'none'
   AND coalesce(perms->>'billing.record_payment', 'none') = 'none';

-- migrate:down

UPDATE roles SET perms = perms - 'billing.record_payment';
ALTER TABLE billing_invoices DROP CONSTRAINT billing_invoices_paid_within;
DROP TRIGGER billing_payments_fit ON billing_payments;
DROP FUNCTION app.billing_payment_fits();
DROP TRIGGER billing_payments_append_only ON billing_payments;
DROP FUNCTION app.billing_payments_append_only();
DROP TABLE billing_payments;
CREATE OR REPLACE FUNCTION app.billing_invoice_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable text[] := ARRAY['paid_minor','pdf_sha256','fiscal_receipt_ref','efaktura_euid','efaktura_status','updated_at','updated_by','updated_by_name'];
BEGIN
  IF OLD.status = 'issued' THEN
    IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
      RAISE EXCEPTION 'issued accounting invoice % is frozen', OLD.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
ALTER TABLE billing_invoices DROP CONSTRAINT billing_invoices_pdf_binding;
ALTER TABLE billing_invoices DROP COLUMN pdf_renderer;
