-- ============================================================
-- DynastyZeus — Migration 066
-- Run in the Supabase SQL editor after migration 065.
-- ============================================================
-- One per-play call on qb_plays: was a tipped-ball interception the
-- receiver's fault? (An on-target throw to an open man that bounces off his
-- hands or body into a defender's.)
--
--   int_receiver_fault — NULL  = not asked (not a tipped-ball INT, or charted
--                                before this column existed)
--                        true  = the receiver's fault: QB AAE scores the throw
--                                like a drop, on its accuracy grade
--                        false = not his fault: the pick scores as a miss
--
-- Only a tipped-ball interception may carry it (CHECK below; IS NOT DISTINCT
-- FROM so a NULL completion / int_type can't slip through).
--
-- Purely additive: ADD COLUMN IF NOT EXISTS (nullable, no default, so no
-- table rewrite) and the CHECK added only when missing. Every existing row is
-- NULL, so it validates instantly. No DROP, DELETE or TRUNCATE. Grants and
-- RLS are the table's own (column privileges follow the table grant).
-- ============================================================

ALTER TABLE public.qb_plays
  ADD COLUMN IF NOT EXISTS int_receiver_fault boolean;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'qb_plays_int_receiver_fault_check'
      AND conrelid = 'public.qb_plays'::regclass
  ) THEN
    ALTER TABLE public.qb_plays
      ADD CONSTRAINT qb_plays_int_receiver_fault_check
      CHECK (
        int_receiver_fault IS NULL
        OR (completion IS NOT DISTINCT FROM 'interception' AND int_type IS NOT DISTINCT FROM 'tipped')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.qb_plays.int_receiver_fault IS
  'Tipped-ball INTs only: true = the receiver''s fault (QB AAE scores it like a drop), false = not. NULL = not asked (migration 066).';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('066_qb_int_receiver_fault', 'qb_plays.int_receiver_fault: was a tipped-ball interception the receiver''s fault (QB AAE scores it like a drop)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
