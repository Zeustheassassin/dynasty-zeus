-- recruits + recruits_meta: shared cache of CollegeFootballData (CFD) recruiting data.
-- Source = 247Sports Composite (CFD's only ranking input). One row per recruit; one
-- row per year in the meta table for fast freshness lookups in the UI.
--
-- INTENTIONAL DESIGN: open read + write for all authenticated users. Recruiting data
-- is non-PII public reference; cache writes are idempotent (refresh replaces a year's
-- rows wholesale). DELETE is allowed for the refresh-truncate-insert flow but is also
-- not destructive — the data can always be re-fetched from CFD with one call.

CREATE TABLE IF NOT EXISTS recruits (
  id              text        PRIMARY KEY,
  year            integer     NOT NULL,
  ranking         integer,
  name            text        NOT NULL,
  position        text,
  stars           integer,
  rating          numeric,
  height          numeric,
  weight          numeric,
  school          text,
  committed_to    text,
  city            text,
  state_province  text,
  country         text,
  athlete_id      text,
  cached_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recruits_year_idx           ON recruits (year);
CREATE INDEX IF NOT EXISTS recruits_year_ranking_idx   ON recruits (year, ranking);
CREATE INDEX IF NOT EXISTS recruits_year_position_idx  ON recruits (year, position);

ALTER TABLE recruits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recruits_open_read"   ON recruits;
DROP POLICY IF EXISTS "recruits_open_write"  ON recruits;
DROP POLICY IF EXISTS "recruits_open_update" ON recruits;
DROP POLICY IF EXISTS "recruits_open_delete" ON recruits;
CREATE POLICY "recruits_open_read"   ON recruits FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "recruits_open_write"  ON recruits FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "recruits_open_update" ON recruits FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "recruits_open_delete" ON recruits FOR DELETE USING (auth.role() = 'authenticated');


CREATE TABLE IF NOT EXISTS recruits_meta (
  year                integer     PRIMARY KEY,
  last_refreshed_at   timestamptz NOT NULL DEFAULT now(),
  total_records       integer     NOT NULL DEFAULT 0,
  refreshed_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE recruits_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recruits_meta_open_read"   ON recruits_meta;
DROP POLICY IF EXISTS "recruits_meta_open_write"  ON recruits_meta;
DROP POLICY IF EXISTS "recruits_meta_open_update" ON recruits_meta;
CREATE POLICY "recruits_meta_open_read"   ON recruits_meta FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "recruits_meta_open_write"  ON recruits_meta FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "recruits_meta_open_update" ON recruits_meta FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
