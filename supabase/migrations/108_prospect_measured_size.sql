-- ============================================================
-- DynastyZeus — Migration 108
-- Run in the Supabase SQL editor after migration 107. The code that uses it
-- can deploy first: until this runs, the Prospect Data sheet's Measured sizes
-- review shows what would change but can't save it (the message names this
-- migration), and Fill from PFF works as before.
-- ============================================================
-- Measured size (stage 5 of the 2026-11-26 scouting plan): a measured height
-- and weight replace the prospect's saved (listed) ones, and say where they
-- were measured. The combine comes from nflverse's combine.csv (the source
-- Fill 40s reads); the Senior Bowl, Shrine Bowl, pro days and other all-star
-- games from a pasted list with a source pick (lib/scouting/measuredSize.ts).
--
--   size_source       'combine' | 'senior_bowl' | 'shrine_bowl' | 'pro_day' |
--                     'all_star'; null = listed (PFF's or typed), as today
--   size_measured_on  the day it was measured; null for the combine, which
--                     outranks everything (the plan: combine, then the most
--                     recent other measurement, then PFF / listed)
--   listed_height     what he was listed at before the first measurement
--   listed_weight     replaced his (shown beside the measured numbers); null
--                     when he was never measured or nothing was listed
--
-- height / weight keep holding the number every score reads, so nothing that
-- reads them changes. Fill from PFF leaves a measured height and weight alone.
--
-- Per user under the existing owner-only RLS on prospects.
--
-- Purely additive: ADD COLUMN IF NOT EXISTS (nullable, no default), CHECKs
-- added only when missing, ledger row. The existing grants and RLS on
-- prospects cover the new columns. No DROP, DELETE or TRUNCATE.
-- ============================================================

ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS size_source text;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS size_measured_on date;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS listed_height text;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS listed_weight integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prospects_size_source_valid'
      AND conrelid = 'public.prospects'::regclass
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_size_source_valid
      CHECK (size_source IS NULL OR size_source IN ('combine', 'senior_bowl', 'shrine_bowl', 'pro_day', 'all_star'));
  END IF;
  -- A date only with a measurement, and every measurement but the combine's
  -- dated. CASE, so a NULL source can't slip through as "unknown".
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prospects_size_measured_on_dated'
      AND conrelid = 'public.prospects'::regclass
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_size_measured_on_dated
      CHECK (CASE
        WHEN size_source IS NULL THEN size_measured_on IS NULL
        WHEN size_source = 'combine' THEN true
        ELSE size_measured_on IS NOT NULL
      END);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prospects_listed_weight_range'
      AND conrelid = 'public.prospects'::regclass
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_listed_weight_range
      CHECK (listed_weight IS NULL OR listed_weight BETWEEN 120 AND 400);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prospects_listed_height_length'
      AND conrelid = 'public.prospects'::regclass
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_listed_height_length
      CHECK (listed_height IS NULL OR char_length(listed_height) <= 20);
  END IF;
END $$;

COMMENT ON COLUMN public.prospects.size_source IS
  'Where his height / weight were measured (migration 108): combine, senior_bowl, shrine_bowl, pro_day, all_star; null = listed (PFF or typed).';
COMMENT ON COLUMN public.prospects.size_measured_on IS
  'The day his size was measured (migration 108); null for the combine, which outranks every other measurement.';
COMMENT ON COLUMN public.prospects.listed_height IS
  'His listed height before the first measurement replaced it (migration 108).';
COMMENT ON COLUMN public.prospects.listed_weight IS
  'His listed weight before the first measurement replaced it (migration 108).';

-- PostgREST picks up the new columns.
NOTIFY pgrst, 'reload schema';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('108_prospect_measured_size', 'prospects.size_source / size_measured_on / listed_height / listed_weight: measured sizes replace the listed ones')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
