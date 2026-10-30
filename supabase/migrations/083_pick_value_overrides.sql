-- ============================================================
-- DynastyZeus — Migration 083
-- Run in the Supabase SQL editor after migration 082. Safe to run before or
-- after the code deploys: until this table exists the app keeps the user's
-- pick values in the browser only (the Supabase load/save just fails quietly
-- and is logged), so nothing breaks.
-- ============================================================
-- The user, 2026-10-30: let me set my own rookie pick values — FantasyCalc
-- prices the next class only by Early/Mid/Late band, so the 1.01 costs the
-- same as the 1.04, and the user's scouting lets them price each slot.
-- FantasyCalc stays the default for every pick the user hasn't set. One set
-- for every league (the user's call; the app already uses FantasyCalc's
-- superflex pick values in every league).
--
-- One jsonb row per user, like personal_rankings (040): `overrides` maps a
-- pick value key to the user's value — an exact slot for the next class
-- ("2027-1.01": 8500) or a whole round for later classes ("2028-1": 3000).
-- Clearing a value removes its key; clearing them all leaves '{}'.
--
-- Additive: one new table. No DROP, DELETE, TRUNCATE or ALTER of anything
-- that exists. The policy is created only when it's missing, so the file can
-- be re-run without dropping anything.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pick_value_overrides (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  overrides  jsonb       NOT NULL DEFAULT '{}'::jsonb
                         CHECK (jsonb_typeof(overrides) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pick_value_overrides ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pick_value_overrides'
      AND policyname = 'pick_value_overrides_self'
  ) THEN
    CREATE POLICY "pick_value_overrides_self" ON public.pick_value_overrides FOR ALL
      USING      (auth.uid()::text = user_id::text)
      WITH CHECK (auth.uid()::text = user_id::text);
  END IF;
END $$;

-- Explicit grants: Supabase removes implicit default grants on new objects
-- (Oct 30 2026). The app reads and writes as the signed-in user's own
-- authenticated client (RLS-scoped), never the service role.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pick_value_overrides TO authenticated;
GRANT ALL                            ON public.pick_value_overrides TO service_role;

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('083_pick_value_overrides', 'per-user rookie pick values that override FantasyCalc')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
