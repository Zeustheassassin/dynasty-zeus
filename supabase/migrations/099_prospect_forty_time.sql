-- ============================================================
-- DynastyZeus — Migration 099
-- Run in the Supabase SQL editor after migration 098. The code that uses it
-- can deploy first: until this runs, every board reads "no 40 time" and a
-- 40 typed in Edit Bio fails to save with a message (the rest of the bio
-- still saves: the 40 goes in its own request).
-- ============================================================
-- prospects.forty_time / forty_source / forty_weight: his 40-yard dash, where
-- he ran it and his weigh-in there, for an RB's Speed Score floor in the
-- Dynasty Score (lib/scouting/speedFloor.ts).
--
--   forty_time    numeric(3,2), 4.10–6.50 seconds (the record is 4.21);
--                 null = no time on file
--   forty_source  'combine' (laser-timed) | 'pro_day' (hand-timed, read
--                 +0.05 on the combine's scale); null when there's no time
--   forty_weight  smallint, 150–400 lb: what he weighed in at where he ran;
--                 null = use his bio weight. Speed Score is set on the
--                 weigh-in, and bio weights run heavy (2026 RBs: 5–9 lb over
--                 the combine weigh-in for 9 of 10).
--
-- Per user under the existing owner-only RLS on prospects. numeric(3,2)
-- rounds to hundredths on write, the precision 40s are published in.
--
-- Purely additive: ADD COLUMN IF NOT EXISTS (nullable, no default), CHECKs
-- added only when missing, ledger row. The existing grants and RLS on
-- prospects cover the new columns. No DROP, DELETE or TRUNCATE.
-- ============================================================

ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS forty_time numeric(3,2);
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS forty_source text;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS forty_weight smallint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prospects_forty_time_range'
      AND conrelid = 'public.prospects'::regclass
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_forty_time_range
      CHECK (forty_time IS NULL OR forty_time BETWEEN 4.10 AND 6.50);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prospects_forty_source_valid'
      AND conrelid = 'public.prospects'::regclass
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_forty_source_valid
      CHECK (forty_source IS NULL OR forty_source IN ('combine', 'pro_day'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prospects_forty_weight_range'
      AND conrelid = 'public.prospects'::regclass
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_forty_weight_range
      CHECK (forty_weight IS NULL OR forty_weight BETWEEN 150 AND 400);
  END IF;
END $$;

COMMENT ON COLUMN public.prospects.forty_time IS
  '40-yard dash in seconds (migration 099), from Edit Bio. An RB''s Speed Score floor in the Dynasty Score: lib/scouting/speedFloor.ts.';
COMMENT ON COLUMN public.prospects.forty_source IS
  'Where the 40 was run (migration 099): combine (laser-timed) or pro_day (hand-timed, read +0.05). Null without a time.';
COMMENT ON COLUMN public.prospects.forty_weight IS
  'Weigh-in (lb) where the 40 was run (migration 099), for Speed Score. Null = his bio weight.';

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
    VALUES ('099_prospect_forty_time', 'prospects.forty_time / forty_source / forty_weight: 40-yard dash and weigh-in for the RB Speed Score floor in the Dynasty Score')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
