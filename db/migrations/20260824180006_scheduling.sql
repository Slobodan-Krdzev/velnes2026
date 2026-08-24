-- migrate:up

-- Scheduling: exceptions over weekly hours, platform holiday
-- calendars, minimal customers (Phase 9 extends), appointments with
-- frozen prep/reset + idempotency, holds, appointment history.

CREATE TYPE schedule_exception_type AS ENUM ('CLOSED','CUSTOM_HOURS');
CREATE TYPE schedule_exception_source AS ENUM ('MANUAL','PUBLIC_HOLIDAY');
CREATE TYPE appointment_kind AS ENUM ('appointment','blocked','absence','chore','note');
CREATE TYPE appointment_status AS ENUM ('booked','confirmed','cancelled','no_show');

CREATE TABLE schedule_exceptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES businesses(id),
  location_id uuid NOT NULL REFERENCES locations(id),
  start_date  date NOT NULL,
  end_date    date,                      -- NULL = one day
  type        schedule_exception_type NOT NULL,
  periods     jsonb,                     -- [["10:00","14:00"],…] CUSTOM_HOURS only
  reason      text,
  source      schedule_exception_source NOT NULL DEFAULT 'MANUAL',
  holiday_id  text,                      -- which holiday it came from
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX schedule_exceptions_tenant ON schedule_exceptions (tenant_id, location_id, start_date);
ALTER TABLE schedule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_exceptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON schedule_exceptions
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

-- Platform reference data: holiday calendars per country. Readable by
-- every tenant, written by nobody but ops/HQ (no write policies).
CREATE TABLE holiday_calendar_years (
  country_code text NOT NULL,
  country_name text NOT NULL,
  year         integer NOT NULL,
  verified     boolean NOT NULL DEFAULT false,
  source       text NOT NULL DEFAULT '',
  PRIMARY KEY (country_code, year)
);
ALTER TABLE holiday_calendar_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE holiday_calendar_years FORCE ROW LEVEL SECURITY;
CREATE POLICY read_all ON holiday_calendar_years FOR SELECT USING (true);

CREATE TABLE holidays (
  id           text PRIMARY KEY,          -- e.g. 'mk-2026-01-01'
  country_code text NOT NULL,
  year         integer NOT NULL,
  date         date NOT NULL,
  name         text NOT NULL,
  type         text NOT NULL,             -- PUBLIC_HOLIDAY | RELIGIOUS
  applies      text NOT NULL DEFAULT 'Everyone',
  moved_from   date,                      -- Sunday-shift provenance
  FOREIGN KEY (country_code, year) REFERENCES holiday_calendar_years(country_code, year)
);
CREATE INDEX holidays_country ON holidays (country_code, year, date);
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays FORCE ROW LEVEL SECURITY;
CREATE POLICY read_all ON holidays FOR SELECT USING (true);

-- Minimal customers: what appointments/booking need today.
-- Phase 9 (Customers & CI) extends this table; it does not replace it.
CREATE TABLE customers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES businesses(id),
  name        text NOT NULL,
  email       text,
  phone       text,
  cust_group  text NOT NULL DEFAULT 'New',
  since       date NOT NULL DEFAULT now(),
  visits      integer NOT NULL DEFAULT 0,
  spend       integer NOT NULL DEFAULT 0,
  points      integer NOT NULL DEFAULT 0,
  prepaid     integer NOT NULL DEFAULT 0,
  blacklisted boolean NOT NULL DEFAULT false,
  no_shows    integer NOT NULL DEFAULT 0,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_tenant ON customers (tenant_id, name);
CREATE INDEX customers_contact ON customers (tenant_id, phone, email);
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE appointments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES businesses(id),
  location_id  uuid NOT NULL REFERENCES locations(id),
  date         date NOT NULL,
  start_min    integer NOT NULL,          -- minutes from midnight
  duration_min integer NOT NULL,          -- the treatment (what is sold)
  prep_min     integer NOT NULL DEFAULT 0,  -- frozen at booking
  reset_min    integer NOT NULL DEFAULT 0,  -- frozen at booking
  kind         appointment_kind NOT NULL DEFAULT 'appointment',
  status       appointment_status NOT NULL DEFAULT 'booked',
  title        text NOT NULL DEFAULT '',
  service_id   uuid REFERENCES services(id),
  variant_id   uuid REFERENCES service_variants(id),
  variant_label text,
  modifier_option_ids uuid[] NOT NULL DEFAULT '{}',
  modifier_names text[] NOT NULL DEFAULT '{}',
  employee_id  uuid REFERENCES employees(id),
  any_emp      boolean NOT NULL DEFAULT false,
  customer_id  uuid REFERENCES customers(id),
  price        integer NOT NULL DEFAULT 0,
  quoted       jsonb,                     -- promised timing incl. basis
  source       text NOT NULL DEFAULT 'staff',
  deposit      integer NOT NULL DEFAULT 0,
  paid         text NOT NULL DEFAULT 'unpaid',
  po_id        uuid,                      -- reserved: personal offer (Phase 9)
  pmo_id       uuid,                      -- reserved: premium member offer
  widget_id    uuid,                      -- reserved: booking widget (Phase 7)
  idempotency_key text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX appointments_idempotency
  ON appointments (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX appointments_day ON appointments (tenant_id, location_id, date);
CREATE INDEX appointments_emp ON appointments (tenant_id, employee_id, date);
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON appointments
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE appointment_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES businesses(id),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  at             timestamptz NOT NULL DEFAULT now(),
  what           text NOT NULL,           -- Created · Treatment started · …
  by_name        text NOT NULL DEFAULT '',
  source         text NOT NULL DEFAULT 'staff'
);
CREATE INDEX appointment_history_tenant ON appointment_history (tenant_id, appointment_id, at);
ALTER TABLE appointment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON appointment_history
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

CREATE TABLE holds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES businesses(id),
  key         text NOT NULL UNIQUE,       -- the booking's idempotency key
  location_id uuid NOT NULL REFERENCES locations(id),
  date        date NOT NULL,
  start_min   integer NOT NULL,
  employee_id uuid REFERENCES employees(id),
  service_id  uuid REFERENCES services(id),
  until       timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX holds_slot ON holds (tenant_id, location_id, date, start_min);
ALTER TABLE holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE holds FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON holds
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());

-- migrate:down

DROP TABLE holds;
DROP TABLE appointment_history;
DROP TABLE appointments;
DROP TABLE customers;
DROP TABLE holidays;
DROP TABLE holiday_calendar_years;
DROP TABLE schedule_exceptions;
DROP TYPE appointment_status;
DROP TYPE appointment_kind;
DROP TYPE schedule_exception_source;
DROP TYPE schedule_exception_type;
