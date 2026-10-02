-- Booking changes (Alex, 2026-09-30): customer rescheduling and
-- cancellation as first-class domain events — docs/BOOKING-CHANGES.md.
--
-- A customer's reschedule is a REQUEST: the appointment does not move
-- until the salon approves. So the appointment row keeps its status and
-- its time, and the request lives beside it, with everything a dispute
-- needs: what was, what was asked, who asked, who answered, when, and
-- what the customer did after a decline. The partial unique index is
-- the whole "one active request per visit" rule.
--
-- Cancellation gains its facts on the appointment itself: when, by whom
-- (customer / salon / system / hq) and why. cancel_hours is the
-- location's cancellation window as it was when the visit was booked —
-- the terms accepted at booking govern the booking (Alex), so a salon
-- that later tightens its window does not change what old bookings
-- were promised. Backfilled from the location for existing rows.
--
-- refunds is the refund INTENT a cancelled prepaid visit creates: the
-- booking is cancelled first and stays cancelled whatever the provider
-- says; the row records what the provider (mock today) was asked and
-- what it answered. One per invoice, whatever retries.
--
-- member_recs.slot_key lets a released slot feed the existing Premium
-- opportunity queue exactly once.

-- migrate:up

ALTER TABLE appointments
  ADD COLUMN cancel_hours  integer,
  ADD COLUMN cancelled_at  timestamptz,
  ADD COLUMN cancelled_by  text CHECK (cancelled_by IS NULL OR cancelled_by IN ('customer', 'salon', 'system', 'hq')),
  ADD COLUMN cancel_reason text;
UPDATE appointments a SET cancel_hours = l.cancel_hours
  FROM locations l WHERE l.id = a.location_id AND a.cancel_hours IS NULL;

-- Structured detail beside the free-text line: from/to times, actors.
ALTER TABLE appointment_history ADD COLUMN meta jsonb;

CREATE TABLE booking_change_requests (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES businesses(id),
  appointment_id              uuid NOT NULL REFERENCES appointments(id),
  kind                        text NOT NULL DEFAULT 'reschedule' CHECK (kind IN ('reschedule')),
  status                      text NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'approved', 'declined', 'withdrawn', 'resolved')),
  original_date               date NOT NULL,
  original_start_min          integer NOT NULL,
  original_duration_min       integer NOT NULL,
  original_employee_id        uuid REFERENCES employees(id),
  requested_date              date NOT NULL,
  requested_start_min         integer NOT NULL,
  requested_employee_id       uuid REFERENCES employees(id),
  requested_by_client_user_id uuid REFERENCES client_users(id),
  requested_at                timestamptz NOT NULL DEFAULT now(),
  resolved_by_employee_id     uuid REFERENCES employees(id),
  resolved_at                 timestamptz,
  decline_reason              text,
  customer_decision           text CHECK (customer_decision IS NULL OR customer_decision IN ('keep', 'cancel')),
  decided_at                  timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now()
);
-- One active request per visit: pending, or declined and still waiting
-- for the customer's answer.
CREATE UNIQUE INDEX booking_change_requests_active
  ON booking_change_requests (appointment_id) WHERE status IN ('pending', 'declined');
CREATE INDEX booking_change_requests_tenant
  ON booking_change_requests (tenant_id, status, requested_at DESC);
CREATE INDEX booking_change_requests_appt
  ON booking_change_requests (tenant_id, appointment_id, requested_at DESC);
ALTER TABLE booking_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_change_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON booking_change_requests
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY hq_read ON booking_change_requests FOR SELECT
  USING (current_setting('app.hq', true) = '1');

CREATE TABLE refunds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES businesses(id),
  appointment_id  uuid NOT NULL REFERENCES appointments(id),
  invoice_id      uuid NOT NULL UNIQUE REFERENCES invoices(id),
  amount          integer NOT NULL CHECK (amount >= 0),
  method          text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'refunded', 'failed')),
  provider        text NOT NULL,
  charge_ref      text,
  provider_ref    text,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  attempts        integer NOT NULL DEFAULT 0,
  failure_reason  text
);
CREATE INDEX refunds_tenant_status ON refunds (tenant_id, status, requested_at);
CREATE INDEX refunds_appt ON refunds (tenant_id, appointment_id);
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON refunds
  USING (tenant_id = app.current_tenant())
  WITH CHECK (tenant_id = app.current_tenant());
-- The retry worker runs across salons under the HQ context.
CREATE POLICY hq_all ON refunds
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

ALTER TABLE member_recs ADD COLUMN slot_key text;
CREATE UNIQUE INDEX member_recs_slot ON member_recs (tenant_id, slot_key) WHERE slot_key IS NOT NULL;

-- migrate:down

DROP INDEX IF EXISTS member_recs_slot;
ALTER TABLE member_recs DROP COLUMN IF EXISTS slot_key;
DROP TABLE IF EXISTS refunds;
DROP TABLE IF EXISTS booking_change_requests;
ALTER TABLE appointment_history DROP COLUMN IF EXISTS meta;
ALTER TABLE appointments
  DROP COLUMN IF EXISTS cancel_reason,
  DROP COLUMN IF EXISTS cancelled_by,
  DROP COLUMN IF EXISTS cancelled_at,
  DROP COLUMN IF EXISTS cancel_hours;
