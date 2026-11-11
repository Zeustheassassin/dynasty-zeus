-- 094: PFF's rushing summary beside each QB season (migrations 092 / 093),
-- for the Dynasty Score's QB rushing bonus (lib/scouting/qbRushing.ts).
--
-- `rushing` holds PFF's rushing totals for his whole season (attempts, yards,
-- games, scrambles, designed yards). The user (2026-11-10): rushing is a
-- fantasy bonus for a QB who can pass ("a QB like Jalen Hurts was pure gold"),
-- measured by carries and yards per carry, not touchdowns ("mostly luck").
-- NULL = not imported yet (run Refresh QB stats in PFF Links).
--
-- Purely additive: ADD COLUMN IF NOT EXISTS, nullable, no default.

ALTER TABLE public.prospect_season_pff_depth ADD COLUMN IF NOT EXISTS rushing jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prospect_season_pff_depth_rushing_object'
  ) THEN
    ALTER TABLE public.prospect_season_pff_depth
      ADD CONSTRAINT prospect_season_pff_depth_rushing_object CHECK (rushing IS NULL OR jsonb_typeof(rushing) = 'object');
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
    VALUES ('094_season_pff_depth_rushing', 'prospect_season_pff_depth.rushing: PFF full-season rushing per QB season for the Dynasty Score QB rushing bonus')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
