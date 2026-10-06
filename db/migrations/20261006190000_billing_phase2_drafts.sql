-- Invoicing phase 2 (Alex, 2026-10-06) — docs/INVOICING-PLAN.md J.2,
-- docs/INVOICING.md "Phase 2".
--
-- The accounting invoice as a DRAFT: a document a legal entity will
-- issue, built from a till sale and carrying snapshots of everything
-- it will print — issuer (legal entity + billing profile + brand),
-- place of supply (location, with its clock), buyer (billing identity)
-- and the sale's lines with their money already computed by the one
-- billing-math door. Nothing here numbers or issues: `number` and
-- `issued_at` stay NULL, `status` is 'draft'; the other statuses and
-- kinds are reserved so phase 3 adds no column. One accounting invoice
-- per sale, enforced by the partial unique index. Money is in minor
-- units (deni), the sale's whole denars × 100.
--
-- The issued-row trigger is schema preparation for phase 3: once a
-- document is issued, only the columns a later phase may touch
-- (payments cache, document hash, fiscal/e-invoice references) change;
-- everything financial is frozen at the database.

-- migrate:up

CREATE TABLE billing_invoices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES businesses(id),
  legal_entity_id       uuid NOT NULL REFERENCES legal_entities(id),
  location_id           uuid NOT NULL REFERENCES locations(id),
  billing_customer_id   uuid REFERENCES billing_customers(id) ON DELETE SET NULL,
  kind                  text NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice','credit_note','debit_note','advance_invoice')),
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','void')),
  series                text,                        -- phase 3
  number                text,                        -- phase 3: given once, at issue
  number_seq            integer,                     -- phase 3
  year                  integer,                     -- phase 3
  corrects_invoice_id   uuid REFERENCES billing_invoices(id),   -- credit notes, later
  origin_sale_id        uuid REFERENCES invoices(id),
  origin_appointment_id uuid REFERENCES appointments(id),
  idempotency_key       text,
  currency              text NOT NULL,
  vat_registered        boolean NOT NULL,
  prices_include_vat    boolean NOT NULL DEFAULT true,
  supply_date           date NOT NULL,
  issue_date            date,                        -- phase 3
  due_date              date,
  issued_at             timestamptz,                 -- phase 3
  voided_at             timestamptz,
  issuer                jsonb NOT NULL,
  buyer                 jsonb,
  location              jsonb NOT NULL,
  origin                jsonb NOT NULL DEFAULT '{}'::jsonb,
  net_minor             bigint NOT NULL,
  vat_minor             bigint NOT NULL,
  gross_minor           bigint NOT NULL,
  discount_minor        bigint NOT NULL DEFAULT 0,
  vat_breakdown         jsonb NOT NULL DEFAULT '[]'::jsonb,
  paid_minor            bigint NOT NULL DEFAULT 0,   -- phase 5
  pdf_sha256            text,                        -- phase 4
  fiscal_receipt_ref    text,                        -- reserved: external fiscal device
  efaktura_euid         text,                        -- reserved: UJP e-Faktura
  efaktura_status       text,
  notes                 text NOT NULL DEFAULT '',
  created_by            uuid REFERENCES employees(id),
  created_by_name       text NOT NULL DEFAULT '',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid REFERENCES employees(id),
  updated_by_name       text NOT NULL DEFAULT '',
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (net_minor + vat_minor = gross_minor)
);
CREATE INDEX billing_invoices_tenant ON billing_invoices (tenant_id, status, supply_date DESC);
CREATE INDEX billing_invoices_tenant_loc ON billing_invoices (tenant_id, location_id, supply_date DESC);
CREATE INDEX billing_invoices_tenant_customer ON billing_invoices (tenant_id, billing_customer_id);
-- One accounting invoice per sale: a double click, a retry, two desks
-- at once — the second one finds the first.
CREATE UNIQUE INDEX billing_invoices_origin_sale ON billing_invoices (tenant_id, origin_sale_id)
  WHERE origin_sale_id IS NOT NULL AND kind = 'invoice' AND status <> 'void';
