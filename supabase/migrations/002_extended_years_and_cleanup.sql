-- ============================================================
-- DynastyZeus — Migration 002
-- Run in Supabase SQL editor after migration 001.
-- ============================================================
-- What this migration does:
--   1. Adds paid_2030 – paid_2033 columns to league_management
--      and commissioner_payments (pre-provisioned so the app
--      never writes to a non-existent column).
--   2. Adds updated_at column to commissioner_payments if missing.
--   3. Creates a cleanup function + cron job to purge stale
--      cache rows (cross_league_rosters_cache > 24 h old).
--   4. Adds indexes for efficient cache TTL checks.
--
-- NOTE: The app generates payment year columns dynamically from
-- the current year window (see lib/constants.ts → getPaymentYears).
-- The window is [currentYear … currentYear + 3], so the latest
-- column the app will write to equals currentYear + 3. With this
-- migration the highest provisioned column is paid_2033, which
-- covers app use through calendar year 2030 (writes 2030..2033).
-- Before Jan 1 2031 you MUST run migration 003 to add paid_2034
-- and beyond, or new payment writes will fail.
-- ============================================================


-- ── 1. Extend league_management with future year columns ─────

ALTER TABLE public.league_management
  ADD COLUMN IF NOT EXISTS paid_2030 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_2031 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_2032 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_2033 BOOLEAN NOT NULL DEFAULT false;


-- ── 2. Extend commissioner_payments with future year columns ──

ALTER TABLE public.commissioner_payments
  ADD COLUMN IF NOT EXISTS paid_2030 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_2031 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_2032 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_2033 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();


-- ── 3. Indexes for cache TTL queries ─────────────────────────
-- These allow efficient range-scans when the cleanup job runs
-- and when the API routes check freshness.

CREATE INDEX IF NOT EXISTS idx_cross_league_rosters_cached_at
  ON public.cross_league_rosters_cache (cached_at);

CREATE INDEX IF NOT EXISTS idx_sleeper_stats_cached_at
  ON public.sleeper_stats_cache (cached_at);

-- fc_values_cache only has 1-2 rows (one per num_qbs value),
-- so an index there provides no benefit.


-- ── 4. Cache cleanup function ─────────────────────────────────
-- Deletes rows older than their TTL from the two high-volume
-- cache tables. Safe to call repeatedly; uses IF EXISTS guards.
--
-- Retention policy:
--   cross_league_rosters_cache — 24 hours (rosters change daily)
--   sleeper_stats_cache        — 60 days  (completed weeks are
--                                          immutable but take up
--                                          space over seasons)

CREATE OR REPLACE FUNCTION public.cleanup_stale_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Cross-league rosters: keep 24 hours
  DELETE FROM public.cross_league_rosters_cache
  WHERE cached_at < NOW() - INTERVAL '24 hours';

  -- Weekly stats: keep 60 days
  DELETE FROM public.sleeper_stats_cache
  WHERE cached_at < NOW() - INTERVAL '60 days';
END;
$$;


-- ── 5. Schedule cleanup (requires pg_cron extension) ──────────
-- pg_cron is available on Supabase Pro plans.
-- If you are on the free plan, run cleanup_stale_cache()
-- manually from the SQL editor once per season instead.
--
-- Uncomment the block below if pg_cron is enabled on your project:

/*
SELECT cron.schedule(
  'dynastyzeus-cache-cleanup',   -- job name (unique)
  '0 4 * * *',                   -- daily at 04:00 UTC
  $$ SELECT public.cleanup_stale_cache(); $$
);
*/


-- ── Done ──────────────────────────────────────────────────────
-- To verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'league_management'
--   AND column_name LIKE 'paid_%'
--   ORDER BY column_name;
