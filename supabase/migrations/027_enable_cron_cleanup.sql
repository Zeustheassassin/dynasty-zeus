-- ============================================================
-- Migration 027 — Enable pg_cron cleanup schedules
-- ============================================================
-- Schedules the two housekeeping functions (created in migrations
-- 002 and 004, hardened in migration 026) to run automatically via
-- pg_cron. These were originally commented out in 002 and 005
-- because pg_cron wasn't enabled yet — Supabase Pro now allows it.
--
-- Schedules:
--   dynastyzeus-cache-cleanup           daily 04:00 UTC
--     → cleanup_stale_cache()
--       Deletes cross_league_rosters_cache rows > 24h old
--       Deletes sleeper_stats_cache rows > 60d old
--
--   dynastyzeus-evict-consensus-cache   weekly Sun 03:00 UTC
--     → evict_old_consensus_cache(90)
--       Deletes consensus_draft_cache rows > 90d old
--
-- pg_cron jobs run as the postgres role, which bypasses the
-- EXECUTE grants revoked in migration 026 — so the cron jobs
-- still work even though PUBLIC/authenticated/anon can't call
-- these functions directly.
--
-- Prereq: the pg_cron extension must be enabled. Migration tries
-- to enable it via CREATE EXTENSION IF NOT EXISTS; if that fails
-- with a permission error, enable it manually in the Supabase
-- dashboard at:
--   Database → Extensions → search "pg_cron" → toggle on.
--
-- Idempotent: each schedule is wrapped in a DO block that checks
-- cron.job before inserting, so re-running this migration is a
-- no-op when the jobs already exist.
--
-- Non-destructive: zero DROP / DELETE / ALTER…DROP / TRUNCATE.
--
-- Rollback (if needed):
--   SELECT cron.unschedule('dynastyzeus-cache-cleanup');
--   SELECT cron.unschedule('dynastyzeus-evict-consensus-cache');
-- ============================================================


-- ── Enable pg_cron (no-op if already enabled) ─────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;


-- ── 1. Daily cache cleanup ────────────────────────────────────
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'dynastyzeus-cache-cleanup'
  ) THEN
    PERFORM cron.schedule(
      'dynastyzeus-cache-cleanup',
      '0 4 * * *',
      'SELECT public.cleanup_stale_cache();'
    );
  END IF;
END
$migration$;


-- ── 2. Weekly consensus cache eviction ────────────────────────
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'dynastyzeus-evict-consensus-cache'
  ) THEN
    PERFORM cron.schedule(
      'dynastyzeus-evict-consensus-cache',
      '0 3 * * 0',
      'SELECT public.evict_old_consensus_cache(90);'
    );
  END IF;
END
$migration$;


-- ── Verification (run after applying) ─────────────────────────
--
-- Confirm both jobs are scheduled and active:
--   SELECT jobid, jobname, schedule, command, active
--   FROM cron.job
--   WHERE jobname IN (
--     'dynastyzeus-cache-cleanup',
--     'dynastyzeus-evict-consensus-cache'
--   );
--
-- After the first run window, check execution history:
--   SELECT j.jobname, d.status, d.return_message,
--          d.start_time, d.end_time
--   FROM cron.job_run_details d
--   JOIN cron.job j ON j.jobid = d.jobid
--   WHERE j.jobname IN (
--     'dynastyzeus-cache-cleanup',
--     'dynastyzeus-evict-consensus-cache'
--   )
--   ORDER BY d.start_time DESC
--   LIMIT 20;
