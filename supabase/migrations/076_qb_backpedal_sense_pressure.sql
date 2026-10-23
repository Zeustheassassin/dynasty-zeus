-- ============================================================
-- DynastyZeus — Migration 076
-- Run in the Supabase SQL editor after migration 075, BEFORE the code that
-- uses it deploys: a new QB play writes every QB tag column, so without
-- didnt_sense_pressure every new QB play save fails; and a Backpedal saves
-- only once the new check allows it.
-- ============================================================
-- The user, 2026-10-22, on the QB board:
--
-- 1. A "Didn't sense pressure" tag: qb_plays.didnt_sense_pressure, boolean,
--    nullable, no default. Exception tag (off unless clicked) on every
--    dropback, clean pocket included (the user's call). NULL = charted
--    before the tag, a designed run, or a paste import. Data collection
--    only: nothing scores it yet (the user's call). lib/scouting/playEra.ts.
--
-- 2. A fourth Pressure Handling answer, Backpedal ('backpedal'). 032's CHECK
--    (qb_plays_pressure_handling_check) lists three, and a CHECK can't be
--    edited, so qb_plays_pressure_handling_values goes on with all four
--    first, then the old one is dropped: the ONE drop in this file, approved
--    by the user 2026-10-22. It removes a rule, not data: no row is changed
--    or deleted, and every saved value is one of the four. 032's other rule,
--    handling only on a pressured play (qb_plays_handling_only_when_pressured),
--    stays as it is.
--
-- No DELETE, TRUNCATE or UPDATE, and no other DROP. Re-runnable.
-- ============================================================

-- ── 1. Didn't sense pressure ─────────────────────────────────
ALTER TABLE public.qb_plays ADD COLUMN IF NOT EXISTS didnt_sense_pressure boolean;

COMMENT ON COLUMN public.qb_plays.didnt_sense_pressure IS
  'Tag (exception, every dropback): the QB didn''t sense the pressure. NULL = charted before the tag, not a dropback, or a paste import (migration 076).';

-- ── 2. Backpedal: the new check first ────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'qb_plays_pressure_handling_values' AND conrelid = 'public.qb_plays'::regclass
  ) THEN
    ALTER TABLE public.qb_plays ADD CONSTRAINT qb_plays_pressure_handling_values
      CHECK (pressure_handling IS NULL OR pressure_handling IN ('step_up', 'bail_front_side', 'bail_backside', 'backpedal'));
  END IF;
END $$;

-- ── The one approved drop: 032's three-answer check, once the new one is on ─
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'qb_plays_pressure_handling_values' AND conrelid = 'public.qb_plays'::regclass
  ) THEN
    ALTER TABLE public.qb_plays DROP CONSTRAINT IF EXISTS qb_plays_pressure_handling_check;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('076_qb_backpedal_sense_pressure', 'qb_plays.didnt_sense_pressure (tag, every dropback); Backpedal as a 4th pressure handling (qb_plays_pressure_handling_values; 032''s three-value check dropped, user-approved)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
