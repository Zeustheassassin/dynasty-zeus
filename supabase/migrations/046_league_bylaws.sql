-- ============================================================
-- DynastyZeus — Migration 046
-- Run in the Supabase SQL editor after migration 045.
-- ============================================================
-- Adds league_bylaws — Phase I stage I3 (league constitution/bylaws
-- text field in Management Hub). Per the 2026-07-16 platform-upgrade
-- decision, this app has no shared multi-tenant league record (leagues
-- are Sleeper-sourced, each app account keeps its own copy), so bylaws
-- text is scoped per (user_id, league_id) — same shape and RLS pattern
-- as the existing league_notes table, just a distinct table so it can
-- be edited from its own Management Hub tab without colliding with the
-- unrelated League Hub notes feature.
-- Purely additive — no DROP/ALTER on existing tables.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.league_bylaws (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  league_id  text        NOT NULL,
  content    text        NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, league_id)
);

ALTER TABLE public.league_bylaws ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "league_bylaws_self" ON public.league_bylaws;
CREATE POLICY "league_bylaws_self" ON public.league_bylaws FOR ALL
  USING      (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- Explicit grants: Supabase removes implicit default grants on new
-- objects (Oct 30 2026), so spell them out. The Management Hub writes
-- as the editing user's own authenticated client (RLS-scoped), never
-- the service role — same auth model as league_notes.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.league_bylaws TO authenticated;
GRANT ALL                            ON public.league_bylaws TO service_role;

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('046_league_bylaws', 'per-user league constitution/bylaws text field for Management Hub (Phase I, I3)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
