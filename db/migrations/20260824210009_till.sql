-- migrate:up

-- Till & checkout: invoices with per-location numbering, the
-- multi-merchant checkout split, gift cards, discount codes, the
-- loyalty ledger (points are money the salon owes), service recipes
-- (own-use consumption per treatment), reserved tax rules.

CREATE TYPE invoice_status AS ENUM ('Paid','Refunded');
CREATE TYPE checkout_status AS ENUM ('PAID','PARTIALLY_PAID','FAILED');
CREATE TYPE mtx_status AS ENUM ('paid','failed','config_incomplete');
CREATE TYPE discount_code_type AS ENUM ('Percentage','Fixed amount');

CREATE TABLE invoice_counters (
  tenant_id   uuid NOT NULL REFERENCES businesses(id),
  location_id uuid NOT NULL REFERENCES locations(id),
  next        integer NOT NULL DEFAULT 1,
  PRIMARY KEY (location_id)
);
ALTER TABLE invoice_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoice_counters
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE invoices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES businesses(id),
  location_id   uuid NOT NULL REFERENCES locations(id),
  number        text NOT NULL,
  date          date NOT NULL DEFAULT now(),
  customer_id   uuid REFERENCES customers(id),
  customer_name text NOT NULL DEFAULT 'Walk-in',
  employee_id   uuid REFERENCES employees(id),
  employee_name text NOT NULL DEFAULT '',
  method        text NOT NULL,
  status        invoice_status NOT NULL DEFAULT 'Paid',
  total         integer NOT NULL,
  tip           integer NOT NULL DEFAULT 0,
  service_charge integer NOT NULL DEFAULT 0,
  cart_discount integer NOT NULL DEFAULT 0,
  points_redeemed integer NOT NULL DEFAULT 0,
  gift_amount   integer NOT NULL DEFAULT 0,
  promo_code    text,
  promo_amount  integer NOT NULL DEFAULT 0,
  idempotency_key text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);
CREATE UNIQUE INDEX invoices_idempotency
  ON invoices (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX invoices_tenant ON invoices (tenant_id, location_id, date DESC);
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoices
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE invoice_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES businesses(id),
  invoice_id   uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description  text NOT NULL,
  qty          integer NOT NULL DEFAULT 1,
  unit_price   integer NOT NULL,           -- after line discount
  line_discount integer NOT NULL DEFAULT 0,
  item_class   text NOT NULL DEFAULT 'other', -- service | product | other
  service_id   uuid REFERENCES services(id),
  product_id   uuid REFERENCES products(id),
  appointment_id uuid REFERENCES appointments(id),
  vat          integer NOT NULL DEFAULT 18,
  sort         integer NOT NULL DEFAULT 0
);
CREATE INDEX invoice_lines_tenant ON invoice_lines (tenant_id, invoice_id);
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoice_lines
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE checkouts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES businesses(id),
  invoice_id  uuid NOT NULL REFERENCES invoices(id),
  ts          timestamptz NOT NULL DEFAULT now(),
  customer_id uuid REFERENCES customers(id),
  total       integer NOT NULL,
  status      checkout_status NOT NULL DEFAULT 'FAILED'
);
CREATE INDEX checkouts_tenant ON checkouts (tenant_id, ts DESC);
ALTER TABLE checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkouts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON checkouts
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE merchant_transactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES businesses(id),
  checkout_id   uuid NOT NULL REFERENCES checkouts(id) ON DELETE CASCADE,
  payment_account_id uuid REFERENCES payment_accounts(id),
  legal_entity_id uuid REFERENCES legal_entities(id),
  amount        integer NOT NULL,
  method        text NOT NULL,
  status        mtx_status NOT NULL,
  provider_ref  text,                     -- reserved: payment provider
  legal_doc_ref text,                     -- reserved: fiscalization
  idempotency_key text NOT NULL UNIQUE,   -- never changes across retries
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX merchant_transactions_tenant ON merchant_transactions (tenant_id, checkout_id);
ALTER TABLE merchant_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON merchant_transactions
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE checkout_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES businesses(id),
  checkout_id   uuid NOT NULL REFERENCES checkouts(id) ON DELETE CASCADE,
  name          text NOT NULL,
  qty           integer NOT NULL DEFAULT 1,
  amount        integer NOT NULL,
  item_class    text NOT NULL,
  seller_legal_entity_id uuid REFERENCES legal_entities(id),
  tax_profile_id text,                    -- reserved: fiscal profile
  merchant_transaction_id uuid REFERENCES merchant_transactions(id)
);
CREATE INDEX checkout_items_tenant ON checkout_items (tenant_id, checkout_id);
ALTER TABLE checkout_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkout_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON checkout_items
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE gift_cards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES businesses(id),
  code        text NOT NULL,
  value       integer NOT NULL,
  remaining   integer NOT NULL CHECK (remaining >= 0),
  customer_id uuid REFERENCES customers(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_cards FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gift_cards
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE discount_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES businesses(id),
  code        text NOT NULL,
  type        discount_code_type NOT NULL,
  value       integer NOT NULL,
  used        integer NOT NULL DEFAULT 0,
  usage_limit integer,
  starts      date NOT NULL,
  ends        date NOT NULL,
  UNIQUE (tenant_id, code)
);
ALTER TABLE discount_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON discount_codes
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE loyalty_config (
  tenant_id   uuid PRIMARY KEY REFERENCES businesses(id),
  active      boolean NOT NULL DEFAULT true,
  earn_per    integer NOT NULL DEFAULT 60,   -- spend this…
  points      integer NOT NULL DEFAULT 1,    -- …earn this
  step        integer NOT NULL DEFAULT 100,  -- redeem in steps of…
  worth       integer NOT NULL DEFAULT 300,  -- …worth this much
  expiry_months integer NOT NULL DEFAULT 24,
  welcome     integer NOT NULL DEFAULT 25,
  birthday    integer NOT NULL DEFAULT 50
);
ALTER TABLE loyalty_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON loyalty_config
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

