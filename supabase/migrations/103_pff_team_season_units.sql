-- ============================================================
-- DynastyZeus — Migration 103
-- Run in the Supabase SQL editor after migration 102. The code that uses it
-- can deploy first: until this runs, the game-context fill skips the season
-- unit grades and writes everything else as before.
-- ============================================================
-- Season-long unit grades as game context (line season grades plan, Stage 1).
-- The user, 2026-11-19: "Full season grades for Oline Play and Dline play
-- would suffice ... include Defensive Pass Coverage Metrics for the WR and TE
-- Scores". FULL-SEASON grades, never same-game ones: a same-game grade moves
-- with the player's own day (why the same-game cast stays out of every score).
--
-- 1. pff_team_season — PFF's season report for one team, trimmed
--    (lib/pff/teamUnits.ts), one row per (user, season, franchise, report):
--      run_blocking  /v1/facet/offense/run_blocking   his team's line (RB games)
--      defense       /v1/facet/defense/summary        the opponent's defense
--    Kept so the measures (front seven, alignment weights) can change without
--    reading PFF again. A finished season is read once; the season in
--    progress is re-read when its copy is over a week old. Per user, owner-only
--    RLS like pff_game_offense (065): PFF data never leaves the user who
--    imported it.
--
-- 2. scouting_game_context gets each game's season units, computed from those
--    reports for THAT game's season and the two teams that played it:
--      opp_pff_franchise_id        the opponent's PFF franchise
--      ol_run_block_season(_snaps) his team's OL season run-block grade (RB games)
--      opp_front7_run_def(_snaps)  the opponent's front seven (DI + ED + LB) run defense
--      opp_cov_outside / _slot / _box (_snaps)
--                                  the opponent's coverage grade, weighted by each
--                                  defender's corner / slot / box snaps
--      opp_mt_rate                 the opponent's missed-tackle rate, % (all defenders)
--      opp_tackle_attempts         tackles + assists + misses behind that rate
--      opp_season_games            games PFF charted the opponent that season
--      team_season_games           and his team (RB games): a report from one
--                                  or two games (an FCS team PFF saw only
--                                  against FBS teams, maybe only this game) is
--                                  really a same-game grade, so the grading
--                                  needs a full season behind each
--      season_units_status         ok / no_pff / no_team / no_data / n/a (QB games)
--      season_units_at             when the oldest report used was read
--    The _snaps columns are the snap weight behind each grade, so a thin
--    report (an FCS opponent PFF charted once or twice) can be told apart.
--
-- Purely additive: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- policy created only when missing, explicit grants, index, ledger row.
-- No DROP, DELETE or TRUNCATE.
-- ============================================================

-- ── 1. PFF season reports ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pff_team_season (
  user_id      uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  season       integer     NOT NULL,
  franchise_id integer     NOT NULL,
  report       text        NOT NULL CHECK (report IN ('run_blocking', 'defense')),
  rows         jsonb       NOT NULL,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, season, franchise_id, report)
);

ALTER TABLE public.pff_team_season ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pff_team_season' AND policyname = 'pff_team_season_self'
  ) THEN
    CREATE POLICY "pff_team_season_self" ON public.pff_team_season FOR ALL
      USING      (auth.uid()::text = user_id::text)
      WITH CHECK (auth.uid()::text = user_id::text);
  END IF;
END $$;

-- Explicit grants (Supabase removed implicit default grants, Oct 30 2026). No anon.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pff_team_season TO authenticated;
GRANT ALL ON public.pff_team_season TO service_role;

COMMENT ON TABLE public.pff_team_season IS
  'PFF season report for one team (run_blocking: its line; defense: its defense summary), players trimmed (lib/pff/teamUnits.ts). Per user; never in shared views (migration 103).';

