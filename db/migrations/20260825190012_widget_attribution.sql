-- migrate:up

-- appointments.widget_id has existed since migration 0006 as a
-- reserved field. Now that widgets are real (0011), wire it up: the
-- FK, and the partial index the Settings stats card counts on.
ALTER TABLE appointments
  ADD CONSTRAINT appointments_widget_fk
  FOREIGN KEY (widget_id) REFERENCES widgets(id) ON DELETE SET NULL;

CREATE INDEX appointments_widget_idx ON appointments(widget_id)
  WHERE widget_id IS NOT NULL;

-- migrate:down
DROP INDEX appointments_widget_idx;
ALTER TABLE appointments DROP CONSTRAINT appointments_widget_fk;
