-- ============================================================
-- DynastyZeus — Migration 079
-- Run in the Supabase SQL editor after migration 078, BEFORE the code that
-- uses it deploys: an Out of bounds incompletion saves only once the new
-- check allows it.
-- ============================================================
-- The user, 2026-10-23: a third answer under Why incomplete on the WR and TE
-- boards, Out of bounds ('out_of_bounds'), beside Uncatchable and Broken up.
-- Still data collection only (lib/scouting/playEra.ts, CATCH_DIFFICULTY_TAGS).
--
-- 078's CHECK (<table>_incompletion_reason_check) lists two answers, and a
-- CHECK can't be edited, so <table>_incompletion_reason_values goes on with
-- all three first, then the old one is dropped: the ONE drop in this file,
-- approved by the user 2026-10-23 ("Swap the check"). It removes a rule, not
-- data: no row is changed or deleted, and every saved answer (2 broken_up,
-- 1 uncatchable on route_plays at writing) is one of the three.
--
-- Also (the user, same day): Sideline (feet in bounds) is asked on catches
-- only, not every target; its column comment says so. Comment only: rows
-- saved since 078 keep what they have.
--
-- No DELETE, TRUNCATE or UPDATE, and no other DROP. Re-runnable.
-- ============================================================

-- ── The new check first, then the one approved drop (per table) ─
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['route_plays', 'te_plays'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = tbl || '_incompletion_reason_values' AND conrelid = ('public.' || tbl)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (incompletion_reason IS NULL OR incompletion_reason IN (''uncatchable'', ''broken_up'', ''out_of_bounds''))',
        tbl, tbl || '_incompletion_reason_values');
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = tbl || '_incompletion_reason_values' AND conrelid = ('public.' || tbl)::regclass
    ) THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', tbl, tbl || '_incompletion_reason_check');
    END IF;

    EXECUTE format($c$COMMENT ON COLUMN public.%I.incompletion_reason IS 'Tag (required on an incompletion): uncatchable, broken up or out of bounds. Data collection only (migrations 078, 079).'$c$, tbl);
    -- Sideline is asked on catches only now (the user, 2026-10-23); a comment, no data change.
    EXECUTE format($c$COMMENT ON COLUMN public.%I.sideline_target IS 'Tag (exception, catches only): at the boundary, feet came down in bounds. NULL off a catch. Data collection only (migrations 078, 079).'$c$, tbl);
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
    VALUES ('079_incompletion_out_of_bounds', 'Why incomplete gets Out of bounds on route_plays + te_plays (<table>_incompletion_reason_values; 078''s two-answer check dropped, user-approved)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