-- ── 2. Season units on each charted game ─────────────────────
ALTER TABLE public.scouting_game_context ADD COLUMN IF NOT EXISTS opp_pff_franchise_id      integer;
ALTER TABLE public.scouting_game_context ADD COLUMN IF NOT EXISTS ol_run_block_season       numeric(4,1);
ALTER TABLE public.scouting_game_context ADD COLUMN IF NOT EXISTS ol_run_block_season_snaps integer;
ALTER TABLE public.scouting_game_context ADD COLUMN IF NOT EXISTS opp_front7_run_def        numeric(4,1);
ALTER TABLE public.scouting_game_context ADD COLUMN IF NOT EXISTS opp_front7_run_def_snaps  integer;
ALTER TABLE public.scouting_game_context ADD COLUMN IF NOT EXISTS opp_cov_outside           numeric(4,1);
ALTER TABLE public.scouting_game_context ADD COLUMN IF NOT EXISTS opp_cov_outside_snaps     integer;
ALTER TABLE public.scouting_game_context ADD COLUMN IF NOT EXISTS opp_cov_slot              numeric(4,1);
ALTER TABLE public.scouting_game_context ADD COLUMN IF NOT EXISTS opp_cov_slot_snaps        integer;
ALTER TABLE public.scouting_game_context ADD COLUMN IF NOT EXISTS opp_cov_box               numeric(4,1);
ALTER TABLE public.scouting_game_context ADD COLUMN IF NOT EXISTS opp_cov_box_snaps         integer;
ALTER TABLE public.scouting_game_context ADD COLUMN IF NOT EXISTS opp_mt_rate               numeric(4,1);
ALTER TABLE public.scouting_game_context ADD COLUMN IF NOT EXISTS opp_tackle_attempts       integer;
ALTER TABLE public.scouting_game_context ADD COLUMN IF NOT EXISTS opp_season_games          integer;
ALTER TABLE public.scouting_game_context ADD COLUMN IF NOT EXISTS team_season_games         integer;
ALTER TABLE public.scouting_game_context ADD COLUMN IF NOT EXISTS season_units_status       text;
ALTER TABLE public.scouting_game_context ADD COLUMN IF NOT EXISTS season_units_at           timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scouting_game_context_season_units_status_valid'
  ) THEN
    ALTER TABLE public.scouting_game_context
      ADD CONSTRAINT scouting_game_context_season_units_status_valid
      CHECK (season_units_status IS NULL OR season_units_status IN ('ok', 'no_pff', 'no_team', 'no_data', 'n/a'));
  END IF;
END $$;

COMMENT ON COLUMN public.scouting_game_context.ol_run_block_season IS
  'His team''s OL run-block grade over that whole season (PFF, snap-weighted; RB games). Not the same-game ol_run_block (migration 103).';
COMMENT ON COLUMN public.scouting_game_context.opp_front7_run_def IS
  'The opponent''s front seven (DI + ED + LB) run-defense grade over that season, snap-weighted (migration 103).';
COMMENT ON COLUMN public.scouting_game_context.opp_cov_outside IS
  'The opponent''s coverage grade over that season, weighted by each defender''s snaps at corner; _slot and _box likewise (migration 103).';
COMMENT ON COLUMN public.scouting_game_context.opp_mt_rate IS
  'The opponent''s missed-tackle rate over that season, %: misses / (tackles + assists + misses), all defenders (migration 103).';
COMMENT ON COLUMN public.scouting_game_context.opp_season_games IS
  'Games PFF charted the opponent that season (the most any of its defenders played); team_season_games likewise for his own team (migration 103).';
COMMENT ON COLUMN public.scouting_game_context.season_units_status IS
  'ok = season units filled; no_pff = game not linked to PFF; no_team = his team or the opponent unknown; no_data = PFF had no defense report for the opponent that season; n/a = a QB game (not used). NULL = not looked up yet (migration 103).';

-- PostgREST picks up the new table and columns.
NOTIFY pgrst, 'reload schema';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('103_pff_team_season_units', 'pff_team_season (PFF season run_blocking / defense reports per team) and season unit grades on scouting_game_context: own OL run block, opp front seven run D, opp coverage outside / slot / box, opp MT rate, games behind each')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