CREATE UNIQUE INDEX billing_invoices_idempotency ON billing_invoices (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX billing_invoices_number ON billing_invoices (legal_entity_id, series, year, number_seq)
  WHERE status = 'issued';
ALTER TABLE billing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON billing_invoices
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY hq_read ON billing_invoices FOR SELECT
  USING (current_setting('app.hq', true) = '1');
-- No DELETE policy: an accounting document is never deleted.

CREATE TABLE billing_invoice_lines (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES businesses(id),
  invoice_id                uuid NOT NULL REFERENCES billing_invoices(id),
  sort                      integer NOT NULL DEFAULT 0,
  item_class                text NOT NULL CHECK (item_class IN ('service','product','other')),
  service_id                uuid REFERENCES services(id),
  product_id                uuid REFERENCES products(id),
  appointment_id            uuid REFERENCES appointments(id),
  till_line_id              uuid REFERENCES invoice_lines(id),
  description               text NOT NULL,
  employee_name             text NOT NULL DEFAULT '',
  unit                      text NOT NULL DEFAULT 'pc',
  qty_milli                 integer NOT NULL CHECK (qty_milli > 0),
  unit_price_minor          bigint NOT NULL,          -- informational: source ÷ qty, rounded
  source_amount_minor       bigint NOT NULL,          -- the till line's exact amount × 100
  allocated_discount_minor  bigint NOT NULL DEFAULT 0,
  vat_rate_bp               integer NOT NULL CHECK (vat_rate_bp BETWEEN 0 AND 10000),
  exempt                    boolean NOT NULL DEFAULT false,
  net_minor                 bigint NOT NULL,
  vat_minor                 bigint NOT NULL,
  gross_minor               bigint NOT NULL,
  CHECK (net_minor + vat_minor = gross_minor),
  CHECK (gross_minor = source_amount_minor - allocated_discount_minor)
);
CREATE INDEX billing_invoice_lines_tenant ON billing_invoice_lines (tenant_id, invoice_id, sort);
ALTER TABLE billing_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_invoice_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON billing_invoice_lines
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY hq_read ON billing_invoice_lines FOR SELECT
  USING (current_setting('app.hq', true) = '1');

-- Phase 3 preparation: an issued document's money and identity never
-- change; its lines never change at all.
CREATE OR REPLACE FUNCTION app.billing_invoice_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'issued' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.number IS DISTINCT FROM OLD.number
       OR NEW.issuer IS DISTINCT FROM OLD.issuer
       OR NEW.buyer IS DISTINCT FROM OLD.buyer
       OR NEW.location IS DISTINCT FROM OLD.location
       OR NEW.origin IS DISTINCT FROM OLD.origin
       OR NEW.net_minor <> OLD.net_minor OR NEW.vat_minor <> OLD.vat_minor
       OR NEW.gross_minor <> OLD.gross_minor OR NEW.discount_minor <> OLD.discount_minor
       OR NEW.vat_breakdown IS DISTINCT FROM OLD.vat_breakdown
       OR NEW.currency <> OLD.currency OR NEW.vat_registered <> OLD.vat_registered
       OR NEW.legal_entity_id <> OLD.legal_entity_id OR NEW.location_id <> OLD.location_id
       OR NEW.origin_sale_id IS DISTINCT FROM OLD.origin_sale_id
       OR NEW.supply_date <> OLD.supply_date OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
       OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
    THEN
      RAISE EXCEPTION 'issued accounting invoice % is frozen', OLD.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER billing_invoices_frozen BEFORE UPDATE ON billing_invoices
  FOR EACH ROW EXECUTE FUNCTION app.billing_invoice_frozen();

CREATE OR REPLACE FUNCTION app.billing_invoice_lines_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM billing_invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF s = 'issued' THEN
    RAISE EXCEPTION 'lines of an issued accounting invoice are frozen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER billing_invoice_lines_frozen BEFORE INSERT OR UPDATE OR DELETE ON billing_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION app.billing_invoice_lines_frozen();

-- billing.read: whoever may create billing details may see the
-- accounting documents at the same scope; owner-shaped roles see all.
UPDATE roles
   SET perms = perms || '{"billing.read": "business"}'::jsonb
 WHERE perms->>'users.manage' = 'business'
   AND coalesce(perms->>'billing.read', 'none') = 'none';
UPDATE roles
   SET perms = perms || jsonb_build_object('billing.read', perms->>'billing.create')
 WHERE perms->>'billing.create' IS NOT NULL AND perms->>'billing.create' <> 'none'
   AND coalesce(perms->>'billing.read', 'none') = 'none';

-- migrate:down

UPDATE roles SET perms = perms - 'billing.read';
DROP TRIGGER billing_invoice_lines_frozen ON billing_invoice_lines;
DROP FUNCTION app.billing_invoice_lines_frozen();
DROP TRIGGER billing_invoices_frozen ON billing_invoices;
DROP FUNCTION app.billing_invoice_frozen();
DROP TABLE billing_invoice_lines;
DROP TABLE billing_invoices;
