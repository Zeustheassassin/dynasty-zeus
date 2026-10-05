-- ============================================================
-- DynastyZeus — Migration 065
-- Run in the Supabase SQL editor after migration 064.
-- ============================================================
-- Stage 5 of the tape-grading expansion: automatic per-game context for
-- every charted game (opponent defense SP+, weather, supporting cast), the
-- left-early and played-hurt game flags, and per-game trait grades.
--
-- Shared, public data (CollegeFootballData + Open-Meteo), cached once for
-- every user like `recruits` (018): any signed-in user can read, add and
-- refresh rows (the server route writes them with the caller's token); no
-- delete, no anon access. They hold no PFF data.
--
-- 1. cfd_games          — every FBS game of a fetched season (CFD /games):
--                         kickoff, venue, teams, final score; plus the
--                         game-window weather, filled for charted games.
-- 2. cfd_venues         — CFD /venues: latitude / longitude, dome.
-- 3. cfd_team_seasons   — CFD /ratings/sp: each FBS team's SP+ per season
--                         (overall, offense, defense). FCS teams have none.
-- 4. cfd_fetch_log      — when each CFD list was last fetched, so the ~1,000
--                         calls/month free tier (shared with Recruits) is
--                         spent once per season, not per visit.
--
-- Per user, owner-only RLS like every scouting table (PFF data never leaves
-- the user who imported it):
--
-- 5. scouting_game_context — one row per charted game: its CFD game, his team
--                         and the opponent as CFD names them, and his
--                         supporting cast from PFF (line pass / run block
--                         grades, his QB's passing grade, team snaps).
-- 6. pff_game_offense   — PFF's offense facet for one PFF game (both teams'
--                         players, trimmed), so the cast can be recomputed
--                         without reading PFF again.
--
-- And three columns on scouting_games, all the user's own per-game calls:
--   played_hurt  — a manual toggle; may be set on old games.
--   left_early   — NULL = not reviewed, true = he left early (confirmed),
--                  false = he didn't (an auto flag dismissed).
--   trait_grades — {"arm": 7, ...}: 1–10 per trait, new games only (the app
--                  decides which games and traits); NULL = not graded.
--
-- Purely additive: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, policies created only when missing, explicit
-- grants, indexes, ledger row. No DROP, DELETE or TRUNCATE.
-- ============================================================

-- ── 1–4. Shared CFD / weather cache ──────────────────────────
CREATE TABLE IF NOT EXISTS public.cfd_games (
  id                  integer     PRIMARY KEY,
  season              integer     NOT NULL,
  week                integer,
  season_type         text,
  start_date          timestamptz,
  start_time_tbd      boolean,
  completed           boolean,
  neutral_site        boolean,
  venue_id            integer,
  venue               text,
  home_team           text        NOT NULL,
  home_classification text,
  home_points         integer,
  away_team           text        NOT NULL,
  away_classification text,
  away_points         integer,
  fetched_at          timestamptz NOT NULL DEFAULT now(),
  -- Game-window weather (kickoff hour + 3), Open-Meteo archive.
  weather_status      text CHECK (weather_status IS NULL OR weather_status IN ('ok', 'dome', 'no_location', 'pending')),
  temperature_f       numeric(5,1),
  wind_mph            numeric(5,1),
  humidity            numeric(4,1),
  gust_mph            numeric(5,1),
  precip_in           numeric(5,2),
  snow_in             numeric(5,2),
  weather_code        smallint,
  weather_fetched_at  timestamptz
);

CREATE TABLE IF NOT EXISTS public.cfd_venues (
  id         integer     PRIMARY KEY,
  name       text,
  city       text,
  state      text,
  latitude   double precision,
  longitude  double precision,
  elevation  double precision,
  dome       boolean,
  grass      boolean,
  timezone   text,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cfd_team_seasons (
  season             integer     NOT NULL,
  school             text        NOT NULL,
  conference         text,
  sp_rating          numeric(6,2),
  sp_offense         numeric(6,2),
  sp_defense         numeric(6,2),
  sp_ranking         integer,
  sp_defense_ranking integer,
  fetched_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, school)
);

CREATE TABLE IF NOT EXISTS public.cfd_fetch_log (
  key             text        PRIMARY KEY,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  rows            integer,
  calls_remaining integer
);

ALTER TABLE public.cfd_games        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cfd_venues       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cfd_team_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cfd_fetch_log    ENABLE ROW LEVEL SECURITY;

-- Shared cache: any signed-in user reads, adds and refreshes (no delete).
-- Created only when missing, so a re-run is a no-op (no DROP POLICY).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cfd_games', 'cfd_venues', 'cfd_team_seasons', 'cfd_fetch_log'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_read') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (auth.role() = ''authenticated'')', t || '_read', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_insert') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (auth.role() = ''authenticated'')', t || '_insert', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_update') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (auth.role() = ''authenticated'') WITH CHECK (auth.role() = ''authenticated'')', t || '_update', t);
    END IF;
  END LOOP;
END $$;

-- Explicit grants (Supabase removes implicit default grants on new objects,
-- Oct 30 2026). No anon grant; no DELETE for users.
GRANT SELECT, INSERT, UPDATE ON public.cfd_games        TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cfd_venues       TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cfd_team_seasons TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cfd_fetch_log    TO authenticated;
GRANT ALL ON public.cfd_games        TO service_role;
GRANT ALL ON public.cfd_venues       TO service_role;
GRANT ALL ON public.cfd_team_seasons TO service_role;
GRANT ALL ON public.cfd_fetch_log    TO service_role;

