-- Invoicing phase 1 (Alex, 2026-10-06) — docs/INVOICING-PLAN.md J.1,
-- docs/INVOICING.md.
--
-- The issuer of an accounting invoice is the LEGAL ENTITY — never the
-- salon brand, never a location. Ownership of each identity field:
--   legal_entities  → legal name (`name`), ЕДБ (`tax_id`), VAT number
--                     (`vat_reg`), ЕМБС (`embs`, added here), currency,
--                     verification status. HQ verifies name and ЕДБ at
--                     registration; the salon may fill ЕМБС and an
--                     empty VAT number itself through the billing door.
--   billing_profiles → everything the entity needs to invoice that is
--                     configuration, not identity: the registered seat
--                     address, "VAT registered" as the salon declares
--                     it, bank, series, defaults, signatory, branding.
--   businesses       → the trading/brand name a profile may override.
--   locations        → the place of supply, its address and its clock.
-- One profile per legal entity; a legal entity serves every location
-- linked to it without repeating its billing identity.
--
-- Billing identities (`billing_customers`) are the buyer side: a person
-- or a company, optionally linked to a Velnes customer, never required
-- to be — a walk-in or a manual invoice needs one too. Electronic
-- invoice consent (ЗДДВ чл. 53-б) is an explicit act: the current state
-- sits on the identity, every grant and withdrawal is an append-only
-- event so a later document can prove what stood when it was sent.
--
-- Nothing here is required for a sale: completeness binds only when an
-- accounting invoice is issued (a later phase).

-- migrate:up

ALTER TABLE legal_entities ADD COLUMN embs text;
COMMENT ON COLUMN legal_entities.embs IS 'ЕМБС — the company register number; identity, beside tax_id (ЕДБ) and vat_reg';

CREATE TABLE billing_profiles (
  tenant_id            uuid NOT NULL REFERENCES businesses(id),
  legal_entity_id      uuid NOT NULL REFERENCES legal_entities(id) ON DELETE CASCADE,
  trading_name         text,                      -- NULL = the business name
  address              text NOT NULL DEFAULT '',
  city                 text NOT NULL DEFAULT '',
  zip                  text NOT NULL DEFAULT '',
  country              text NOT NULL DEFAULT 'North Macedonia',
  vat_registered       boolean NOT NULL DEFAULT false,
  bank_name            text NOT NULL DEFAULT '',
  bank_account         text NOT NULL DEFAULT '',
  default_currency     text NOT NULL DEFAULT 'MKD',
  invoice_prefix       text NOT NULL DEFAULT '',   -- '' → 2026-000001
  credit_prefix        text NOT NULL DEFAULT 'KO-',
  yearly_reset         boolean NOT NULL DEFAULT true,
  number_width         integer NOT NULL DEFAULT 6 CHECK (number_width BETWEEN 4 AND 8),
  default_vat_rate_bp  integer NOT NULL DEFAULT 1800 CHECK (default_vat_rate_bp BETWEEN 0 AND 10000),
  prices_include_vat   boolean NOT NULL DEFAULT true,
  footer_text          text NOT NULL DEFAULT '',
  payment_instructions text NOT NULL DEFAULT '',
  signatory_name       text NOT NULL DEFAULT '',
  contact_email        text NOT NULL DEFAULT '',
  phone                text NOT NULL DEFAULT '',
  website              text NOT NULL DEFAULT '',
  logo                 text,                      -- data URL, like avatars
  issue_mode           text NOT NULL DEFAULT 'draft' CHECK (issue_mode IN ('draft','auto')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, legal_entity_id),
  UNIQUE (legal_entity_id)
);
ALTER TABLE billing_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON billing_profiles
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY hq_read ON billing_profiles FOR SELECT
  USING (current_setting('app.hq', true) = '1');

CREATE TABLE billing_customers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES businesses(id),
  customer_id           uuid REFERENCES customers(id) ON DELETE SET NULL,
  kind                  text NOT NULL CHECK (kind IN ('person','company')),
  name                  text NOT NULL,            -- the person, or the legal company name
  address               text NOT NULL DEFAULT '',
  city                  text NOT NULL DEFAULT '',
  zip                   text NOT NULL DEFAULT '',
  country               text NOT NULL DEFAULT 'North Macedonia',
  edb                   text NOT NULL DEFAULT '',
  vat_reg_no            text NOT NULL DEFAULT '',
  email                 text NOT NULL DEFAULT '',
  phone                 text NOT NULL DEFAULT '',
  consent_electronic_at timestamptz,              -- current state; history in billing_consent_events
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_customers_tenant ON billing_customers (tenant_id, customer_id);
CREATE INDEX billing_customers_tenant_name ON billing_customers (tenant_id, lower(name));
ALTER TABLE billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_customers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON billing_customers
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE billing_consent_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES businesses(id),
  billing_customer_id  uuid NOT NULL REFERENCES billing_customers(id) ON DELETE CASCADE,
  granted              boolean NOT NULL,
  at                   timestamptz NOT NULL DEFAULT now(),
  actor_employee_id    uuid REFERENCES employees(id),
  actor_name           text NOT NULL DEFAULT '',
  note                 text NOT NULL DEFAULT ''
);
CREATE INDEX billing_consent_events_tenant ON billing_consent_events (tenant_id, billing_customer_id, at DESC);
ALTER TABLE billing_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_consent_events FORCE ROW LEVEL SECURITY;
-- Append + read only: no UPDATE/DELETE policy exists, so consent history
-- is immutable for the API role, like the audit log.
CREATE POLICY tenant_read ON billing_consent_events FOR SELECT USING (tenant_id = app.current_tenant());
CREATE POLICY tenant_append ON billing_consent_events FOR INSERT WITH CHECK (tenant_id = app.current_tenant());

-- Permissions: the roles that run the business (users.manage at
-- business scope — the standard Owner and any role shaped like it) set
-- up invoicing and create billing details; a role that takes payments
-- (pos.checkout) may create billing details at the scope it sells at,
-- and nothing more. New roles take the vocabulary's own defaults.
UPDATE roles
   SET perms = perms || '{"billing.settings": "business", "billing.create": "business"}'::jsonb
 WHERE perms->>'users.manage' = 'business'
   AND coalesce(perms->>'billing.settings', 'none') = 'none';
UPDATE roles
   SET perms = perms || jsonb_build_object('billing.create', perms->>'pos.checkout')
 WHERE perms->>'pos.checkout' IS NOT NULL AND perms->>'pos.checkout' <> 'none'
   AND coalesce(perms->>'billing.create', 'none') = 'none';

-- migrate:down

UPDATE roles SET perms = perms - 'billing.settings' - 'billing.create';
DROP TABLE billing_consent_events;
DROP TABLE billing_customers;
DROP TABLE billing_profiles;
ALTER TABLE legal_entities DROP COLUMN embs;
