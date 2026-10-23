-- ============================================================
-- DynastyZeus — Migration 078
-- Run in the Supabase SQL editor after migration 077, BEFORE the code that
-- uses it deploys: a new WR or TE play writes every tag column of its
-- position, so without these every new WR / TE play save fails.
-- ============================================================
-- The user, 2026-10-23: five per-play tags on the WR and TE boards for what
-- made a target hard to catch. DATA COLLECTION ONLY until there are enough
-- tagged targets to make a difference (the user's call): no grade, model or
-- view reads them, so no prospect's score moves, and plays charted before
-- stay NULL (lib/scouting/playEra.ts, CATCH_DIFFICULTY_TAGS).
--
-- On route_plays and te_plays, all nullable, no default. NULL = not a target
-- (or not an incompletion, for the reason), charted before 078, or a paste
-- import.
--   ball_placement      text: on_target / high / low / behind / in_front /
--                       outside_frame. Every target; On target pre-selected.
--   adjusted_to_ball    boolean: he had to adjust (turn, high-point, reach,
--                       dive, one hand). Every target.
--   hit_at_catch        boolean: took contact as the ball arrived. Every target.
--   sideline_target     boolean: at the boundary, feet had to come down in
--                       bounds. Every target.
--   incompletion_reason text: uncatchable / broken_up. Incompletions only (a
--                       drop is already its own outcome).
--
-- Additive only: no DROP, DELETE, TRUNCATE or UPDATE. No row is changed.
-- Re-runnable.
-- ============================================================

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['route_plays', 'te_plays'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS ball_placement text', tbl);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS adjusted_to_ball boolean', tbl);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS hit_at_catch boolean', tbl);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS sideline_target boolean', tbl);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS incompletion_reason text', tbl);

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = tbl || '_ball_placement_check' AND conrelid = ('public.' || tbl)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (ball_placement IS NULL OR ball_placement IN (''on_target'', ''high'', ''low'', ''behind'', ''in_front'', ''outside_frame''))',
        tbl, tbl || '_ball_placement_check');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = tbl || '_incompletion_reason_check' AND conrelid = ('public.' || tbl)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (incompletion_reason IS NULL OR incompletion_reason IN (''uncatchable'', ''broken_up''))',
        tbl, tbl || '_incompletion_reason_check');
    END IF;

    EXECUTE format($c$COMMENT ON COLUMN public.%I.ball_placement IS 'Tag (every target, On target pre-selected): where the ball arrived. Data collection only (migration 078).'$c$, tbl);
    EXECUTE format($c$COMMENT ON COLUMN public.%I.adjusted_to_ball IS 'Tag (exception, every target): he had to adjust to the ball. Data collection only (migration 078).'$c$, tbl);
    EXECUTE format($c$COMMENT ON COLUMN public.%I.hit_at_catch IS 'Tag (exception, every target): took contact as the ball arrived. Data collection only (migration 078).'$c$, tbl);
    EXECUTE format($c$COMMENT ON COLUMN public.%I.sideline_target IS 'Tag (exception, every target): at the boundary, feet had to come down in bounds. Data collection only (migration 078).'$c$, tbl);
    EXECUTE format($c$COMMENT ON COLUMN public.%I.incompletion_reason IS 'Tag (required on an incompletion): uncatchable or broken up. Data collection only (migration 078).'$c$, tbl);
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
    VALUES ('078_catch_difficulty_tags', 'route_plays + te_plays: ball_placement, adjusted_to_ball, hit_at_catch, sideline_target, incompletion_reason (catch difficulty tags, data collection only)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
