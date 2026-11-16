-- ============================================================
-- DynastyZeus — Migration 100
-- Run in the Supabase SQL editor after migration 099. The code that uses it
-- can deploy first: until this runs, Fill 40s can still save combine times
-- (migration 099's columns), and its projected times fail to save with a
-- message.
-- ============================================================
-- prospects.forty_projected / forty_projected_from: a projected 40 from a
-- public draft site (Fill 40s on the Prospect Data sheet; WalterFootball),
-- shown greyed where there's no real 40 yet.
--
--   forty_projected       numeric(3,2), 4.10–6.50 seconds; null = none
--   forty_projected_from  the site it came from, e.g. 'WalterFootball'
--
-- DISPLAY ONLY: the RB speed floor (lib/scouting/speedFloor.ts) never reads
-- it. A projection has no stated method or track record, and the floor
-- charges up to 0.7, so only a real 40 (forty_time, migration 099) counts.
--
-- Per user under the existing owner-only RLS on prospects.
--
-- Purely additive: ADD COLUMN IF NOT EXISTS (nullable, no default), CHECKs
-- added only when missing, ledger row. The existing grants and RLS on
-- prospects cover the new columns. No DROP, DELETE or TRUNCATE.
-- ============================================================

ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS forty_projected numeric(3,2);
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS forty_projected_from text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prospects_forty_projected_range'
      AND conrelid = 'public.prospects'::regclass
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_forty_projected_range
      CHECK (forty_projected IS NULL OR forty_projected BETWEEN 4.10 AND 6.50);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prospects_forty_projected_from_length'
      AND conrelid = 'public.prospects'::regclass
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_forty_projected_from_length
      CHECK (forty_projected_from IS NULL OR char_length(forty_projected_from) <= 40);
  END IF;
END $$;

COMMENT ON COLUMN public.prospects.forty_projected IS
  'Projected 40 from a public draft site (migration 100; Fill 40s). Display only: the speed floor reads only forty_time.';
COMMENT ON COLUMN public.prospects.forty_projected_from IS
  'Where forty_projected came from (migration 100), e.g. WalterFootball.';

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
    VALUES ('100_prospect_forty_projected', 'prospects.forty_projected / forty_projected_from: projected 40s from Fill 40s, display only')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
