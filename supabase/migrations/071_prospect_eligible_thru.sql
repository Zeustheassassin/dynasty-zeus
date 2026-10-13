-- ============================================================
-- DynastyZeus — Migration 071
-- Run in the Supabase SQL editor after migration 070, BEFORE the code that
-- uses it deploys: the Prospect Data sheet and Fill from PFF read and write
-- prospects.eligible_thru_year.
-- ============================================================
-- prospects.eligible_thru_year: the last NFL draft the prospect can enter,
-- i.e. the year his college eligibility runs out (Arch Manning 2028,
-- Jeremiah Smith 2029 as of 2026-10-13). Filled from PFF's player directory
-- (/v1/players current_eligible_year) by the Prospect Data sheet's Fill from
-- PFF, or picked by hand. Null when unknown.
--
-- Not the first draft he can enter (three years after high school), and not
-- draft_class_year, which is the user's projected draft year.
--
-- Purely additive: ADD COLUMN IF NOT EXISTS (nullable, no default), a range
-- CHECK added only when missing, ledger row. The existing grants and
-- owner-only RLS on prospects cover the new column. No DROP, DELETE or
-- TRUNCATE.
-- ============================================================

ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS eligible_thru_year integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prospects_eligible_thru_year_range'
      AND conrelid = 'public.prospects'::regclass
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_eligible_thru_year_range
      CHECK (eligible_thru_year IS NULL OR eligible_thru_year BETWEEN 2000 AND 2100);
  END IF;
END $$;

COMMENT ON COLUMN public.prospects.eligible_thru_year IS
  'Last NFL draft he can enter (his college eligibility runs out): PFF current_eligible_year via Fill from PFF, or set by hand. Not the projected year (draft_class_year).';

-- PostgREST picks up the new column.
NOTIFY pgrst, 'reload schema';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('071_prospect_eligible_thru', 'prospects.eligible_thru_year (last draft he can enter; Fill from PFF)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
