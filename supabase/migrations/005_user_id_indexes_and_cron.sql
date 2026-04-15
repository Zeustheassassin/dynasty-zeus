-- ============================================================
-- Migration 005 — user_id indexes + pg_cron scheduling
-- ============================================================
-- What this migration does:
--   1. Adds user_id indexes on all RLS-protected tables that are
--      queried with a "WHERE user_id = $1" filter.  These turn
--      sequential scans into fast index scans as row counts grow.
--   2. Adds a user_id index on the public watchlists and alerts
--      tables (both filtered by user_id on every read).
--   3. Schedules evict_old_consensus_cache() via pg_cron so stale
--      consensus rows are purged automatically (commented out —
--      uncomment once you are on a Supabase Pro plan with pg_cron).
--
-- Each index is wrapped in a DO block that catches
-- "undefined_table" so this migration is safe to run before
-- migration 006 creates the user-data tables.  In the steady
-- state (schema.sql already applied or migration 006 has run)
-- the indexes are created normally.
--
-- Rollback (all safe — indexes only, no data changes):
--   DROP INDEX IF EXISTS idx_alerts_user_id;
--   DROP INDEX IF EXISTS idx_watchlists_user_id;
--   DROP INDEX IF EXISTS idx_league_notes_user_id;
--   DROP INDEX IF EXISTS idx_player_notes_user_id;
--   DROP INDEX IF EXISTS idx_player_dispositions_user_id;
--   DROP INDEX IF EXISTS idx_player_value_snapshots_user_id;
--   DROP INDEX IF EXISTS idx_leaguemate_profiles_user_id;
--   DROP INDEX IF EXISTS idx_rookie_board_user_id;
--   DROP INDEX IF EXISTS idx_rookie_board_tiers_user_id;
--   DROP INDEX IF EXISTS idx_league_management_user_id;
--   DROP INDEX IF EXISTS idx_commissioner_payments_user_id;
-- ============================================================


-- ── 1. alerts ────────────────────────────────────────────────
-- Every read/write filters on user_id; upsert conflict key is
-- (user_id, alert_id) so the index also speeds up conflict checks.
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON public.alerts (user_id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;


-- ── 2. watchlists ─────────────────────────────────────────────
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_watchlists_user_id ON public.watchlists (user_id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;


-- ── 3. league_notes ──────────────────────────────────────────
-- Loaded on login: SELECT ... WHERE user_id = $1
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_league_notes_user_id ON public.league_notes (user_id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;


-- ── 4. player_notes ──────────────────────────────────────────
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_player_notes_user_id ON public.player_notes (user_id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;


-- ── 5. player_dispositions ────────────────────────────────────
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_player_dispositions_user_id ON public.player_dispositions (user_id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;


-- ── 6. player_value_snapshots ────────────────────────────────
-- Single-row per user (UNIQUE on user_id implied by .single() call),
-- but an explicit index guarantees the lookup is an index scan.
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_player_value_snapshots_user_id ON public.player_value_snapshots (user_id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;


-- ── 7. leaguemate_profiles ────────────────────────────────────
-- Upserted and queried by user_id + league_id.
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_leaguemate_profiles_user_id ON public.leaguemate_profiles (user_id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;


-- ── 8. rookie_board ──────────────────────────────────────────
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_rookie_board_user_id ON public.rookie_board (user_id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;


-- ── 9. rookie_board_tiers ────────────────────────────────────
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_rookie_board_tiers_user_id ON public.rookie_board_tiers (user_id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;


-- ── 10. league_management ────────────────────────────────────
-- The primary key may already be (user_id, league_id), but if not,
-- this index covers the common "load all leagues for a commissioner"
-- query pattern.
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_league_management_user_id ON public.league_management (user_id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;


-- ── 11. commissioner_payments ────────────────────────────────
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_commissioner_payments_user_id ON public.commissioner_payments (user_id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;


-- ── 12. Schedule consensus cache eviction via pg_cron ─────────
-- Requires the pg_cron extension (available on Supabase Pro).
-- The function evict_old_consensus_cache() was created in migration 004.
-- Uncomment the block below once pg_cron is enabled on your project:

/*
SELECT cron.schedule(
  'dynastyzeus-evict-consensus-cache',  -- job name (unique)
  '0 3 * * 0',                          -- weekly, Sunday at 03:00 UTC
  $$ SELECT public.evict_old_consensus_cache(90); $$
);
*/

-- To verify index creation:
--   SELECT indexname, tablename
--   FROM pg_indexes
--   WHERE schemaname = 'public'
--     AND indexname LIKE 'idx_%_user_id'
--   ORDER BY tablename;
