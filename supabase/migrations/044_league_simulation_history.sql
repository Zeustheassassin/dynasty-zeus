-- ============================================================
-- DynastyZeus — Migration 044
-- Run in the Supabase SQL editor after migration 043.
-- ============================================================
-- Adds league_simulation_history — a dated, append-only sibling
-- to league_simulations (migration 006). league_simulations is a
-- per-user "last run" cache (UNIQUE user_id, league_id, roster_id;
-- every client-side "Run All Sims" click overwrites it). This table
-- instead holds one row per (league, roster, season, week) so a
-- new weekly cron (app/api/cron/simulation-history) can accumulate
-- a real history for the Phase F "playoff/title odds tracker" chart
-- (V3). Purely additive — no DROP/ALTER on existing tables.
-- Part of Phase F stage F1, per the July 15 2026 platform-upgrade
-- plan (decision #2: weekly cron across all leagues).
--
-- Not user-scoped, unlike league_simulations: simulation results
-- are a pure function of the league (rosters, scoring, values), not
-- of who happened to click "run." A league shared by several
-- registered users is simulated once per week by the cron and
-- produces one shared row set, keyed only by league_id/roster_id.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.league_simulation_history (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id     text        NOT NULL,
  roster_id     integer     NOT NULL,
  season        text        NOT NULL,
  week          integer     NOT NULL DEFAULT 0,
  playoff_odds  real        NOT NULL DEFAULT 0,
  title_odds    real        NOT NULL DEFAULT 0,
  expected_wins real        NOT NULL DEFAULT 0,
  avg_finish    real        NOT NULL DEFAULT 0,
  finish_range  text        NOT NULL DEFAULT '',
  computed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_id, roster_id, season, week)
);
ALTER TABLE public.league_simulation_history DISABLE ROW LEVEL SECURITY;

-- Index for the F2 chart's per-league timeline query.
CREATE INDEX IF NOT EXISTS league_simulation_history_league
  ON public.league_simulation_history (league_id, roster_id);

-- RLS is disabled (shared, non-user-scoped cache — same trust model as
-- fc_values_cache). Only the cron (service-role key) ever writes this
-- table, so writes are restricted to service_role while reads are open
-- to anon/authenticated the same way every other Sleeper-derived value
-- already visible in the app is.
GRANT SELECT ON public.league_simulation_history TO anon, authenticated, service_role;
GRANT INSERT, UPDATE ON public.league_simulation_history TO service_role;

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('044_league_simulation_history', 'add weekly odds-snapshot history table for Phase F simulator-history cron (F1)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
