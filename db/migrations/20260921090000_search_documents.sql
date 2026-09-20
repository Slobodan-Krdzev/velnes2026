-- Step 1 of the Search phase — docs/SEARCH.md.
--
-- The cross-tenant matching index. Services live behind RLS, one tenant
-- at a time, which is right for everything else and impossible for a
-- search box: asking thirteen tenants per keystroke is already unpleasant
-- and does not survive growth. This is the same shape as the original
-- search proposal's Q3, which answered it with a projection, so this is
-- that projection.
--
-- What it is NOT: the authority on admission. A submitted search still
-- re-checks every candidate through admittedBusinesses() — listed, an
-- ACTIVE location, bookable. This table only answers "what is this text
-- likely to mean", and holds nothing a salon has not already published.
--
-- Two kinds only, salon and service. Categories are deliberately absent:
-- service_categories is already readable across tenants (its read_all
-- policy), so projecting it here would be a second copy of the same
-- names, free to drift. Category terms and their synonyms get their own
-- table in step 2.

-- migrate:up

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Lower-case, strip accents, reduce anything that is not a letter or a
-- digit to a single space. [:alnum:] keeps Cyrillic, which matters more
-- here than it might elsewhere: "Шишање" must survive intact.
--
-- STABLE rather than IMMUTABLE, because unaccent() is STABLE and saying
-- otherwise would be a convenient lie. Nothing is indexed on this
-- expression — the trigger writes `norm` into a plain column and the
-- index sits on that — so immutability is not needed anywhere.
CREATE FUNCTION search_norm(t text) RETURNS text
  LANGUAGE sql STABLE STRICT PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
    lower(unaccent('unaccent'::regdictionary, t)), '[^[:alnum:]]+', ' ', 'g'))
$$;

CREATE TABLE search_documents (
  kind        text NOT NULL CHECK (kind IN ('salon', 'service')),
  ref_id      uuid NOT NULL,
  tenant_id   uuid NOT NULL,
  -- What a suggestion shows, and what it matches on.
  display     text NOT NULL,
  norm        text NOT NULL,
  -- Denormalised so a suggestion can be rendered without reading into
  -- the tenant at all: the salon behind a service, and the category a
  -- service belongs to.
  salon_slug  text NOT NULL,
  salon_name  text NOT NULL,
  category_id uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, ref_id)
);

-- Trigram matching for prefixes, partial words and honest typos.
CREATE INDEX search_documents_norm_trgm ON search_documents USING gin (norm gin_trgm_ops);
CREATE INDEX search_documents_kind ON search_documents (kind);
CREATE INDEX search_documents_tenant ON search_documents (tenant_id);

ALTER TABLE search_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_documents FORCE ROW LEVEL SECURITY;
-- Readable by anyone, because it holds only what salons publish, and a
-- key-free search box has to read it. Note what is missing: no INSERT,
-- UPDATE or DELETE policy exists, so nothing can write here except the
-- SECURITY DEFINER triggers below. The projection cannot be edited into
-- disagreeing with its sources.
CREATE POLICY search_documents_read ON search_documents FOR SELECT USING (true);

-- A business belongs in the index when it has a slug and publishes a
-- marketplace listing. `listed` is absent for salons that never touched
-- the setting, and absent means listed — the same default
-- BusinessSettingsSchema applies.
CREATE FUNCTION search_business_publishable(b businesses) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT b.slug IS NOT NULL
     AND COALESCE(b.settings->'marketplace'->>'listed', 'true') = 'true'
$$;

-- SECURITY DEFINER because the trigger fires inside whatever context
-- did the write — a tenant editing its own catalogue — and that context
-- has no business writing a platform table directly. The definer runs as
-- the owner, past RLS, with a pinned search_path so nothing can be
-- shadowed into it.
CREATE FUNCTION search_documents_sync_service() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b businesses;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM search_documents WHERE kind = 'service' AND ref_id = OLD.id;
    RETURN OLD;
  END IF;

  SELECT * INTO b FROM businesses WHERE id = NEW.tenant_id;

  -- Only what is on offer to the public: a draft or POS-only treatment
  -- is not something a search box should ever suggest.
  IF b.id IS NULL
     OR NOT search_business_publishable(b)
     OR NEW.status <> 'active'
     OR NOT NEW.online THEN
    DELETE FROM search_documents WHERE kind = 'service' AND ref_id = NEW.id;
    RETURN NEW;
  END IF;

  INSERT INTO search_documents
    (kind, ref_id, tenant_id, display, norm, salon_slug, salon_name, category_id, updated_at)
  VALUES
    ('service', NEW.id, NEW.tenant_id, NEW.name, search_norm(NEW.name),
     b.slug, b.name, NEW.category_id, now())
  ON CONFLICT (kind, ref_id) DO UPDATE SET
    display = EXCLUDED.display, norm = EXCLUDED.norm,
    salon_slug = EXCLUDED.salon_slug, salon_name = EXCLUDED.salon_name,
    category_id = EXCLUDED.category_id, tenant_id = EXCLUDED.tenant_id,
    updated_at = now();
  RETURN NEW;
