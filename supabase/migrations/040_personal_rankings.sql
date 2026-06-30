-- ============================================================
-- DynastyZeus — Migration 040
-- Run in the Supabase SQL editor after migration 039.
-- ⚠️  TAKE A BACKUP FIRST (scripts/backup-supabase.ps1).
-- ============================================================
-- personal_rankings — the user's own ordered player board.
--
-- One row per user holding an ordered jsonb array of Sleeper
-- player_ids (rank = array index). The gap between a player's
-- position here and the market-consensus board is what drives the
-- Trade Finder's buy/sell signal, replacing the old manual
-- player_dispositions dropdowns (removed in a later phase).
--
-- Schema choice (PK on user_id, single jsonb blob):
--   Mirrors player_value_snapshots — one global personal board per
--   user, rewritten atomically on every reorder. A drag/type edit
--   shifts many ranks at once, so a single-row blob is cheaper than
--   re-upserting hundreds of per-player rows.
--
-- Additive & non-destructive: CREATE … IF NOT EXISTS plus
-- DROP POLICY IF EXISTS + CREATE POLICY (safe to re-run). Touches
-- no existing table or data.
--
-- Rollback: DROP TABLE public.personal_rankings;  (manual only)
-- ============================================================


CREATE TABLE IF NOT EXISTS public.personal_rankings (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ordering   jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- ordered array of Sleeper player_id strings; array index = rank
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.personal_rankings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "personal_rankings_self" ON public.personal_rankings;
CREATE POLICY "personal_rankings_self" ON public.personal_rankings FOR ALL
  USING      (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- Explicit grants: Supabase removes implicit default grants on new
-- objects (Oct 30 2026), so spell them out. App users get per-row
-- read/write only — the four DML verbs, NOT GRANT ALL: ALL would
-- include TRUNCATE, which bypasses RLS and could wipe every user's
-- rows. The service role (cron / server) gets full access.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.personal_rankings TO authenticated;
GRANT ALL                            ON public.personal_rankings TO service_role;

-- No secondary index needed: every query is by user_id, already
-- covered by the primary key.

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('040_personal_rankings', 'per-user personal ranking board (drives Trade Finder signal)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
