-- ============================================================
-- DynastyZeus — Migration 037
-- Run in the Supabase SQL editor after migration 036.
-- ============================================================
-- Audit batch B8 — two additive, non-destructive changes:
--   1. Index consensus_draft_cache(computed_at) so the weekly
--      eviction cron (evict_old_consensus_cache → DELETE … WHERE
--      computed_at < now() - 90d, migrations 004/026/027) is a
--      range scan instead of a full table scan.
--   2. Add an applied_migrations ledger so there is an in-DB
--      record of which numbered migrations have been run. The
--      project applies migrations by hand in the SQL editor, so
--      this is maintained manually: after running a new migration,
--      INSERT its filename stem here. The table is seeded below
--      with the 001–037 history (applied_at left NULL = "applied
--      before this ledger existed; exact time unknown").
-- Both statements are idempotent (IF NOT EXISTS / ON CONFLICT).
-- ============================================================


-- ── 1. consensus_draft_cache(computed_at) index ──────────────
-- Plain (non-CONCURRENT) so it is safe inside the migration's
-- transaction; the table is tiny at this app's scale.
CREATE INDEX IF NOT EXISTS idx_consensus_draft_cache_computed_at
  ON public.consensus_draft_cache (computed_at);


-- ── 2. applied_migrations ledger ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.applied_migrations (
  migration  TEXT        PRIMARY KEY,        -- filename stem, e.g. '037_consensus_index_and_migration_ledger'
  applied_at TIMESTAMPTZ DEFAULT NOW(),      -- NULL for rows backfilled below
  note       TEXT
);

ALTER TABLE public.applied_migrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "applied_migrations_read" ON public.applied_migrations;
CREATE POLICY "applied_migrations_read" ON public.applied_migrations
  FOR SELECT USING (true);

-- Explicit grants: Supabase removes implicit default grants on new
-- objects (Oct 30 2026), so spell them out. Read-only for app users;
-- the service role (cron / server) gets full access.
GRANT SELECT ON public.applied_migrations TO authenticated;
GRANT ALL    ON public.applied_migrations TO service_role;

-- Seed the existing history. applied_at NULL = recorded retroactively.
INSERT INTO public.applied_migrations (migration, applied_at, note)
SELECT stem, NULL, 'backfilled by migration 037'
FROM unnest(ARRAY[
  '001_cache_tables',
  '002_extended_years_and_cleanup',
  '003_core_players',
  '004_indexes_and_ttl',
  '005_user_id_indexes_and_cron',
  '006_consolidate_schema',
  '007_scouting_tables',
  '007b_scouting_seed',
  '007c_scouting_uid_defaults',
  '007d_route_plays_v2',
  '007e_route_plays_was_open',
  '007f_scouting_game_summary',
  '007g_charting_decision_rename',
  '007h_route_plays_no_route_run',
  '008_rb_tables',
  '008b_rb_route_plays',
  '009_qb_tables',
  '010_te_tables',
  '011_overall_rank',
  '012_qb_timing_sack_throwaway',
  '013_gm_briefings',
  '014_rb_plays_extensions',
  '015_big_board_snapshots',
  '016_player_nfl_draft_info',
  '017_rookie_board_overrides',
  '018_recruits',
  '019_recruits_position_stars_view',
  '020_scouting_aggregate_views',
  '021_scouting_game_route_stats',
  '022_scouting_game_snap_stats',
  '023_user_sleeper_links',
  '024_league_transactions_cache',
  '025_league_draft_snapshots',
  '026_security_advisor_fixes',
  '027_enable_cron_cleanup',
  '028_qb_throws_te_routes',
  '029_te_positioning_wing_back',
  '030_te_play_type_decoy',
  '031_qb_accuracy_tipped_ball',
  '032_qb_platform_pressure',
  '033_drop_prospects_synopsis',
  '034_qb_touch',
  '035_prospects_drop_year_default',
  '036_extend_payment_years_2034_2037'
]) AS stem
ON CONFLICT (migration) DO NOTHING;

-- Record this migration itself (with a real timestamp).
INSERT INTO public.applied_migrations (migration, note)
VALUES ('037_consensus_index_and_migration_ledger', 'consensus computed_at index + this ledger')
ON CONFLICT (migration) DO NOTHING;
