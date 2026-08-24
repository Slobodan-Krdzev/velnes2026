-- migrate:up

-- Weekly working hours per employee: {"0":[["09:00","19:00"]],…,"6":null}
-- keyed 0=Monday..6=Sunday, values = list of periods (split shifts) or
-- null for a day off. Same shape as locations.hours.
ALTER TABLE employees ADD COLUMN hours jsonb;

-- migrate:down

ALTER TABLE employees DROP COLUMN hours;
