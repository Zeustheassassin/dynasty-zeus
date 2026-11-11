-- 093: PFF's time-in-pocket report beside each QB season's passing depth
-- (migration 092), for the QB style & pocket profile (lib/scouting/qbStyle.ts).
--
-- `pocket` holds his row of PFF's signature time_in_pocket report over the
-- whole season: dropbacks held under / over 2.5 seconds (less_* / more_*),
-- average time to a sack and to a scramble, accuracy and sacks on each side
-- of 2.5s. The user asked for "time to sack / scramble" and who holds the
-- ball too long (2026-11-10). Shown on the report and the Big Board, not
-- scored. NULL = not imported yet (run Refresh QB stats in PFF Links).
--
-- Purely additive: ADD COLUMN IF NOT EXISTS, nullable, no default.

ALTER TABLE public.prospect_season_pff_depth ADD COLUMN IF NOT EXISTS pocket jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prospect_season_pff_depth_pocket_object'
  ) THEN
    ALTER TABLE public.prospect_season_pff_depth
      ADD CONSTRAINT prospect_season_pff_depth_pocket_object CHECK (pocket IS NULL OR jsonb_typeof(pocket) = 'object');
  END IF;
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
    VALUES ('093_season_pff_depth_pocket', 'prospect_season_pff_depth.pocket: PFF time-in-pocket per QB season (held 2.5s+, time to sack / scramble) for the QB style profile')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
