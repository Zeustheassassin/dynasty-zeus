-- ============================================================
-- DynastyZeus — Migration 104
-- Run in the Supabase SQL editor after migration 103, BEFORE the code that
-- uses it deploys: Fill from PFF reads prospects.jersey_number, and the
-- charting boards show it after his name.
-- ============================================================
-- prospects.jersey_number: the number he wears now, as PFF's player
-- directory has it (/v1/players jersey_number, checked 2026-11-23: a string,
-- "26" for Sire Gaines). Filled by the Prospect Data sheet's Fill from PFF
-- (PFF's wins, ticked) or typed in Edit Bio. Null when unknown.
--
-- Text, not a number, so it stays exactly as PFF gives it ("0" and "00" are
-- different numbers). One or two digits.
--
-- Only the current number: PFF's per-game rows carry the number he wore in
-- each game, but a season-by-season history was left out on purpose
-- (2026-11-23, the user checks old seasons by hand when charting them).
--
-- Purely additive: ADD COLUMN IF NOT EXISTS (nullable, no default), a format
-- CHECK added only when missing, ledger row. The existing grants and
-- owner-only RLS on prospects cover the new column. No DROP, DELETE or
-- TRUNCATE.
-- ============================================================

ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS jersey_number text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prospects_jersey_number_format'
      AND conrelid = 'public.prospects'::regclass
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_jersey_number_format
      CHECK (jersey_number IS NULL OR jersey_number ~ '^[0-9]{1,2}$');
  END IF;
END $$;

COMMENT ON COLUMN public.prospects.jersey_number IS
  'The number he wears now (one or two digits, as text): PFF jersey_number via Fill from PFF, or typed in Edit Bio. Shown after his name on the charting boards.';

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
    VALUES ('104_prospect_jersey_number', 'prospects.jersey_number (current number; Fill from PFF, shown after his name)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
