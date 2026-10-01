-- Products with a booking (Alex, 2026-10-01): a customer booking a visit
-- in the Velnes app can add products from the salon's shelf to it.
--
-- A reservation, not a sale. The row records what was asked for, at the
-- shelf price of that moment, against the visit's first appointment. The
-- money moves where it always has: the till's invoice — online through
-- the app's pay door (which adds these as product lines to the same
-- invoice as the treatment) or at the venue, where the till pre-fills the
-- basket from these rows. Stock moves only when the invoice is written,
-- exactly as a product sold over the counter.

-- migrate:up

CREATE TABLE appointment_products (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES businesses(id),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  product_id     uuid NOT NULL REFERENCES products(id),
  name           text NOT NULL,                      -- as it read when booked
  qty            integer NOT NULL CHECK (qty > 0),
  unit_price     integer NOT NULL CHECK (unit_price >= 0), -- shelf price when booked, MKD
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appointment_products_appt ON appointment_products (tenant_id, appointment_id);
CREATE UNIQUE INDEX appointment_products_once ON appointment_products (appointment_id, product_id);

ALTER TABLE appointment_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_products FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON appointment_products
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY hq_read ON appointment_products FOR SELECT
  USING (current_setting('app.hq', true) = '1');

-- migrate:down

DROP TABLE appointment_products;
