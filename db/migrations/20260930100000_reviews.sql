-- Verified reviews (Alex, 2026-09-30).
--
-- A review hangs on ONE completed appointment, and an appointment can
-- carry at most one — the UNIQUE on appointment_id is the whole
-- anti-duplicate story, whatever the client retries. "Completed" is the
-- platform's own definition (status booked/confirmed, a real
-- appointment, its end already passed in the location's clock); nothing
-- is stored for it, and the review snapshots what the appointment was
-- at that moment: its location, service, professional and date, so a
-- later renamed service or a professional who left changes nothing.
--
-- Four whole-star dimensions, a written part that is optional. The
-- salon's score is service+timing+cleanliness (Option B); the
-- professional's score is theirs alone. Moderation is two fields, not
-- one: body_status hides the words, rating_status voids the numbers —
-- so an unfit sentence can go while the verified rating stays, and the
-- other way round. Nobody in the salon can write here at all: the
-- tenant policy is SELECT only.
--
-- review_reminders is the one-time "how was your visit?" record: the
-- primary key on appointment_id is what makes a restarted, doubled or
-- overlapping worker send nothing twice. platform_features records when
-- the reminders went live, so the first run never mails the past.

-- migrate:up

CREATE TABLE reviews (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES businesses(id),
  location_id         uuid NOT NULL REFERENCES locations(id),
  appointment_id      uuid NOT NULL UNIQUE REFERENCES appointments(id),
  client_user_id      uuid NOT NULL REFERENCES client_users(id),
  customer_id         uuid REFERENCES customers(id),
  service_id          uuid REFERENCES services(id),
  employee_id         uuid REFERENCES employees(id),
  service_rating      smallint NOT NULL CHECK (service_rating BETWEEN 1 AND 5),
  timing_rating       smallint NOT NULL CHECK (timing_rating BETWEEN 1 AND 5),
  cleanliness_rating  smallint NOT NULL CHECK (cleanliness_rating BETWEEN 1 AND 5),
  professional_rating smallint NOT NULL CHECK (professional_rating BETWEEN 1 AND 5),
  body                text CHECK (body IS NULL OR (char_length(body) BETWEEN 1 AND 800)),
  body_status         text NOT NULL DEFAULT 'published' CHECK (body_status IN ('published', 'hidden')),
  rating_status       text NOT NULL DEFAULT 'valid' CHECK (rating_status IN ('valid', 'void')),
  appointment_date    date NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reviews_tenant_created ON reviews (tenant_id, created_at DESC);
CREATE INDEX reviews_tenant_employee ON reviews (tenant_id, employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX reviews_tenant_location ON reviews (tenant_id, location_id);
CREATE INDEX reviews_client ON reviews (client_user_id, created_at DESC);
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews FORCE ROW LEVEL SECURITY;
-- The salon reads its own, and only reads.
CREATE POLICY tenant_read ON reviews FOR SELECT
  USING (tenant_id = app.current_tenant());
-- The reviewer reads and writes their own; the row must say it is theirs.
CREATE POLICY client_own ON reviews FOR SELECT
  USING (client_user_id::text = current_setting('app.client_id', true));
CREATE POLICY client_write ON reviews FOR INSERT
  WITH CHECK (client_user_id::text = current_setting('app.client_id', true));
-- The marketplace reads across salons (the doors decide what of it is public).
CREATE POLICY public_read ON reviews FOR SELECT
  USING (current_setting('app.public', true) = '1');
-- HQ: read everything, and the only principal that may ever moderate.
CREATE POLICY hq_all ON reviews
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

CREATE TABLE review_reminders (
  appointment_id  uuid PRIMARY KEY REFERENCES appointments(id),
  tenant_id       uuid NOT NULL REFERENCES businesses(id),
  client_user_id  uuid NOT NULL REFERENCES client_users(id),
  sent_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE review_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_reminders FORCE ROW LEVEL SECURITY;
CREATE POLICY hq_all ON review_reminders
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');
CREATE POLICY tenant_read ON review_reminders FOR SELECT
  USING (tenant_id = app.current_tenant());

-- The reminder worker scans completed appointments across every salon
-- under the HQ context, which could not read appointments until now.
CREATE POLICY hq_read ON appointments FOR SELECT
  USING (current_setting('app.hq', true) = '1');

-- When a feature went live — the cutoff a rollout must not reach back
-- past. Set by the migration that ships the feature, read by the code.
CREATE TABLE platform_features (
  key    text PRIMARY KEY,
  since  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE platform_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_features FORCE ROW LEVEL SECURITY;
CREATE POLICY read_all ON platform_features FOR SELECT USING (true);
CREATE POLICY hq_write ON platform_features FOR ALL
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');
INSERT INTO platform_features (key) VALUES ('review_reminders');

-- migrate:down

DROP TABLE platform_features;
DROP POLICY hq_read ON appointments;
DROP TABLE review_reminders;
DROP TABLE reviews;
