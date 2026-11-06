-- ============================================================
-- DynastyZeus — Migration 085
-- Run in the Supabase SQL editor after migration 084. Safe to run before or
-- after the code deploys: the Scouting Hub loads prospects with select("*"),
-- so until these columns exist every prospect simply has no Watch Rank and
-- the Watch sort leaves the list in its tie order.
-- ============================================================
-- The user, 2026-11-05: their "2027 Scouting Board" Google Sheet now has a
-- Watch Score and a Watch Rank per player (formula-driven on the sheet:
-- 1 = watch first within each position). They want to sort the prospect
-- lists by it when choosing whose games to watch, and to see the score when
-- deciding which 2028/2029 players to move into the 2027 class. Copied in by
-- a one-time import (by prospect id, done by hand after this migration), NOT
-- a live link to the sheet. Not edited in the app: re-imported on request.
--
-- prospects.watch_rank  integer, nullable, 1 or more. The sheet's number as
--   is, so within one draft class the app shows gaps (it ranks all classes
--   on the sheet together).
-- prospects.watch_score numeric(4,1), nullable. One decimal, like the sheet;
--   can be negative (the sheet gives excluded players -100.0).
-- NULL = not on the sheet.
--
-- Additive: two new nullable columns + one check. No DROP, DELETE, TRUNCATE.
-- Existing table, so its existing grants and RLS policy cover the columns.
-- Re-runnable: the columns and the constraint are added only when missing.
-- ============================================================

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS watch_rank  integer,
  ADD COLUMN IF NOT EXISTS watch_score numeric(4,1);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prospects_watch_rank_check'
      AND conrelid = 'public.prospects'::regclass
  ) THEN
    ALTER TABLE public.prospects ADD CONSTRAINT prospects_watch_rank_check
      CHECK (watch_rank IS NULL OR watch_rank > 0);
  END IF;
END $$;

COMMENT ON COLUMN public.prospects.watch_rank IS
  'Watch priority within the position (migration 085): 1 = watch first. Copied from the user''s 2027 Scouting Board sheet by a one-time import; NULL = not on the sheet.';
COMMENT ON COLUMN public.prospects.watch_score IS
  'The sheet''s Watch Score behind watch_rank (migration 085). Copied by the same one-time import; NULL = not on the sheet.';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('085_prospect_watch_rank', 'prospects.watch_rank + watch_score from the 2027 Scouting Board sheet (one-time import)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