-- Points are money the salon owes: a ledger, never a bare number.
CREATE TABLE loyalty_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES businesses(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  at          date NOT NULL DEFAULT now(),
  reason      text NOT NULL,
  points      integer NOT NULL,
  ref         text NOT NULL DEFAULT '—'
);
CREATE INDEX loyalty_ledger_tenant ON loyalty_ledger (tenant_id, customer_id, at);
ALTER TABLE loyalty_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_ledger FORCE ROW LEVEL SECURITY;
-- Append-only for the API role.
CREATE POLICY tenant_read ON loyalty_ledger FOR SELECT
  USING (tenant_id = app.current_tenant());
CREATE POLICY tenant_append ON loyalty_ledger FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant());

-- What one treatment consumes of the own-use stock.
CREATE TABLE service_recipes (
  tenant_id   uuid NOT NULL REFERENCES businesses(id),
  service_id  uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty_amount  numeric(10,2) NOT NULL,     -- in the product's unit
  PRIMARY KEY (service_id, product_id)
);
CREATE INDEX service_recipes_tenant ON service_recipes (tenant_id, product_id);
ALTER TABLE service_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_recipes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON service_recipes
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

-- Reserved-honest: which fiscal/tax profile applies per item class and
-- legal entity. Fiscalization is undecided; the door returns NULL.
CREATE TABLE tax_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid REFERENCES businesses(id),  -- NULL = platform default
  legal_entity_id uuid REFERENCES legal_entities(id), -- NULL = any
  item_class     text NOT NULL,
  tax_profile_id text
);
ALTER TABLE tax_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tax_rules
  USING (tenant_id = app.current_tenant() OR tenant_id IS NULL)
  WITH CHECK (tenant_id = app.current_tenant());

-- migrate:down

DROP TABLE tax_rules;
DROP TABLE service_recipes;
DROP TABLE loyalty_ledger;
DROP TABLE loyalty_config;
DROP TABLE discount_codes;
DROP TABLE gift_cards;
DROP TABLE checkout_items;
DROP TABLE merchant_transactions;
DROP TABLE checkouts;
DROP TABLE invoice_lines;
DROP TABLE invoices;
DROP TABLE invoice_counters;
DROP TYPE discount_code_type;
DROP TYPE mtx_status;
DROP TYPE checkout_status;
DROP TYPE invoice_status;
