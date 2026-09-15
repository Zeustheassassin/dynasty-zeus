-- ============================================================
-- DynastyZeus — Migration 053
-- Run in the Supabase SQL editor after migration 052.
-- ============================================================
-- Fixes a real production bug: fc_redraft_values_cache (043),
-- league_simulation_history (044), and player_value_history (047)
-- were each created with `DISABLE ROW LEVEL SECURITY`, but the live
-- database currently has RLS *enabled* with zero policies on all
-- three (confirmed via `pg_class.relrowsecurity` + `pg_policy` —
-- almost certainly Supabase's Security Advisor "RLS disabled"
-- warning getting one-click "Enable RLS"'d from the dashboard at
-- some point, the same warning migration 026 silenced for the
-- earlier cache tables, but without 026's follow-up permissive
-- policy this time).
--
-- Effect in production: RLS enabled + zero policies denies ALL rows
-- to anon/authenticated regardless of GRANT — only service_role
-- (which bypasses RLS) can read. So:
--   - The service-role cron (app/api/cron/simulation-history) writes
--     league_simulation_history fine — confirmed rows exist, including
--     from today's run — but the browser's anon-key read (useSimulation
--     History, useDashboardPlayoffOdds) silently gets zero rows back,
--     which is why the Dashboard's "Your Teams" cards show "No
--     simulator history yet" even though history has been accumulating
--     since 2026-08-26.
--   - app/api/fc-values/route.ts reads/writes fc_redraft_values_cache
--     with the anon-key client (not service-role) — every redraft-
--     values request has been a silent cache miss, round-tripping to
--     FantasyCalc's live API every time instead of using the cache.
--   - hooks/usePlayerValueHistory.ts (client-side) silently gets zero
--     rows from player_value_history despite 24k+ rows existing
--     server-side, always falling back to the 2-point snapshot chart.
--
-- Fix: same pattern as migration 026 — keep RLS enabled (it already
-- is; the ENABLE statements below are idempotent no-ops) and add the
-- permissive public-read policy each of these tables' own "DISABLE
-- ROW LEVEL SECURITY" comment always intended. Writes stay
-- service-role only (no INSERT/UPDATE policy added — service_role
-- bypasses RLS regardless, same as every other shared cache table).
--
-- Purely additive: zero DROP / DELETE / ALTER…DROP / TRUNCATE.
-- Policy creates use IF NOT EXISTS via DO blocks, matching 026.
-- ============================================================

ALTER TABLE public.fc_redraft_values_cache ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'fc_redraft_values_cache'
      AND policyname = 'fc_redraft_values_cache_public_read'
  ) THEN
    CREATE POLICY "fc_redraft_values_cache_public_read" ON public.fc_redraft_values_cache
      FOR SELECT USING (true);
  END IF;
END $$;

ALTER TABLE public.league_simulation_history ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'league_simulation_history'
      AND policyname = 'league_simulation_history_public_read'
  ) THEN
    CREATE POLICY "league_simulation_history_public_read" ON public.league_simulation_history
      FOR SELECT USING (true);
  END IF;
END $$;

ALTER TABLE public.player_value_history ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'player_value_history'
      AND policyname = 'player_value_history_public_read'
  ) THEN
    CREATE POLICY "player_value_history_public_read" ON public.player_value_history
      FOR SELECT USING (true);
  END IF;
END $$;

-- ── Record in the migration ledger ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('053_fix_rls_missing_policies', 'add missing public-read RLS policies on fc_redraft_values_cache/league_simulation_history/player_value_history — RLS was enabled with zero policies, silently blocking all anon/authenticated reads')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;

-- ── Verification (run after applying) ─────────────────────────
--
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN ('fc_redraft_values_cache','league_simulation_history','player_value_history');
--
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('fc_redraft_values_cache','league_simulation_history','player_value_history');
