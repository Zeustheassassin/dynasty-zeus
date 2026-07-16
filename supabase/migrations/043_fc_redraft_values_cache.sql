-- ============================================================
-- DynastyZeus — Migration 043
-- Run in the Supabase SQL editor after migration 042.
-- ============================================================
-- Adds fc_redraft_values_cache — mirrors fc_values_cache (dynasty,
-- migration 001) but for redraft values (isDynasty=false), so
-- /api/fc-values can serve and cache both shapes instead of Trade
-- Hub's useCalcValues hitting FantasyCalc directly, uncached, for
-- redraft values. Purely additive — no DROP/ALTER on existing
-- tables. Part of Phase A stage A3 (S3 fetch consolidation),
-- approved 2026-07-16.

CREATE TABLE IF NOT EXISTS public.fc_redraft_values_cache (
  num_qbs   INTEGER PRIMARY KEY,
  data      JSONB       NOT NULL,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.fc_redraft_values_cache DISABLE ROW LEVEL SECURITY;

-- RLS is disabled (shared, non-user-scoped cache — same trust model as
-- fc_values_cache), so explicit grants are the only access control.
-- The app reads/writes this table through the anon-key client in
-- /api/fc-values, matching how fc_values_cache is accessed today.
GRANT SELECT, INSERT, UPDATE ON public.fc_redraft_values_cache TO anon, authenticated, service_role;

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('043_fc_redraft_values_cache', 'add redraft-values cache table so /api/fc-values can serve isDynasty=false too (S3 fetch consolidation)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
