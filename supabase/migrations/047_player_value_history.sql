-- ============================================================
-- DynastyZeus — Migration 047
-- Run in the Supabase SQL editor after migration 046.
-- ============================================================
-- Adds player_value_history — a dated, append-only sibling to
-- player_value_snapshots (which is a single-row-per-user upsert, see
-- app/hooks/useAppState.ts). This table instead holds one row per
-- (player_id, date) so a new daily cron (app/api/cron/player-value-history)
-- can accumulate a real time series for the Phase D stage D4/D5 "value
-- trend" charts, which have been 2-point comparisons (current vs. the
-- single stored snapshot) since Phase D shipped — see the
-- project_platform_upgrade_phase_d_july16 memory's "revisit once the
-- dust settles" note.
--
-- Not user-scoped, unlike player_value_snapshots: the value stored there
-- already comes from players[id].value — the single shared FantasyCalc
-- 2QB dynasty value (fc_values_cache, num_qbs=2) every user's client
-- merges onto the player map, not a league- or user-adjusted number (see
-- useAppState.ts's loadPlayers + the buildFullSnapshot comment). So one
-- daily row per player, written once by the cron, is correct for every
-- user — same reasoning as league_simulation_history (migration 044).
-- Purely additive — no DROP/ALTER on existing tables.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.player_value_history (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     text        NOT NULL,
  snapshot_date date        NOT NULL,
  value         integer     NOT NULL DEFAULT 0,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, snapshot_date)
);
ALTER TABLE public.player_value_history DISABLE ROW LEVEL SECURITY;

-- Index for the D4/D5 charts' per-player timeline query (`.in("player_id", …)`).
CREATE INDEX IF NOT EXISTS player_value_history_player
  ON public.player_value_history (player_id, snapshot_date);

-- RLS is disabled (shared, non-user-scoped cache — same trust model as
-- league_simulation_history / fc_values_cache). Only the cron (service-role
-- key) ever writes this table, so writes are restricted to service_role
-- while reads are open to anon/authenticated the same way every other
-- Sleeper/FantasyCalc-derived value already visible in the app is.
GRANT SELECT ON public.player_value_history TO anon, authenticated, service_role;
GRANT INSERT, UPDATE ON public.player_value_history TO service_role;

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('047_player_value_history', 'add daily dynasty-value history table for Phase D D4/D5 real trend charts')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
