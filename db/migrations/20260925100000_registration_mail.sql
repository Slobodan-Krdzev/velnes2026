-- migrate:up

-- The applicant's e-mail token — minted at registration, reserved for
-- exactly this since the table was born — now opens one door: confirming
-- the address. Same shape as the resubmit token (an RLS row match, not
-- an if-statement) under its own setting, so neither token opens the
-- other's door.
CREATE POLICY applicant_by_email_token ON registrations FOR SELECT
  USING (email_token::text = current_setting('app.reg_email_token', true));
CREATE POLICY applicant_verify_email ON registrations FOR UPDATE
  USING (email_token::text = current_setting('app.reg_email_token', true))
  WITH CHECK (email_token::text = current_setting('app.reg_email_token', true));

-- The anonymous door (apply) and the applicant's door (resubmit) queue
-- the applicant's own, tenant-less mail: the verification link. They
-- still cannot read or touch any mail.
CREATE POLICY registration_mail ON mail_outbox FOR INSERT
  WITH CHECK (
    tenant_id IS NULL AND (
      current_setting('app.public', true) = '1'
      OR coalesce(current_setting('app.reg_token', true), '') <> ''
    )
  );

-- migrate:down

DROP POLICY registration_mail ON mail_outbox;
DROP POLICY applicant_verify_email ON registrations;
DROP POLICY applicant_by_email_token ON registrations;
