-- ============================================================
-- DynastyZeus — Migration 091
-- Run in the Supabase SQL editor after migration 090, BEFORE the code that
-- uses it deploys: the Big Board's Post-Draft tab writes
-- prospects.landing_inputs (until then its saves fail and roll back).
-- ============================================================
-- prospects.landing_inputs: Dynasty+'s team inputs for a drafted prospect
-- (stage 4 of the landing-spot plan; lib/scouting/teamLanding.ts):
--
--   { "pff": {                      -- his NFL team's room, saved once from PFF
--       "asOf": "2027-05-01T...",   --   when PFF's live depth chart was read
--       "season": 2026,             --   the season of the grades / snaps / pass rate
--       "team": "Philadelphia Eagles", "teamId": 21,
--       "room": [ { "name": "...", "depth": 1, "grade": 90.5, "share": 0.88,
--                   "birthDate": "1998-11-14" } ],   -- veterans at his position
--       "qb": { "name": "...", "grade": 78.2, "rookie": false },
--       "bar": { "regular": 60.0, "star": 76.6 },     -- his position's grade bars
--       "passOe": 0.045, "passPct": 0.62, "targetShare": 0.55 },
--     "vetsAhead": 2,               -- the user's entries; absent = use the suggestion
--     "qbGrade": 80,
--     "offense": "pass",            -- pass | balanced | run
--     "path": "opens" }             -- opens | same | closes
--
-- Per user under the existing owner-only RLS on prospects (it holds PFF
-- numbers, which stay with the account that read them). Never recomputed:
-- a class locks at its draft. Null = nothing saved.
--
-- Purely additive: ADD COLUMN IF NOT EXISTS (nullable, no default), an
-- object-only CHECK added only when missing, ledger row. The existing grants
-- and RLS on prospects cover the new column. No DROP, DELETE or TRUNCATE.
-- ============================================================

ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS landing_inputs jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prospects_landing_inputs_object'
      AND conrelid = 'public.prospects'::regclass
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_landing_inputs_object
      CHECK (landing_inputs IS NULL OR jsonb_typeof(landing_inputs) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN public.prospects.landing_inputs IS
  'Dynasty+ team inputs (migration 091): his NFL room saved from PFF on the Post-Draft tab, and the user''s vets ahead / QB grade / offense / path entries. lib/scouting/teamLanding.ts.';

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
    VALUES ('091_prospect_landing_inputs', 'prospects.landing_inputs: Dynasty+ team inputs (saved PFF room + vets ahead / QB / offense / path entries) from the Post-Draft tab')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
