-- Invoicing phase 3 (Alex, 2026-10-07) — docs/INVOICING-PLAN.md J.3,
-- docs/INVOICING.md "Phase 3".
--
-- The transition draft → issued. Four things arrive:
--
--   billing_sequences  the counter per legal entity × series × year
--                      (year 0 when the series does not reset yearly),
--                      advanced ONLY inside the issue transaction by an
--                      upsert-increment on its row — the row lock makes
--                      concurrent issues queue, the transaction makes a
--                      failed issue give its number back. Never
--                      MAX(number)+1.
--   billing_events     the document's own append-only timeline
--                      (created / edited / issued …): no UPDATE, no
--                      DELETE, for anyone — enforced by trigger, not
--                      only by the absence of a policy.
--   billing_assets     content-addressed, immutable copies of the
--                      branding an issued document used (today: the
--                      logo). An issued invoice references the asset
--                      by its SHA-256 from its issuer snapshot, so the
--                      profile's logo may change tomorrow without
--                      touching yesterday's invoice, and a thousand
--                      invoices with the same logo store it once.
--   issue columns      issue_key (the issue door's idempotency key),
--                      issued_by / issued_by_name; the rendered number
--                      becomes unique per legal entity on its own,
--                      beside the (entity, series, year, seq) index.
--
-- The frozen-row trigger becomes a whitelist: once issued, the ONLY
-- columns of billing_invoices that may change are the integration /
-- cache ones (paid_minor, pdf_sha256, fiscal_receipt_ref, efaktura_*)
-- and the updated_* stamps. Everything else — number, series, year,
-- sequence, entity, location, origin, every snapshot, dates, currency,
-- VAT state, money, breakdown, notes, status itself — is a historical
-- fact. An issued row also refuses DELETE at the trigger level.

-- migrate:up

-- ── Sequences ─────────────────────────────────────────────────────────
CREATE TABLE billing_sequences (
  tenant_id        uuid NOT NULL REFERENCES businesses(id),
  legal_entity_id  uuid NOT NULL REFERENCES legal_entities(id),
  series           text NOT NULL,                 -- the configured prefix of the kind ('' for the default invoice series)
  year             integer NOT NULL,              -- the legal issue year, or 0 for a series that never resets
  last_seq         integer NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, legal_entity_id, series, year)
);
ALTER TABLE billing_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_sequences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON billing_sequences
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY hq_read ON billing_sequences FOR SELECT
  USING (current_setting('app.hq', true) = '1');
-- No DELETE policy: a counter is never removed.

-- ── Events ────────────────────────────────────────────────────────────
CREATE TABLE billing_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES businesses(id),
  invoice_id         uuid NOT NULL REFERENCES billing_invoices(id),
  at                 timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_employee_id  uuid REFERENCES employees(id),
  actor_name         text NOT NULL DEFAULT '',
  source             text NOT NULL DEFAULT 'API',
  kind               text NOT NULL CHECK (kind IN ('created','edited','issued','payment','credit_note','void','pdf','emailed','fiscal_ref','efaktura')),
  data               jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX billing_events_tenant_invoice ON billing_events (tenant_id, invoice_id, at);
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON billing_events FOR SELECT
  USING (tenant_id = app.current_tenant());
CREATE POLICY tenant_insert ON billing_events FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY hq_read ON billing_events FOR SELECT
  USING (current_setting('app.hq', true) = '1');
-- Append-only for everyone, the database owner included.
CREATE OR REPLACE FUNCTION app.billing_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'billing_events is append-only' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER billing_events_append_only BEFORE UPDATE OR DELETE ON billing_events
  FOR EACH ROW EXECUTE FUNCTION app.billing_events_append_only();

-- Drafts that exist already get their 'created' event from their own row.
INSERT INTO billing_events (tenant_id, invoice_id, at, actor_employee_id, actor_name, source, kind, data)
SELECT tenant_id, id, created_at, created_by, created_by_name, 'API', 'created',
       jsonb_build_object('grossMinor', gross_minor, 'currency', currency, 'originSaleId', origin_sale_id)
  FROM billing_invoices;

