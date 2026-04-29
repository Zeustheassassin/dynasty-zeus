-- ============================================================
-- Migration 026 — Security Advisor fixes
-- ============================================================
-- Resolves all 4 errors and 7 of 8 warnings from Supabase Security
-- Advisor (the 8th — "Leaked Password Protection Disabled" — is a
-- dashboard toggle, not a SQL change).
--
-- 1. Enables RLS on four public tables.
--      - fc_values_cache, sleeper_stats_cache, cross_league_rosters_cache
--        are intentionally global caches read by anon clients via
--        /api/fc-values, /api/stats/sleeper-weekly, /api/cross-league-
--        rosters. They contain no user-private data — only public
--        Sleeper / FantasyCalc snapshots. A permissive SELECT-true
--        policy keeps existing read behavior while enabling RLS so
--        Supabase no longer flags the tables. Writes go through
--        service-role (cron + API server-side writes), which bypasses
--        RLS regardless.
--      - gm_briefings stores per-user AI briefings (has a user_id
--        column). Locked to auth.uid() = user_id so a row owner can
--        only ever read/write their own. Not currently queried from
--        app code, but safer to lock down before it gets wired up.
--
-- 2. Re-creates three functions with `SET search_path = public, pg_temp`
--    to silence "Function Search Path Mutable" warnings. Hard-coding
--    the search path makes name resolution deterministic and prevents
--    search-path shadowing of built-in operators.
--
-- 3. Revokes EXECUTE on the two housekeeping SECURITY DEFINER functions
--    from PUBLIC, authenticated, and anon. These are only ever called
--    by service-role (cron) which bypasses GRANT checks, so revoking
--    from end-user roles tightens the surface area without affecting
--    any application code path.
--
-- This migration is non-destructive:
--   - Zero DROP / DELETE / ALTER…DROP / TRUNCATE statements.
--   - Policy creates use IF NOT EXISTS via DO blocks (avoids DROP POLICY).
--   - CREATE OR REPLACE FUNCTION preserves existing call sites.
--   - REVOKE removes only end-user execute grants on housekeeping
--     functions never called from app code.
--
-- Rollback (if needed):
--   ALTER TABLE public.fc_values_cache             DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.sleeper_stats_cache         DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.cross_league_rosters_cache  DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.gm_briefings                DISABLE ROW LEVEL SECURITY;
--   GRANT EXECUTE ON FUNCTION public.cleanup_stale_cache() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.evict_old_consensus_cache(integer) TO PUBLIC;
-- (Function bodies stay as-is after rollback — the search_path setting
-- is harmless to leave in place.)
-- ============================================================


-- ── 1. Enable RLS + permissive read policies on global caches ──

ALTER TABLE public.fc_values_cache ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'fc_values_cache'
      AND policyname = 'fc_values_cache_public_read'
  ) THEN
    CREATE POLICY "fc_values_cache_public_read" ON public.fc_values_cache
      FOR SELECT USING (true);
  END IF;
END $$;

ALTER TABLE public.sleeper_stats_cache ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sleeper_stats_cache'
      AND policyname = 'sleeper_stats_cache_public_read'
  ) THEN
    CREATE POLICY "sleeper_stats_cache_public_read" ON public.sleeper_stats_cache
      FOR SELECT USING (true);
  END IF;
END $$;

ALTER TABLE public.cross_league_rosters_cache ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cross_league_rosters_cache'
      AND policyname = 'cross_league_rosters_cache_public_read'
  ) THEN
    CREATE POLICY "cross_league_rosters_cache_public_read" ON public.cross_league_rosters_cache
      FOR SELECT USING (true);
  END IF;
END $$;


-- ── 2. Enable RLS + auth.uid() policy on gm_briefings ─────────

ALTER TABLE public.gm_briefings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'gm_briefings'
      AND policyname = 'gm_briefings_self'
  ) THEN
    CREATE POLICY "gm_briefings_self" ON public.gm_briefings
      FOR ALL
      USING  (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;


-- ── 3. Re-create functions with stable search_path ────────────

-- 3a. cleanup_stale_cache — housekeeping, deletes stale cache rows.
CREATE OR REPLACE FUNCTION public.cleanup_stale_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.cross_league_rosters_cache
  WHERE cached_at < NOW() - INTERVAL '24 hours';

  DELETE FROM public.sleeper_stats_cache
  WHERE cached_at < NOW() - INTERVAL '60 days';
END;
$$;

-- 3b. evict_old_consensus_cache — housekeeping, deletes old consensus rows.
CREATE OR REPLACE FUNCTION public.evict_old_consensus_cache(max_age_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.consensus_draft_cache
  WHERE computed_at < NOW() - (max_age_days || ' days')::interval;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- 3c. notes_updated_at — trigger function, sets updated_at on row update.
-- Trigger functions don't need SECURITY DEFINER (the trigger fires with
-- the table owner's privileges via the trigger mechanism), so keep this
-- as SECURITY INVOKER and just hard-code search_path.
CREATE OR REPLACE FUNCTION public.notes_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


-- ── 4. Restrict housekeeping function access ──────────────────
-- Service-role (cron) bypasses GRANT checks, so revoking from
-- PUBLIC / authenticated / anon does not affect any code path.
-- Done explicitly for all three roles since `authenticated` and
-- `anon` may have direct grants in addition to the inherited
-- PUBLIC grant.

REVOKE EXECUTE ON FUNCTION public.cleanup_stale_cache()                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_stale_cache()                FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_stale_cache()                FROM anon;

REVOKE EXECUTE ON FUNCTION public.evict_old_consensus_cache(integer)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.evict_old_consensus_cache(integer)   FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.evict_old_consensus_cache(integer)   FROM anon;


-- ── Verification (run after applying) ─────────────────────────
--
-- Confirm RLS is enabled on the four tables:
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname = 'public'
--     AND tablename IN (
--       'fc_values_cache','sleeper_stats_cache',
--       'cross_league_rosters_cache','gm_briefings'
--     );
--
-- Confirm policies exist:
--   SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN (
--       'fc_values_cache','sleeper_stats_cache',
--       'cross_league_rosters_cache','gm_briefings'
--     );
--
-- Confirm functions have explicit search_path:
--   SELECT proname, proconfig FROM pg_proc
--   WHERE pronamespace = 'public'::regnamespace
--     AND proname IN (
--       'cleanup_stale_cache','evict_old_consensus_cache','notes_updated_at'
--     );
--
-- Confirm cleanup function grants are gone for end-user roles:
--   SELECT proname, proacl FROM pg_proc
--   WHERE pronamespace = 'public'::regnamespace
--     AND proname IN ('cleanup_stale_cache','evict_old_consensus_cache');
