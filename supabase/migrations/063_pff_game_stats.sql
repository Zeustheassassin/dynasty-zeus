-- ============================================================
-- DynastyZeus — Migration 063
-- Run in the Supabase SQL editor after migration 062.
-- ============================================================
-- Stage 2 of the tape-grading expansion: PFF's numbers for exactly the games
-- the user charted (never season totals). Written by /api/pff/import as the
-- signed-in user, under owner-only RLS, from the links migration 062 made.
-- PFF's redistribution terms are unverified, so these rows stay per user:
-- no view, shared table or consensus job reads them.
--
-- Two tables, because PFF's grades can't be added up:
--
-- 1. prospect_game_pff — one row per matched charted game: PFF's per-game
--    rows for the player (raw, by report) plus the counts the app shows.
--    Counts summed over charted games equal PFF's own total for those games
--    (checked 2026-10-05: Carnell Tate's 7 charted 2025 games, every count).
--
-- 2. prospect_season_pff — one row per prospect and season: PFF's own
--    aggregate over exactly the charted weeks of that season (the player
--    reports take a week list). It carries what a sum can't give: grades
--    (Tate's 7 games average 76.4 by snaps, PFF's grade over them is 88.9),
--    exact aDOT, and the splits PFF only reports as aggregates (play action,
--    blitz, 20+ yard targets, man / zone, team dropbacks). pff_game_ids
--    records which games it covers, so the app can tell when a link changed
--    and the row needs a refresh.
--
-- Every stat column is nullable (no PFF row for that report = NULL). raw keeps
-- PFF's rows as returned, so later stages can read other columns without
-- re-fetching.
--
-- Purely additive: CREATE TABLE IF NOT EXISTS, RLS, explicit grants, indexes.
-- No DROP, DELETE or TRUNCATE.
-- ============================================================

-- ── 1. Per charted game ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prospect_game_pff (
  game_id        uuid        PRIMARY KEY REFERENCES public.scouting_games(id) ON DELETE CASCADE,
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prospect_id    uuid        NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  pff_player_id  integer     NOT NULL,
  pff_game_id    integer     NOT NULL,
  season         integer     NOT NULL,
  week           integer     NOT NULL,
  franchise_id   integer,
  pff_position   text,
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  raw            jsonb       NOT NULL,

  -- snaps and grades (one game)
  snaps            integer,
  grade_offense    numeric(4,1),
  grade_pass       numeric(4,1),
  grade_run        numeric(4,1),
  grade_pass_route numeric(4,1),
  grade_run_block  numeric(4,1),
  grade_pass_block numeric(4,1),
  grade_hands_drop numeric(4,1),

  -- passing (QB)
  dropbacks       integer,
  all_dropbacks   integer,
  attempts        integer,
  all_attempts    integer,
  aimed_passes    integer,
  completions     integer,
  pass_yards      integer,
  pass_td         integer,
  interceptions   integer,
  btt             integer,
  twp             integer,
  sacks           integer,
  throwaways      integer,
  rec_drops       integer,
  pressures_faced integer,
  ttt_total       numeric(8,2),
  pass_adot       numeric(5,1),

  -- rushing (QB, RB)
  rush_att          integer,
  rush_yards        integer,
  designed_yards    integer,
  scrambles         integer,
  scramble_yards    integer,
  yco               integer,
  rush_mtf          integer,
  rush_15plus       integer,
  rush_15plus_yards integer,
  rush_10plus       integer,
  gap_att           integer,
  zone_att          integer,
  rush_td           integer,
  fumbles           integer,

  -- receiving (RB, WR, TE)
  routes               integer,
  pass_plays           integer,
  targets              integer,
  receptions           integer,
  rec_yards            integer,
  yac                  integer,
  rec_mtf              integer,
  drops                integer,
  contested_targets    integer,
  contested_receptions integer,
  rec_td               integer,
  rec_adot             numeric(5,1),
  slot_snaps           integer,
  wide_snaps           integer,
  inline_snaps         integer,

  -- blocking (RB, WR, TE)
  block_snaps       integer,
  run_block_snaps   integer,
  pass_block_snaps  integer,
  pressures_allowed integer,
  sacks_allowed     integer
);

-- ── 2. Per prospect and season (PFF's aggregate over the charted weeks) ──
CREATE TABLE IF NOT EXISTS public.prospect_season_pff (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prospect_id    uuid        NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  pff_player_id  integer     NOT NULL,
  season         integer     NOT NULL,
  pff_game_ids   integer[]   NOT NULL,
  weeks          integer[]   NOT NULL,
  franchise_ids  integer[]   NOT NULL DEFAULT '{}',
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  raw            jsonb       NOT NULL,
  UNIQUE (prospect_id, season),

  -- grades over exactly these games (not an average of game grades)
  grade_offense    numeric(4,1),
  grade_pass       numeric(4,1),
  grade_run        numeric(4,1),
  grade_pass_route numeric(4,1),
  grade_run_block  numeric(4,1),
  grade_pass_block numeric(4,1),
  grade_hands_drop numeric(4,1),
  pass_adot        numeric(5,1),
  rec_adot         numeric(5,1),

  -- QB: play action vs not, blitzed vs not
  pa_dropbacks integer, pa_attempts integer, pa_aimed integer, pa_completions integer, pa_drops integer,
  pa_yards integer, pa_btt integer, pa_twp integer, pa_sacks integer,
  npa_dropbacks integer, npa_attempts integer, npa_aimed integer, npa_completions integer, npa_drops integer,
  npa_yards integer, npa_btt integer, npa_twp integer, npa_sacks integer,
  blitz_dropbacks integer, blitz_attempts integer, blitz_aimed integer, blitz_completions integer, blitz_drops integer,
  blitz_yards integer, blitz_btt integer, blitz_twp integer, blitz_sacks integer,
  no_blitz_dropbacks integer, no_blitz_attempts integer, no_blitz_aimed integer, no_blitz_completions integer, no_blitz_drops integer,
  no_blitz_yards integer, no_blitz_btt integer, no_blitz_twp integer, no_blitz_sacks integer,

  -- WR / TE: 20+ yard targets, man vs zone, the team's dropbacks in these games
  deep_targets    integer,
  deep_receptions integer,
  deep_yards      integer,
  man_routes      integer,
  man_targets     integer,
  man_receptions  integer,
  man_yards       integer,
  zone_routes     integer,
  zone_targets    integer,
  zone_receptions integer,
  zone_yards      integer,
  team_dropbacks  integer
);

-- ── RLS: owner-only, like every scouting table ───────────────
ALTER TABLE public.prospect_game_pff   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_season_pff ENABLE ROW LEVEL SECURITY;

-- Created only when missing, so a re-run is a no-op (no DROP POLICY).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'prospect_game_pff' AND policyname = 'prospect_game_pff_self'
  ) THEN
    CREATE POLICY "prospect_game_pff_self" ON public.prospect_game_pff FOR ALL
      USING      (auth.uid()::text = user_id::text)
      WITH CHECK (auth.uid()::text = user_id::text);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'prospect_season_pff' AND policyname = 'prospect_season_pff_self'
  ) THEN
    CREATE POLICY "prospect_season_pff_self" ON public.prospect_season_pff FOR ALL
      USING      (auth.uid()::text = user_id::text)
      WITH CHECK (auth.uid()::text = user_id::text);
  END IF;
