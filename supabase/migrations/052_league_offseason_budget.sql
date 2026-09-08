-- ============================================================
-- DynastyZeus — Migration 052
-- Run in the Supabase SQL editor after migration 051.
-- ============================================================
-- Adds a per-league "Offseason Budget" checkbox to league_management so
-- users can flag whether a league's FAAB budget resets twice a year (a
-- separate offseason budget on top of the in-season one) instead of just
-- once. Purely additive (ADD COLUMN only) — no DROP/ALTER…DROP/DELETE/
-- TRUNCATE.
--
-- league_management already has RLS + GRANTs from migration 006 / 050
-- covering the whole table, so a new column needs no new GRANT statement.
-- ============================================================

ALTER TABLE public.league_management
  ADD COLUMN IF NOT EXISTS offseason_budget boolean NOT NULL DEFAULT false;

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('052_league_offseason_budget', 'Adds league_management.offseason_budget checkbox for League Management hub')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
