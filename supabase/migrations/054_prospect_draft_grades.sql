-- ============================================================
-- DynastyZeus — Migration 054
-- Run in the Supabase SQL editor after migration 053.
-- ============================================================
-- Adds a pre-draft and a post-draft scouting grade to every
-- prospect. Both are 1.0–100.0 on a one-decimal scale, so an
-- 88.6 is expressible. NULL = ungraded (the default), which is
-- distinct from a low grade.
--
--   pre_draft_grade  — the grade off the tape, before the NFL
--                      draft assigns a landing spot.
--   post_draft_grade — the grade after draft capital / landing
--                      spot / depth chart are known.
--
-- numeric(4,1) stores exactly one decimal (a 4th significant
-- digit is only reachable by 100.0 itself) and rounds anything
-- finer on write, so the column can never drift to 88.63.
--
-- Purely additive (ADD COLUMN / ADD CONSTRAINT) — no
-- DROP/ALTER…DROP/DELETE/TRUNCATE. `prospects` already carries
-- RLS (migration 007) and GRANTs (migration 050) covering the
-- whole table, so new columns need no new policy or GRANT.
-- ============================================================

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS pre_draft_grade  numeric(4,1),
  ADD COLUMN IF NOT EXISTS post_draft_grade numeric(4,1);

ALTER TABLE public.prospects DROP CONSTRAINT IF EXISTS prospects_pre_draft_grade_check;
ALTER TABLE public.prospects
  ADD CONSTRAINT prospects_pre_draft_grade_check
  CHECK (pre_draft_grade IS NULL OR (pre_draft_grade >= 1 AND pre_draft_grade <= 100));

ALTER TABLE public.prospects DROP CONSTRAINT IF EXISTS prospects_post_draft_grade_check;
ALTER TABLE public.prospects
  ADD CONSTRAINT prospects_post_draft_grade_check
  CHECK (post_draft_grade IS NULL OR (post_draft_grade >= 1 AND post_draft_grade <= 100));

COMMENT ON COLUMN public.prospects.pre_draft_grade  IS 'Scout grade 1.0-100.0 off the tape, before the NFL draft. NULL = ungraded.';
COMMENT ON COLUMN public.prospects.post_draft_grade IS 'Scout grade 1.0-100.0 after draft capital / landing spot are known. NULL = ungraded.';

-- ── Repo/DB drift repair ─────────────────────────────────────
-- draft_round / draft_pick / draft_team exist in the live
-- database and are read+written by the charting Bio panel, but
-- no migration in this repo ever created them (they were added
-- out-of-band). These three statements are no-ops against the
-- live DB and make a database rebuilt from migrations match it.
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS draft_round integer,
  ADD COLUMN IF NOT EXISTS draft_pick  integer,
  ADD COLUMN IF NOT EXISTS draft_team  text;

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('054_prospect_draft_grades', 'Adds prospects.pre_draft_grade / post_draft_grade (numeric(4,1), 1-100) + backfills the never-migrated draft_round/draft_pick/draft_team columns')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
