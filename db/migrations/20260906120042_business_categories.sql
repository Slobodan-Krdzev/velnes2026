-- migrate:up
-- The salon verticals Revelapps HQ curates (Physiotherapy, Beauty
-- salon, …). The registration wizard shows the enabled ones; HQ adds,
-- renames and enables/disables them. Non-sensitive platform config, so
-- anyone may read it (the wizard is anonymous); only HQ may write.
CREATE TABLE business_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  enabled     boolean NOT NULL DEFAULT true,
  sort        integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE business_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_categories FORCE ROW LEVEL SECURITY;
-- Public config: readable by anyone (the registration wizard has no
-- session), written only by HQ.
CREATE POLICY public_read ON business_categories FOR SELECT USING (true);
CREATE POLICY hq_write ON business_categories
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

INSERT INTO business_categories (name, sort) VALUES
  ('Physiotherapy', 1),
  ('Beauty salon', 2),
  ('Wellness & spa', 3),
  ('Barbershop', 4),
  ('Nails', 5),
  ('Massage therapy', 6),
  ('Dental clinic', 7),
  ('Aesthetic clinic', 8);

-- migrate:down
DROP TABLE business_categories;
