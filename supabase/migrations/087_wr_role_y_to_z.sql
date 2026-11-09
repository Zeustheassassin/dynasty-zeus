-- ============================================================
-- DynastyZeus — Migration 087
-- Run in the Supabase SQL editor after migration 086, right before or right
-- after the code that uses it deploys. In between, a WR whose Should Play or
-- Will Play answer names the Y (or Z) shows the first option in that
-- dropdown until the other half lands; nothing is lost either way.
-- ============================================================
-- The user, 2026-11-09: the WR off-the-line outside receiver is the Z (the
-- flanker), not the Y, which is the tight end's spot. The app's WR answers
-- for Should Play, Will Play (Pre) and Will Play (Post) on the WR boards
-- (components/scouting/wr/WRHub.tsx, PlayerChartingBoard.tsx) now read
-- X, Z, Slot, X or Z, Z or Slot, ... Target Hog Z or Slot. This renames the
-- saved answers to match, WR prospects only.
--
-- At writing (read-only count, 2026-11-09): should_play 'Y' 1, 'X or Y' 2,
-- 'Y or Slot' 9; will_play_pre 'X or Y' 2, 'Y or Slot' 1; will_play_post
-- none. 15 answers on WR rows.
--
-- The ONE UPDATE in this file, asked for by the user (rename Y to Z). It
-- changes those four exact answers and nothing else: no other value, no
-- other column, no other position, and updated_at is left alone. No DROP,
-- DELETE or TRUNCATE. Re-runnable: a second run finds no Y answers.
-- ============================================================

UPDATE public.prospects
SET
  should_play = CASE should_play
    WHEN 'Y' THEN 'Z'
    WHEN 'X or Y' THEN 'X or Z'
    WHEN 'Y or Slot' THEN 'Z or Slot'
    WHEN 'Target Hog Y or Slot' THEN 'Target Hog Z or Slot'
    ELSE should_play END,
  will_play_pre = CASE will_play_pre
    WHEN 'Y' THEN 'Z'
    WHEN 'X or Y' THEN 'X or Z'
    WHEN 'Y or Slot' THEN 'Z or Slot'
    WHEN 'Target Hog Y or Slot' THEN 'Target Hog Z or Slot'
    ELSE will_play_pre END,
  will_play_post = CASE will_play_post
    WHEN 'Y' THEN 'Z'
    WHEN 'X or Y' THEN 'X or Z'
    WHEN 'Y or Slot' THEN 'Z or Slot'
    WHEN 'Target Hog Y or Slot' THEN 'Target Hog Z or Slot'
    ELSE will_play_post END
WHERE position = 'WR'
  AND (should_play    IN ('Y', 'X or Y', 'Y or Slot', 'Target Hog Y or Slot')
    OR will_play_pre  IN ('Y', 'X or Y', 'Y or Slot', 'Target Hog Y or Slot')
    OR will_play_post IN ('Y', 'X or Y', 'Y or Slot', 'Target Hog Y or Slot'));

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('087_wr_role_y_to_z', 'WR Should Play / Will Play answers renamed Y to Z (the flanker), WR prospects only; user-requested UPDATE')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
