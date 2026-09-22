-- migrate:up

-- Booking requests (Alex, 2026-09-22): a salon that switched "Confirm
-- bookings automatically" off gets requests from the Velnes app, not
-- bookings. A request holds its slot as `requested` until the salon
-- accepts (→ booked) or declines (→ cancelled). Nobody pays for a
-- request; the acceptance mail carries the payment link.
ALTER TYPE appointment_status ADD VALUE IF NOT EXISTS 'requested';

-- migrate:down

-- Postgres cannot drop an enum value; `requested` rows would have to be
-- decided first. Left in place on purpose.
