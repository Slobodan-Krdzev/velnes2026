-- migrate:up

-- Real mail delivery (Alex, 2026-09-23). The outbox stays the truth of
-- what was said to whom; these columns carry what the sender needs to
-- render and deliver it, and what happened when it tried:
--   meta            the structured extras a mail renders with — a
--                   call-to-action button {label,url}, a one-time code
--   attempts        delivery attempts so far; a row retries with
--                   backoff until MAX_ATTEMPTS, then reads 'failed'
--   next_attempt_at earliest time for the next try (null = now)
--   error           the last transport error, in the operator's words
--   message_id      the provider's Message-ID once accepted
ALTER TABLE mail_outbox
  ADD COLUMN meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN attempts        integer NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN error           text,
  ADD COLUMN message_id      text;
CREATE INDEX mail_outbox_queued ON mail_outbox (created_at) WHERE status = 'queued';

-- migrate:down
DROP INDEX mail_outbox_queued;
ALTER TABLE mail_outbox
  DROP COLUMN meta, DROP COLUMN attempts, DROP COLUMN next_attempt_at, DROP COLUMN error, DROP COLUMN message_id;
