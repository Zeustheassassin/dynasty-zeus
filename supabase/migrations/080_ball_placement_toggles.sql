-- ============================================================
-- DynastyZeus — Migration 080
-- Run in the Supabase SQL editor after migration 079, BEFORE the code that
-- uses it deploys: a new WR or TE play writes every tag column of its
-- position, so without these every new WR / TE play save fails. Chart
-- nothing between running this and the push; if you do, run it again after
-- the push (step 3 copies only rows not yet copied).
-- ============================================================
-- The user, 2026-10-23: ball placement on a WR / TE target is not one pick.
-- A ball can be High or Low, In front or Behind, either pair or both (High
-- and in front), and all of those are Outside frame; Outside frame can also be
-- on alone (over his head with no jump, at his knees in stride). On target =
-- none. Still data collection only (lib/scouting/playEra.ts).
--
-- 1. On route_plays and te_plays, boolean, nullable, no default (NULL = not a
--    target, charted before, or a paste import): ball_high, ball_low,
--    ball_in_front, ball_behind, ball_outside_frame.
-- 2. Checks: not High and Low, not In front and Behind, and Outside frame on
--    whenever any of the four is.
-- 3. The targets charted with 078's single pick (20 WR, 0 TE at writing) are
--    copied into the toggles: on_target → none; high / low / in_front /
--    behind → that one + Outside frame; outside_frame → Outside frame alone.
--    The ONE UPDATE in this file, approved by the user 2026-10-23 ("Copy them
--    over"): it fills only the new columns, only on rows that have an old
--    pick and no new value, and leaves ball_placement as it is. The code
--    stops writing ball_placement (its comment says so).
--
-- No DROP, DELETE or TRUNCATE, and no other UPDATE. Re-runnable.
-- ============================================================

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['route_plays', 'te_plays'] LOOP
    -- ── 1. The toggles ───────────────────────────────────────
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS ball_high boolean', tbl);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS ball_low boolean', tbl);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS ball_in_front boolean', tbl);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS ball_behind boolean', tbl);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS ball_outside_frame boolean', tbl);

    -- ── 2. The checks ────────────────────────────────────────
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = tbl || '_ball_high_or_low' AND conrelid = ('public.' || tbl)::regclass
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (NOT (ball_high AND ball_low))',
        tbl, tbl || '_ball_high_or_low');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = tbl || '_ball_front_or_behind' AND conrelid = ('public.' || tbl)::regclass
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (NOT (ball_in_front AND ball_behind))',
        tbl, tbl || '_ball_front_or_behind');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = tbl || '_ball_outside_frame_with_direction' AND conrelid = ('public.' || tbl)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (ball_outside_frame IS TRUE OR NOT (COALESCE(ball_high, false) OR COALESCE(ball_low, false) OR COALESCE(ball_in_front, false) OR COALESCE(ball_behind, false)))',
        tbl, tbl || '_ball_outside_frame_with_direction');
    END IF;

    -- ── 3. The one approved UPDATE: 078's picks into the toggles ─
    EXECUTE format(
      'UPDATE public.%I SET
         ball_high          = (ball_placement = ''high''),
         ball_low           = (ball_placement = ''low''),
         ball_in_front      = (ball_placement = ''in_front''),
         ball_behind        = (ball_placement = ''behind''),
         ball_outside_frame = (ball_placement <> ''on_target'')
       WHERE ball_placement IS NOT NULL
         AND ball_high IS NULL AND ball_low IS NULL AND ball_in_front IS NULL
         AND ball_behind IS NULL AND ball_outside_frame IS NULL',
      tbl);

    EXECUTE format($c$COMMENT ON COLUMN public.%I.ball_high IS 'Tag (every target): ball high. Not with ball_low. Data collection only (migration 080).'$c$, tbl);
    EXECUTE format($c$COMMENT ON COLUMN public.%I.ball_low IS 'Tag (every target): ball low. Not with ball_high. Data collection only (migration 080).'$c$, tbl);
    EXECUTE format($c$COMMENT ON COLUMN public.%I.ball_in_front IS 'Tag (every target): ball in front. Not with ball_behind. Data collection only (migration 080).'$c$, tbl);
    EXECUTE format($c$COMMENT ON COLUMN public.%I.ball_behind IS 'Tag (every target): ball behind. Not with ball_in_front. Data collection only (migration 080).'$c$, tbl);
    EXECUTE format($c$COMMENT ON COLUMN public.%I.ball_outside_frame IS 'Tag (every target): outside his frame. On whenever high / low / in front / behind is, or alone. Data collection only (migration 080).'$c$, tbl);
    EXECUTE format($c$COMMENT ON COLUMN public.%I.ball_placement IS 'Retired 2026-10-23 (migration 080): 078''s single pick, replaced by ball_high / ball_low / ball_in_front / ball_behind / ball_outside_frame (080 copied each saved pick into them). New plays leave it NULL.'$c$, tbl);
  END LOOP;
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
    VALUES ('080_ball_placement_toggles', 'route_plays + te_plays: ball_high / ball_low / ball_in_front / ball_behind / ball_outside_frame with their checks; 078''s ball_placement picks copied in (user-approved), ball_placement retired')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