-- ── Assets ────────────────────────────────────────────────────────────
CREATE TABLE billing_assets (
  tenant_id   uuid NOT NULL REFERENCES businesses(id),
  sha256      text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  kind        text NOT NULL CHECK (kind IN ('logo')),
  mime        text NOT NULL,
  bytes       integer NOT NULL CHECK (bytes > 0),
  data        text NOT NULL,                      -- the data URL, exactly as the profile held it
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sha256)
);
ALTER TABLE billing_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON billing_assets FOR SELECT
  USING (tenant_id = app.current_tenant());
CREATE POLICY tenant_insert ON billing_assets FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY hq_read ON billing_assets FOR SELECT
  USING (current_setting('app.hq', true) = '1');
-- Content-addressed: the row IS its content, so it never changes.
CREATE OR REPLACE FUNCTION app.billing_assets_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'billing_assets are immutable' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER billing_assets_immutable BEFORE UPDATE OR DELETE ON billing_assets
  FOR EACH ROW EXECUTE FUNCTION app.billing_assets_immutable();

-- ── Issue columns ─────────────────────────────────────────────────────
ALTER TABLE billing_invoices
  ADD COLUMN issue_key       text,
  ADD COLUMN issued_by       uuid REFERENCES employees(id),
  ADD COLUMN issued_by_name  text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX billing_invoices_issue_key ON billing_invoices (tenant_id, issue_key)
  WHERE issue_key IS NOT NULL;
-- The rendered number is unique per legal entity in its own right —
-- whatever the configuration did, two issued documents never read alike.
CREATE UNIQUE INDEX billing_invoices_number_text ON billing_invoices (legal_entity_id, number)
  WHERE number IS NOT NULL;
-- An issued document has every numbering fact, a draft none of them.
ALTER TABLE billing_invoices ADD CONSTRAINT billing_invoices_issued_shape CHECK (
  (status = 'draft' AND number IS NULL AND number_seq IS NULL AND series IS NULL AND year IS NULL AND issue_date IS NULL AND issued_at IS NULL)
  OR (status <> 'draft' AND number IS NOT NULL AND number_seq IS NOT NULL AND series IS NOT NULL AND year IS NOT NULL AND issue_date IS NOT NULL AND issued_at IS NOT NULL)
);

-- ── The freeze, as a whitelist ────────────────────────────────────────
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
-- (the BEFORE UPDATE trigger billing_invoices_frozen already calls it)

CREATE OR REPLACE FUNCTION app.billing_invoice_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'issued' THEN
    RAISE EXCEPTION 'issued accounting invoice % cannot be deleted', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER billing_invoices_no_delete BEFORE DELETE ON billing_invoices
  FOR EACH ROW EXECUTE FUNCTION app.billing_invoice_no_delete();

-- ── billing.issue ─────────────────────────────────────────────────────
-- Conservative: only owner-shaped roles (users.manage at business) may
-- issue a legal document. Drafting (billing.create) does not imply it;
-- a salon widens it by hand in Roles.
UPDATE roles
   SET perms = perms || '{"billing.issue": "business"}'::jsonb
 WHERE perms->>'users.manage' = 'business'
   AND coalesce(perms->>'billing.issue', 'none') = 'none';

-- migrate:down

UPDATE roles SET perms = perms - 'billing.issue';
DROP TRIGGER billing_invoices_no_delete ON billing_invoices;
DROP FUNCTION app.billing_invoice_no_delete();
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
ALTER TABLE billing_invoices DROP CONSTRAINT billing_invoices_issued_shape;
DROP INDEX billing_invoices_number_text;
DROP INDEX billing_invoices_issue_key;
ALTER TABLE billing_invoices DROP COLUMN issued_by_name, DROP COLUMN issued_by, DROP COLUMN issue_key;
DROP TRIGGER billing_assets_immutable ON billing_assets;
DROP FUNCTION app.billing_assets_immutable();
DROP TABLE billing_assets;
DROP TRIGGER billing_events_append_only ON billing_events;
DROP FUNCTION app.billing_events_append_only();
DROP TABLE billing_events;
DROP TABLE billing_sequences;
