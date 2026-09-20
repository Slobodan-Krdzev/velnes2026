-- Step 2 of the Search phase — docs/SEARCH.md.
--
-- What a customer types is not what we called it. They type "masaza",
-- "масажа", "frizer", "barber"; the taxonomy says "Massage" and
-- "Haircuts". This table is where that gap is closed, centrally, in the
-- database — the original search proposal's Q1 is explicit that the
-- synonym layer "must be born in the platform taxonomy, not retrofitted
-- per salon", and equally explicit that the frontend must never parse
-- strings on its own.
--
-- It has a second job. `kind = 'name'` rows are a category's display
-- name in a language; `kind = 'synonym'` rows are only ever matched
-- against. Both are matched, so translating the taxonomy and teaching
-- search a new word become the same act, done once. That is also why
-- synonyms do not belong in packages/i18n: a synonym is something a
-- customer types, not a label we show, but a translated category name is
-- both — and keeping them in one table means the two cannot drift.
--
-- A term may point at several categories on purpose. "fizio" is
-- honestly Manual therapy and Rehab and Assessment and Recovery all at
-- once, and resolving it to a set is truer than forcing a winner.

-- migrate:up

CREATE TABLE service_category_terms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
  lang        text NOT NULL CHECK (lang IN ('en', 'mk', 'sq')),
  kind        text NOT NULL CHECK (kind IN ('name', 'synonym')),
  term        text NOT NULL,
  -- Written by the trigger below, never by hand.
  norm        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, lang, kind, norm)
);

CREATE INDEX service_category_terms_norm_trgm
  ON service_category_terms USING gin (norm gin_trgm_ops);
CREATE INDEX service_category_terms_category ON service_category_terms (category_id);

-- search_norm is STABLE, so it cannot be a generated column; a trigger
-- does the same job and keeps `norm` impossible to set wrongly.
CREATE FUNCTION service_category_terms_norm() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.norm := search_norm(NEW.term);
  RETURN NEW;
END $$;

CREATE TRIGGER service_category_terms_norm
  BEFORE INSERT OR UPDATE ON service_category_terms
  FOR EACH ROW EXECUTE FUNCTION service_category_terms_norm();

ALTER TABLE service_category_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_category_terms FORCE ROW LEVEL SECURITY;
-- Read by anyone, exactly like the taxonomy it describes; written by HQ,
-- who own the taxonomy. A salon cannot teach the platform that its own
-- name is a synonym for "massage".
CREATE POLICY service_category_terms_read ON service_category_terms FOR SELECT USING (true);
CREATE POLICY service_category_terms_hq ON service_category_terms
  USING (current_setting('app.hq', true) = '1')
  WITH CHECK (current_setting('app.hq', true) = '1');

-- Seeded by category *name*, not id: category ids are created by HQ and
-- differ between databases, so a lookup attaches these to whatever
-- exists and quietly inserts nothing where a category does not. The
-- words themselves come from the prototype's SEARCH_CATS[].syn, which is
-- Alex's own vetted list — MK, EN and Cyrillic from the start, because
-- this is Macedonia.
--
-- Only English `name` rows are seeded. Macedonian and Albanian display
-- names are a native review that has not happened (docs/CONSUMER-APP.md
-- records the same gap for the app's copy), and inventing them here
-- would put unreviewed language in front of customers.
INSERT INTO service_category_terms (category_id, lang, kind, term)
SELECT c.id, 'en', 'name', c.name FROM service_categories c;

INSERT INTO service_category_terms (category_id, lang, kind, term)
SELECT c.id, t.lang, 'synonym', t.term
  FROM service_categories c
  JOIN (VALUES
    -- Massage
    ('Massage', 'en', 'massage'),
    ('Massage', 'en', 'sports massage'),
    ('Massage', 'mk', 'masaza'),
    ('Massage', 'mk', 'масажа'),
    -- Hair, where "barber" is what half the country actually types
    ('Haircuts', 'en', 'hair'),
    ('Haircuts', 'en', 'haircut'),
    ('Haircuts', 'en', 'barber'),
    ('Haircuts', 'mk', 'frizer'),
    ('Haircuts', 'mk', 'фризер'),
    ('Haircuts', 'mk', 'коса'),
    -- Skin
    ('Skin care', 'en', 'facial'),
    ('Skin care', 'en', 'skin'),
    ('Skin care', 'en', 'peeling'),
    ('Skin care', 'mk', 'лице'),
    -- Nails
    ('Nails', 'en', 'nails'),
    ('Nails', 'en', 'manicure'),
    ('Nails', 'en', 'pedicure'),
    ('Nails', 'mk', 'нокти'),
    -- The physio family. The prototype had one "physio" category; this
    -- taxonomy has four, and "fizio" means all of them.
    ('Manual therapy', 'en', 'manual therapy'),
    ('Manual therapy', 'en', 'physio'),
    ('Manual therapy', 'mk', 'fizio'),
    ('Manual therapy', 'mk', 'физио'),
    ('Rehab', 'en', 'rehab'),
    ('Rehab', 'en', 'rehabilitation'),
    ('Rehab', 'en', 'physio'),
    ('Rehab', 'mk', 'fizio'),
    ('Rehab', 'mk', 'физио'),
    ('Assessment', 'en', 'physio'),
    ('Assessment', 'mk', 'fizio'),
    ('Recovery', 'en', 'recovery'),
    ('Recovery', 'en', 'physio'),
    ('Recovery', 'mk', 'fizio'),
    ('Wellness', 'en', 'wellness'),
    ('Wellness', 'en', 'spa'),
    ('Wellness', 'en', 'sauna')
  ) AS t(cat, lang, term) ON t.cat = c.name
ON CONFLICT DO NOTHING;

-- migrate:down

DROP TABLE IF EXISTS service_category_terms;
DROP FUNCTION IF EXISTS service_category_terms_norm();
