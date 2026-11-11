-- ============================================================
-- DynastyZeus — Migration 097
-- Run in the Supabase SQL editor after migration 096. Safe to run before or
-- after the code deploys: until this table exists the app keeps the user's
-- calls in the browser only (the Supabase load/save fails quietly and is
-- logged), so nothing breaks.
-- ============================================================
-- NFL contracts plan, stage 7 (2026-11-11). The app judges every NFL QB / RB /
-- WR / TE's coming season from his contract and his team (cut risk for a
-- signed player, re-sign odds for an expiring one). The user knows things the
-- model can't (the user, on Jonathan Taylor: the Colts kept him at the
-- deadline while tanking, so a trade is "below 25%"), so they can set their
-- own call per player: he STAYS or he GOES that season. The call counts for
-- that one season only and changes who counts in his team's room and the
-- Dynasty+ path suggestion; the competition odds are left alone (they were
-- measured on contracts alone).
--
-- One jsonb row per user, like pick_value_overrides (083): `overrides` maps an
-- OverTheCap player id to { "call": "stays" | "goes", "season": 2027 }.
-- Clearing a call removes its key; clearing them all leaves '{}'.
--
-- Additive: one new table. No DROP, DELETE, TRUNCATE or ALTER of anything
-- that exists. The policy is created only when it's missing, so the file can
-- be re-run without dropping anything.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.nfl_contract_overrides (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  overrides  jsonb       NOT NULL DEFAULT '{}'::jsonb
                         CHECK (jsonb_typeof(overrides) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nfl_contract_overrides ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'nfl_contract_overrides'
      AND policyname = 'nfl_contract_overrides_self'
  ) THEN
    CREATE POLICY "nfl_contract_overrides_self" ON public.nfl_contract_overrides FOR ALL
      USING      (auth.uid()::text = user_id::text)
      WITH CHECK (auth.uid()::text = user_id::text);
  END IF;
END $$;

-- Explicit grants: Supabase removes implicit default grants on new objects.
-- The app reads and writes as the signed-in user's own authenticated client
-- (RLS-scoped), never the service role.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nfl_contract_overrides TO authenticated;
GRANT ALL                            ON public.nfl_contract_overrides TO service_role;

NOTIFY pgrst, 'reload schema';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('097_nfl_contract_overrides', 'per-user stays / goes calls on NFL players for one season (contracts plan stage 7)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