END $$;

-- Explicit grants: Supabase removes implicit default grants on new objects
-- (Oct 30 2026). The app writes as the signed-in user's own client (RLS-
-- scoped), never the service role. No anon grant: PFF data is never public.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prospect_game_pff   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prospect_season_pff TO authenticated;
GRANT ALL ON public.prospect_game_pff   TO service_role;
GRANT ALL ON public.prospect_season_pff TO service_role;

CREATE INDEX IF NOT EXISTS idx_prospect_game_pff_prospect   ON public.prospect_game_pff (prospect_id);
CREATE INDEX IF NOT EXISTS idx_prospect_game_pff_user       ON public.prospect_game_pff (user_id);
CREATE INDEX IF NOT EXISTS idx_prospect_season_pff_user     ON public.prospect_season_pff (user_id);

COMMENT ON TABLE public.prospect_game_pff IS
  'PFF per-game stats for a matched charted game (migration 063). Per user; never in shared views.';
COMMENT ON TABLE public.prospect_season_pff IS
  'PFF''s own aggregate over exactly the charted weeks of one season: grades, aDOT and split totals (migration 063). Per user.';
COMMENT ON COLUMN public.prospect_season_pff.pff_game_ids IS
  'The PFF games this aggregate covers. If the prospect''s imported games that season differ, the row is out of date.';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('063_pff_game_stats', 'Per-user PFF stats for matched charted games (prospect_game_pff) and PFF''s aggregate over the charted weeks per season (prospect_season_pff)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
