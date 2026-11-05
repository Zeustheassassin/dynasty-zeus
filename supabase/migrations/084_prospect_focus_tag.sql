-- ============================================================
-- DynastyZeus — Migration 084
-- Run in the Supabase SQL editor after migration 083. Safe to run before or
-- after the code deploys: the Scouting Hub loads prospects with select("*"),
-- so until this column exists every prospect simply reads as untagged, and
-- the Roster tab's Focus dropdown save fails quietly (logged) instead of
-- breaking anything.
-- ============================================================
-- The user, 2026-11-05: tag each 2027 prospect with the Focus Tag from their
-- "2027 Scouting Board" Google Sheet, so they can see which players are worth
-- charting first. A one-time import (by prospect id, done by hand after this
-- migration), NOT a live link to the sheet; after that the tag is edited in
-- the app (Scouting → Roster → Focus).
--
-- prospects.focus_tag, nullable. NULL = untagged (the default for every
-- prospect, and for every sheet player that matched nobody in the app).
--   focus_now     — Focus now
--   monitor       — Monitor
--   low_priority  — Low priority
--   off_board     — Off 2027 board
-- Separate from charting_decision on purpose: that one tracks charting
-- progress and is auto-promoted to fully_charted from route/throw counts.
--
-- Additive: one new nullable column + its check. No DROP, DELETE, TRUNCATE.
-- Existing table, so its existing grants and RLS policy cover the column.
-- Re-runnable: the column and the constraint are added only when missing.
-- ============================================================

ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS focus_tag text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prospects_focus_tag_check'
      AND conrelid = 'public.prospects'::regclass
  ) THEN
    ALTER TABLE public.prospects ADD CONSTRAINT prospects_focus_tag_check
      CHECK (focus_tag IS NULL OR focus_tag IN ('focus_now', 'monitor', 'low_priority', 'off_board'));
  END IF;
END $$;

COMMENT ON COLUMN public.prospects.focus_tag IS
  'Charting priority (migration 084): focus_now / monitor / low_priority / off_board; NULL = untagged. First filled by a one-time import from the user''s 2027 Scouting Board sheet; edited in the app after that.';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('084_prospect_focus_tag', 'prospects.focus_tag: charting priority from the 2027 Scouting Board sheet (one-time import)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
