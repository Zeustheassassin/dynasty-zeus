-- 092: PFF's full-season passing depth for QB prospects (the QB AE Score's
-- middle-of-the-field adjustment, lib/scouting/middleUsage.ts).
--
-- One row per prospect and college season: PFF's passing/depth report over
-- the WHOLE season (every game, not just the charted weeks), as attempts per
-- zone (left / center / right × behind the line / short 0–9 / medium 10–19 /
-- deep 20+; PFF's center is between the numbers). The user's call
-- (2026-11-10): "penalise QBs who don't take these throws ... that can be a
-- full season sample for just that metric". Over 3–5 charted games the share
-- is mostly noise; a full season is ~70% real and it carries from one season
-- to the next, transfers included (checked on 109 NCAA QBs).
--
-- Written by POST /api/pff/import as the caller under their own RLS, like
-- 063's tables. A refresh overwrites. `raw` keeps PFF's whole row (accuracy,
-- BTT, TWP, time to throw per zone) for the field-usage display, so it never
-- needs a re-import.
--
-- Purely additive: CREATE TABLE IF NOT EXISTS, RLS, explicit grants, an index.

CREATE TABLE IF NOT EXISTS public.prospect_season_pff_depth (
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prospect_id    uuid        NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  season         integer     NOT NULL,
  pff_player_id  integer     NOT NULL,
  team_name      text,
  -- {"left_behind_los": n, "center_medium": n, ...}: PFF's <zone>_attempts.
  zone_attempts  jsonb       NOT NULL,
  raw            jsonb       NOT NULL,
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (prospect_id, season),
  CONSTRAINT prospect_season_pff_depth_zones_object CHECK (jsonb_typeof(zone_attempts) = 'object')
);

ALTER TABLE public.prospect_season_pff_depth ENABLE ROW LEVEL SECURITY;

-- Created only when missing, so a re-run is a no-op (no DROP POLICY).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'prospect_season_pff_depth' AND policyname = 'prospect_season_pff_depth_self'
  ) THEN
    CREATE POLICY "prospect_season_pff_depth_self" ON public.prospect_season_pff_depth FOR ALL
      USING      (auth.uid()::text = user_id::text)
      WITH CHECK (auth.uid()::text = user_id::text);
  END IF;
END $$;

-- Explicit grants: Supabase removes implicit default grants on new objects.
-- No anon grant: PFF data is never public.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prospect_season_pff_depth TO authenticated;
GRANT ALL ON public.prospect_season_pff_depth TO service_role;

CREATE INDEX IF NOT EXISTS idx_prospect_season_pff_depth_user ON public.prospect_season_pff_depth (user_id);

NOTIFY pgrst, 'reload schema';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('092_prospect_season_pff_depth', 'prospect_season_pff_depth: PFF full-season passing depth per QB prospect and season (QB AE Score middle-of-the-field adjustment)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
