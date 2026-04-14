-- ============================================================
-- DynastyZeus — shared API cache tables
-- Run once in the Supabase SQL editor.
-- These tables cache expensive external API calls so all users
-- benefit from a single upstream fetch per TTL window.
-- ============================================================

-- ── 1. FantasyCalc dynasty values ───────────────────────────
-- Keyed by num_qbs (1 or 2). 24-hour TTL enforced in code.
CREATE TABLE IF NOT EXISTS public.fc_values_cache (
  num_qbs   INTEGER PRIMARY KEY,
  data      JSONB       NOT NULL,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.fc_values_cache DISABLE ROW LEVEL SECURITY;

-- ── 2. Sleeper weekly player stats ──────────────────────────
-- Keyed by (season, week). Completed weeks never change, so
-- the code uses a 7-day TTL — effectively permanent.
CREATE TABLE IF NOT EXISTS public.sleeper_stats_cache (
  season    TEXT    NOT NULL,
  week      INTEGER NOT NULL,
  data      JSONB   NOT NULL,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (season, week)
);
ALTER TABLE public.sleeper_stats_cache DISABLE ROW LEVEL SECURITY;

-- ── 3. Cross-league roster lookups ──────────────────────────
-- Keyed by (sleeper_user_id, league_id). 6-hour TTL in code.
-- Eliminates the N-parallel Sleeper calls on page load.
CREATE TABLE IF NOT EXISTS public.cross_league_rosters_cache (
  sleeper_user_id TEXT        NOT NULL,
  league_id       TEXT        NOT NULL,
  roster          JSONB       NOT NULL,
  cached_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sleeper_user_id, league_id)
);
ALTER TABLE public.cross_league_rosters_cache DISABLE ROW LEVEL SECURITY;
