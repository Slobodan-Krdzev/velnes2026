-- migrate:up

-- Test salons, marked as such. A fixture batch is a set of complete,
-- real-shaped tenants (made through the registration→approval door so
-- they are indistinguishable from sign-ups) that can be removed again
-- in one act by their batch name. Real salons carry NULL, and nothing
-- else ever reads this column: it is a handle for `fixtures remove`.
ALTER TABLE businesses ADD COLUMN fixture_batch text;
CREATE INDEX businesses_fixture_batch ON businesses (fixture_batch) WHERE fixture_batch IS NOT NULL;

-- migrate:down

DROP INDEX businesses_fixture_batch;
ALTER TABLE businesses DROP COLUMN fixture_batch;
