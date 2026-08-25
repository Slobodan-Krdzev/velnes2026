-- migrate:up

-- Which widget produced a booking. Nullable: staff bookings, the
-- hosted link and future channels have no widget. The stats card in
-- Settings › Online booking counts on this.
ALTER TABLE appointments
  ADD COLUMN widget_id uuid REFERENCES widgets(id) ON DELETE SET NULL;

CREATE INDEX appointments_widget_idx ON appointments(widget_id)
  WHERE widget_id IS NOT NULL;

-- migrate:down
DROP INDEX appointments_widget_idx;
ALTER TABLE appointments DROP COLUMN widget_id;
