-- Step 10 of the Search phase — docs/SEARCH.md, decision 3.
--
-- What people asked for and did not find. Alex chose the narrowest of
-- the three options on offer: zero and low-result queries only,
-- normalized text, no identity, and nothing that touches ranking.
--
-- So this table is deliberately not an analytics table. It cannot
-- answer "who searched this", "when exactly", or "what else did they
-- search" — there is no client id, no session, no IP, no timestamp
-- finer than a day, and no row per event. One row per normalized
-- query per day, carrying a counter. That shape is the privacy
-- guarantee: it is not that we promise not to look, it is that the
-- data to look at was never recorded.
--
-- It is also not a ranking input and must never become one. Ranking
-- reads `search_config`, and lives entirely in code that has never
-- heard of this table. A miss log that fed back into results would
-- quietly make the platform popular with itself.

-- migrate:up

CREATE TABLE search_misses (
  -- The output of search_norm(), never the raw keystrokes. Lower-case,
  -- unaccented, punctuation collapsed — which is also the form the
  -- matching index uses, so a miss can be replayed against it exactly
  -- as it was asked.
  norm     text    NOT NULL,
  day      date    NOT NULL DEFAULT current_date,
  -- How many times this query was submitted that day. A counter rather
  -- than rows: spamming the box inflates a number instead of filling a
  -- table, and no sequence of individual searches can be reconstructed
  -- from it.
  asked    integer NOT NULL DEFAULT 1,
  -- How many results it last came back with. Zero is the interesting
  -- case; a small number is the other one — a query that technically
  -- works and still leaves somebody with nothing to book.
  results  integer NOT NULL,
  -- How the text was read: none, fuzzy, category, service, salon. The
  -- difference between "we did not understand it" and "we understood it
  -- and have nothing" is the whole value of this log.
  how      text    NOT NULL,
  first_at timestamptz NOT NULL DEFAULT now(),
  last_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (norm, day)
);

-- The obvious read: what is failing lately, worst first.
CREATE INDEX search_misses_day ON search_misses (day DESC, asked DESC);

ALTER TABLE search_misses ENABLE ROW LEVEL SECURITY;

-- HQ reads it and nobody else does. A salon that could read this would
-- learn what the country is asking for and not finding, which is a
-- market research report about its competitors.
CREATE POLICY search_misses_hq ON search_misses FOR SELECT
  USING (current_setting('app.hq', true) = '1');

-- And there is deliberately NO write policy. The consumer search door
-- is a key-free public surface; giving it INSERT on a platform table
-- would mean anyone on the internet holds a pen. The only way in is the
-- function below, which decides for itself what it is willing to write.
-- Takes what was typed, not what the caller thinks it normalizes to.
-- Normalization lives in search_norm() and nowhere else — two
-- implementations of "what does this text become" would eventually
-- disagree, and then a logged miss could not be replayed against the
-- index that missed it.
CREATE FUNCTION log_search_miss(p_raw text, p_results integer, p_how text)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_norm text := search_norm(p_raw);
BEGIN
  -- Two characters is the search threshold itself; 120 is the contract's
  -- maximum query length. Anything outside that did not come from the
  -- search box, and this function is the boundary that says so rather
  -- than trusting the caller to have checked.
  IF v_norm IS NULL OR length(v_norm) < 2 OR length(v_norm) > 120 THEN
    RETURN;
  END IF;

  INSERT INTO search_misses (norm, day, asked, results, how)
  VALUES (v_norm, current_date, 1, greatest(p_results, 0), p_how)
  ON CONFLICT (norm, day) DO UPDATE
    SET asked   = search_misses.asked + 1,
        -- The latest answer, not the first: a query stops being a miss
        -- the day a salon publishes something for it, and the log
        -- should show that rather than preserving the complaint.
        results = excluded.results,
        how     = excluded.how,
        last_at = now();
END $$;

GRANT EXECUTE ON FUNCTION log_search_miss(text, integer, text) TO velnes_api;
-- And explicitly not to anyone else: the public role has no way to
-- reach the table, and this is the only door to it.

-- migrate:down

DROP FUNCTION IF EXISTS log_search_miss(text, integer, text);
DROP TABLE IF EXISTS search_misses;
