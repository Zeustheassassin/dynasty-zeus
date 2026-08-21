-- ============================================================
-- DynastyZeus — Migration 050
-- Run in the Supabase SQL editor after migration 049.
-- ============================================================
-- Retroactive GRANT remediation. Migration 037's comment claimed
-- pre-037 tables were "grandfathered" and needed no explicit
-- grants — that was wrong. Supabase's Oct 30 2026 change removes
-- default role privileges from EXISTING projects (this project
-- included), so it is exactly the tables created before this
-- policy was adopted (migrations 001–036) that are at risk, not
-- exempt from it. Full-codebase audit on 2026-08-21 found 35
-- tables across migrations 001, 003, 006–010, 015–018, 023–025
-- with zero GRANT statements. This migration is purely additive
-- (GRANT only) — no DROP/ALTER/DELETE.
--
-- Excluded on purpose:
--   - gm_briefings (013), player_dispositions (006) — both DROPped
--     in migrations 042/041 respectively; granting a dropped table
--     would error.
--   - owner_tendencies (006) — orphaned, zero application code
--     references it; owner explicitly chose to leave it untouched
--     rather than grant, drop, or reconfigure it (2026-08-21).
--
-- All tables below already have RLS enabled with a working policy
-- from their original migration (verified by audit) — this
-- migration only adds the missing GRANTs, it does not touch RLS.
-- ============================================================

-- ── 1. Shared, RLS-disabled external-API cache tables (001) ──
-- These are intentionally not scoped to a user (RLS disabled by
-- design — see 001's own comments: "so all users benefit from a
-- single upstream fetch"). Their API routes (app/api/fc-values,
-- app/api/stats/sleeper-weekly, app/api/cross-league-rosters) use
-- the anon-key client with no forwarded user session, so they can
-- run as Postgres role `anon` as well as `authenticated`.
GRANT SELECT, INSERT, UPDATE ON public.fc_values_cache            TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sleeper_stats_cache        TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cross_league_rosters_cache TO anon, authenticated;
GRANT ALL ON public.fc_values_cache            TO service_role;
GRANT ALL ON public.sleeper_stats_cache        TO service_role;
GRANT ALL ON public.cross_league_rosters_cache TO service_role;

-- ── 2. User-scoped tables (RLS "_self" policy = auth.uid() = user_id) ──
GRANT SELECT, INSERT, UPDATE, DELETE ON public.league_player_tags        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes                     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.league_notes              TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.league_management         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commissioner_payments     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rookie_board              TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchlists                TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alerts                    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consensus_draft_cache     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consensus_draft_meta      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_notes              TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_value_snapshots    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_attempts            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leaguemate_profiles       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.league_simulations        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.draft_board_picks         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consensus_player_grades   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rookie_board_tiers        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prospects                 TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scouting_games            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.route_plays               TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rb_plays                  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qb_plays                  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.te_plays                  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.big_board_snapshots       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_nfl_draft_info     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rookie_board_overrides    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recruits                  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recruits_meta             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_sleeper_links        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.league_transactions_cache TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.league_draft_snapshots    TO authenticated;

GRANT ALL ON public.league_player_tags        TO service_role;
GRANT ALL ON public.notes                     TO service_role;
GRANT ALL ON public.league_notes              TO service_role;
GRANT ALL ON public.league_management         TO service_role;
GRANT ALL ON public.commissioner_payments     TO service_role;
GRANT ALL ON public.rookie_board              TO service_role;
GRANT ALL ON public.watchlists                TO service_role;
GRANT ALL ON public.alerts                    TO service_role;
GRANT ALL ON public.consensus_draft_cache     TO service_role;
GRANT ALL ON public.consensus_draft_meta      TO service_role;
GRANT ALL ON public.player_notes              TO service_role;
GRANT ALL ON public.player_value_snapshots    TO service_role;
GRANT ALL ON public.trade_attempts            TO service_role;
GRANT ALL ON public.leaguemate_profiles       TO service_role;
GRANT ALL ON public.league_simulations        TO service_role;
GRANT ALL ON public.draft_board_picks         TO service_role;
GRANT ALL ON public.consensus_player_grades   TO service_role;
GRANT ALL ON public.rookie_board_tiers        TO service_role;
GRANT ALL ON public.prospects                 TO service_role;
GRANT ALL ON public.scouting_games            TO service_role;
GRANT ALL ON public.route_plays               TO service_role;
GRANT ALL ON public.rb_plays                  TO service_role;
GRANT ALL ON public.qb_plays                  TO service_role;
GRANT ALL ON public.te_plays                  TO service_role;
GRANT ALL ON public.big_board_snapshots       TO service_role;
GRANT ALL ON public.player_nfl_draft_info     TO service_role;
GRANT ALL ON public.rookie_board_overrides    TO service_role;
GRANT ALL ON public.recruits                  TO service_role;
GRANT ALL ON public.recruits_meta             TO service_role;
GRANT ALL ON public.user_sleeper_links        TO service_role;
GRANT ALL ON public.league_transactions_cache TO service_role;
GRANT ALL ON public.league_draft_snapshots    TO service_role;

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    -- Backfill 048's missing self-insert while we're here (verified
    -- by audit: every other post-037 migration records itself; 048
    -- was the one gap).
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('048_position_scouting_aggregates', 'backfilled by migration 050 — 048 itself never recorded this')
    ON CONFLICT (migration) DO NOTHING;

    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('050_retroactive_grants', 'GRANT remediation for 35 pre-037 tables missing explicit grants; corrects migration 037''s incorrect "grandfathered" comment')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
