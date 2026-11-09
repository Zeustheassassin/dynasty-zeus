-- ============================================================
-- DynastyZeus — Migration 086
-- Run in the Supabase SQL editor after migration 079, BEFORE the code that
-- uses it deploys: a Hard catch incompletion saves only once the new check
-- allows it.
-- ============================================================
-- The user, 2026-11-09: a fourth answer under Why incomplete on the WR and TE
-- boards, Hard catch ('hard_catch'), beside Uncatchable, Broken up and Out of
-- bounds. For a ball he could have caught that went through his hands on a
-- very hard catch (low, sliding or diving), with no defender involved: not
-- uncatchable (it hit his hands), not broken up, and too hard to call a drop.
-- Still data collection only (lib/scouting/playEra.ts, CATCH_DIFFICULTY_TAGS).
--
-- 079's CHECK (<table>_incompletion_reason_values) lists three answers, and a
-- CHECK can't be edited, so <table>_incompletion_reason_answers goes on with
-- all four first, then the old one is dropped: the ONE drop in this file,
-- approved by the user 2026-11-09 ("Swap the rule"). It removes a rule, not
-- data: no row is changed or deleted, and every saved answer (route_plays: 17
-- uncatchable, 8 broken_up, 1 out_of_bounds; te_plays: none at writing) is
-- one of the four.
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
      WHERE conname = tbl || '_incompletion_reason_answers' AND conrelid = ('public.' || tbl)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (incompletion_reason IS NULL OR incompletion_reason IN (''uncatchable'', ''broken_up'', ''out_of_bounds'', ''hard_catch''))',
        tbl, tbl || '_incompletion_reason_answers');
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = tbl || '_incompletion_reason_answers' AND conrelid = ('public.' || tbl)::regclass
    ) THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', tbl, tbl || '_incompletion_reason_values');
    END IF;

    EXECUTE format($c$COMMENT ON COLUMN public.%I.incompletion_reason IS 'Tag (required on an incompletion): uncatchable, broken up, out of bounds or hard catch (catchable, through his hands on a very hard catch, not a drop). Data collection only (migrations 078, 079, 086).'$c$, tbl);
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
    VALUES ('086_incompletion_hard_catch', 'Why incomplete gets Hard catch on route_plays + te_plays (<table>_incompletion_reason_answers; 079''s three-answer check dropped, user-approved)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
