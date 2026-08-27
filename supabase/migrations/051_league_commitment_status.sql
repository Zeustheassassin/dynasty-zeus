-- ============================================================
-- DynastyZeus — Migration 051
-- Run in the Supabase SQL editor after migration 050.
-- ============================================================
-- Adds a per-league "commitment status" to league_management so
-- users can flag whether they're staying long term, on the fence,
-- or leaving a league at the end of the year. Purely additive
-- (ADD COLUMN only) — no DROP/ALTER…DROP/DELETE/TRUNCATE.
--
-- league_management already has RLS + GRANTs from migration 006 /
-- 050 covering the whole table, so a new column needs no new
-- GRANT statement.
-- ============================================================

ALTER TABLE public.league_management
  ADD COLUMN IF NOT EXISTS commitment_status text NOT NULL DEFAULT '';

ALTER TABLE public.league_management DROP CONSTRAINT IF EXISTS league_management_commitment_status_check;
ALTER TABLE public.league_management
  ADD CONSTRAINT league_management_commitment_status_check
  CHECK (commitment_status IN ('', 'staying', 'on_fence', 'leaving'));

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('051_league_commitment_status', 'Adds league_management.commitment_status (staying/on_fence/leaving) for League Management hub')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
