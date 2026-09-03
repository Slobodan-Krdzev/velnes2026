-- migrate:up

-- HQ teammates can be invited before they can sign in.
ALTER TABLE hq_users DROP CONSTRAINT hq_users_status_check;
ALTER TABLE hq_users ADD CONSTRAINT hq_users_status_check
  CHECK (status IN ('active','invited','disabled'));

-- migrate:down

ALTER TABLE hq_users DROP CONSTRAINT hq_users_status_check;
ALTER TABLE hq_users ADD CONSTRAINT hq_users_status_check
  CHECK (status IN ('active','disabled'));