END $$;

CREATE FUNCTION search_documents_sync_business() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM search_documents WHERE tenant_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NOT search_business_publishable(NEW) THEN
    -- Unlisting a salon takes its treatments out of the index with it.
    DELETE FROM search_documents WHERE tenant_id = NEW.id;
    RETURN NEW;
  END IF;

  INSERT INTO search_documents
    (kind, ref_id, tenant_id, display, norm, salon_slug, salon_name, updated_at)
  VALUES
    ('salon', NEW.id, NEW.id, NEW.name, search_norm(NEW.name), NEW.slug, NEW.name, now())
  ON CONFLICT (kind, ref_id) DO UPDATE SET
    display = EXCLUDED.display, norm = EXCLUDED.norm,
    salon_slug = EXCLUDED.salon_slug, salon_name = EXCLUDED.salon_name,
    updated_at = now();

  -- A rename has to reach the treatments that carry the salon's name.
  UPDATE search_documents
     SET salon_slug = NEW.slug, salon_name = NEW.name, updated_at = now()
   WHERE kind = 'service' AND tenant_id = NEW.id;

  -- And a salon that has just become listed brings its catalogue back.
  INSERT INTO search_documents
    (kind, ref_id, tenant_id, display, norm, salon_slug, salon_name, category_id, updated_at)
  SELECT 'service', s.id, s.tenant_id, s.name, search_norm(s.name),
         NEW.slug, NEW.name, s.category_id, now()
    FROM services s
   WHERE s.tenant_id = NEW.id AND s.status = 'active' AND s.online
  ON CONFLICT (kind, ref_id) DO NOTHING;

  RETURN NEW;
END $$;

-- Row triggers do not fire on TRUNCATE, and the demo seed truncates
-- businesses CASCADE before rebuilding the world. Without this the
-- projection would keep pointing at salons that no longer exist while
-- the re-inserts piled new rows on top. Phase B learned the same lesson
-- from a foreign key; this is the trigger-shaped version of it.
CREATE FUNCTION search_documents_clear() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM search_documents;
  RETURN NULL;
END $$;

CREATE TRIGGER search_documents_truncate
  AFTER TRUNCATE ON businesses
  FOR EACH STATEMENT EXECUTE FUNCTION search_documents_clear();

CREATE TRIGGER search_documents_services
  AFTER INSERT OR UPDATE OR DELETE ON services
  FOR EACH ROW EXECUTE FUNCTION search_documents_sync_service();

CREATE TRIGGER search_documents_businesses
  AFTER INSERT OR UPDATE OR DELETE ON businesses
  FOR EACH ROW EXECUTE FUNCTION search_documents_sync_business();

-- Backfill. Triggers keep it true from here; this is the one moment the
-- table has to be filled by hand.
INSERT INTO search_documents
  (kind, ref_id, tenant_id, display, norm, salon_slug, salon_name, updated_at)
SELECT 'salon', b.id, b.id, b.name, search_norm(b.name), b.slug, b.name, now()
  FROM businesses b
 WHERE search_business_publishable(b);

INSERT INTO search_documents
  (kind, ref_id, tenant_id, display, norm, salon_slug, salon_name, category_id, updated_at)
SELECT 'service', s.id, s.tenant_id, s.name, search_norm(s.name),
       b.slug, b.name, s.category_id, now()
  FROM services s
  JOIN businesses b ON b.id = s.tenant_id
 WHERE search_business_publishable(b)
   AND s.status = 'active' AND s.online;

-- migrate:down

DROP TRIGGER IF EXISTS search_documents_truncate ON businesses;
DROP TRIGGER IF EXISTS search_documents_businesses ON businesses;
DROP TRIGGER IF EXISTS search_documents_services ON services;
DROP FUNCTION IF EXISTS search_documents_sync_business();
DROP FUNCTION IF EXISTS search_documents_clear();
DROP FUNCTION IF EXISTS search_documents_sync_service();
DROP FUNCTION IF EXISTS search_business_publishable(businesses);
DROP TABLE IF EXISTS search_documents;
DROP FUNCTION IF EXISTS search_norm(text);
