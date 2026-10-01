-- ============================================================
-- DynastyZeus — Migration 059
-- Run in the Supabase SQL editor after migration 058.
-- ============================================================
-- Adds prospects.ae_score_lock: a drafted prospect's AE Score frozen once
-- the prospect's draft class has been drafted (from May 1 of the draft year), so later
-- charting can't move a drafted class's rankings. The AE Score is relative
-- to the whole charted pool and league models, which keep changing as new
-- classes are charted. The Big Board writes the lock the first time it scores
-- a drafted prospect and reads it from then on (lib/scouting/scoreLock.ts).
--
--   { "score": 1.23, "locked_at": "2026-10-01T...",
--     "components": [ { "key": "aae", "label": "AAE", "ae": 14.2, "n": 30,
--                       "reliability": 0.18, "z": 1.23, "tau": 1.98, ... } ] }
--
-- Until this is applied the board scores drafted prospects live, exactly as
-- before. The lock write fails quietly, and nothing else is affected
-- (prospects are read with select("*"), and the column is never sent on insert).
--
-- Purely additive — ADD COLUMN IF NOT EXISTS, nullable, no default; no
-- DROP/ALTER...DROP/DELETE/TRUNCATE. prospects' existing owner-only RLS
-- and grants cover the new column.
-- ============================================================

ALTER TABLE prospects ADD COLUMN IF NOT EXISTS ae_score_lock jsonb;

COMMENT ON COLUMN prospects.ae_score_lock IS
  'AE Score frozen once the prospect''s draft class was drafted (score, components, locked_at) — Big Board, lib/scouting/scoreLock.ts.';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('059_prospect_ae_score_lock', 'Adds prospects.ae_score_lock (AE Score frozen once the draft class is drafted)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