CREATE INDEX IF NOT EXISTS idx_cfd_games_season ON public.cfd_games (season);

COMMENT ON TABLE public.cfd_games IS
  'CollegeFootballData FBS games per fetched season (shared cache), plus game-window weather from the Open-Meteo archive for charted games (migration 065).';
COMMENT ON TABLE public.cfd_team_seasons IS
  'CollegeFootballData SP+ per FBS team-season (shared cache). sp_defense: points allowed vs an average offense, lower is better (migration 065).';
COMMENT ON TABLE public.cfd_fetch_log IS
  'When each CollegeFootballData list was last fetched (games:<season>, sp:<season>, venues): keeps the shared ~1,000 calls/month budget (migration 065).';

-- ── 5–6. Per-user game context ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.scouting_game_context (
  game_id             uuid        PRIMARY KEY REFERENCES public.scouting_games(id) ON DELETE CASCADE,
  user_id             uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  prospect_id         uuid        NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  -- The CFD game (venue, kickoff, score, weather) and the two teams.
  cfd_game_id         integer,
  cfd_match_status    text CHECK (cfd_match_status IS NULL OR cfd_match_status IN ('auto', 'no_match')),
  cfd_match_note      text,
  team_school         text,
  opponent_school     text,
  -- Supporting cast (PFF, his team in this game).
  cast_status         text CHECK (cast_status IS NULL OR cast_status IN ('ok', 'no_pff', 'no_team')),
  pff_franchise_id    integer,
  team_snaps          integer,
  his_snaps           integer,
  ol_pass_block       numeric(4,1),
  ol_pass_block_snaps integer,
  ol_run_block        numeric(4,1),
  ol_run_block_snaps  integer,
  qb_pass_grade       numeric(4,1),
  qb_name             text,
  qb_pff_id           integer,
  qb_dropbacks        integer,
  fetched_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pff_game_offense (
  user_id     uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  pff_game_id integer     NOT NULL,
  rows        jsonb       NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pff_game_id)
);

ALTER TABLE public.scouting_game_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pff_game_offense      ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'scouting_game_context' AND policyname = 'scouting_game_context_self'
  ) THEN
    CREATE POLICY "scouting_game_context_self" ON public.scouting_game_context FOR ALL
      USING      (auth.uid()::text = user_id::text)
      WITH CHECK (auth.uid()::text = user_id::text);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pff_game_offense' AND policyname = 'pff_game_offense_self'
  ) THEN
    CREATE POLICY "pff_game_offense_self" ON public.pff_game_offense FOR ALL
      USING      (auth.uid()::text = user_id::text)
      WITH CHECK (auth.uid()::text = user_id::text);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scouting_game_context TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pff_game_offense      TO authenticated;
GRANT ALL ON public.scouting_game_context TO service_role;
GRANT ALL ON public.pff_game_offense      TO service_role;

CREATE INDEX IF NOT EXISTS idx_scouting_game_context_prospect ON public.scouting_game_context (prospect_id);
CREATE INDEX IF NOT EXISTS idx_scouting_game_context_user     ON public.scouting_game_context (user_id);

COMMENT ON TABLE public.scouting_game_context IS
  'Per charted game: its CollegeFootballData game and teams, and the supporting cast from PFF (line block grades, his QB''s passing grade, snaps). Per user (migration 065).';
COMMENT ON TABLE public.pff_game_offense IS
  'PFF offense facet for one PFF game, both teams'' players trimmed (lib/pff/cast.ts). Per user; never in shared views (migration 065).';

-- ── Game flags and trait grades on scouting_games ────────────
-- trait_grades: an object whose values are whole numbers 1–10.
CREATE OR REPLACE FUNCTION public.valid_trait_grades(g jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT jsonb_typeof(g) = 'object'
     AND NOT EXISTS (
       -- CASE, not OR: the cast to int must only run on a 1–2 digit number.
       SELECT 1 FROM jsonb_each(g) AS e(k, v)
       WHERE CASE
         WHEN jsonb_typeof(e.v) <> 'number' THEN true
         WHEN (e.v)::text !~ '^[0-9]{1,2}$' THEN true
         ELSE (e.v)::text::int NOT BETWEEN 1 AND 10
       END
     );
$fn$;

ALTER TABLE public.scouting_games ADD COLUMN IF NOT EXISTS played_hurt  boolean NOT NULL DEFAULT false;
ALTER TABLE public.scouting_games ADD COLUMN IF NOT EXISTS left_early   boolean;
ALTER TABLE public.scouting_games ADD COLUMN IF NOT EXISTS trait_grades jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scouting_games_trait_grades_valid'
  ) THEN
    ALTER TABLE public.scouting_games
      ADD CONSTRAINT scouting_games_trait_grades_valid
      CHECK (trait_grades IS NULL OR public.valid_trait_grades(trait_grades));
  END IF;
END $$;

COMMENT ON COLUMN public.scouting_games.played_hurt IS
  'The user''s call: he played this game hurt. May be set on old games (migration 065).';
COMMENT ON COLUMN public.scouting_games.left_early IS
  'NULL = not reviewed; true = he left the game early (confirmed); false = he didn''t (auto flag dismissed) (migration 065).';
COMMENT ON COLUMN public.scouting_games.trait_grades IS
  'Per-game trait grades, 1–10 per trait key, new games only; NULL = not graded (migration 065).';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('065_game_context', 'Shared CFD cache (cfd_games + weather, cfd_venues, cfd_team_seasons, cfd_fetch_log), per-user scouting_game_context and pff_game_offense, and scouting_games.played_hurt / left_early / trait_grades for the Stage 5 game context')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
