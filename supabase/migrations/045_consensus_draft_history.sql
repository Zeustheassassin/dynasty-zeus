-- ============================================================
-- DynastyZeus — Migration 045
-- Run in the Supabase SQL editor after migration 044.
-- ============================================================
-- Adds consensus_draft_history — an append-only sibling to
-- consensus_draft_cache (migration in schema.sql). consensus_draft_cache
-- holds only the latest compile per (user_id, year, player_id) —
-- every "Compile Now"/"Recompile" click in the Draft Hub's Consensus
-- tab overwrites it. This table instead keeps one row per compile
-- run so a later chart (Phase G stage G2, "rookie ADP movement") can
-- plot how a player's average consensus pick number changed across
-- however many times the user has recompiled.
--
-- Per the July 15 2026 platform-upgrade plan's Phase G decision:
-- unlike Phase F's simulation-history (a weekly cron across every
-- registered user's leagues), the compile-consensus endpoint is a
-- manual, expensive (up to 300s), rate-limited, per-user leaguemate-
-- network crawl — not something to run automatically on a schedule.
-- History here is instead written by the SAME manual compile action
-- (app/api/compile-consensus/route.ts), once per player per run, so
-- data density simply tracks how often compiling actually happens.
-- Purely additive — no DROP/ALTER on existing tables.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.consensus_draft_history (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  year           integer     NOT NULL,
  player_id      text        NOT NULL,
  player_name    text        NOT NULL DEFAULT '',
  position       text        NOT NULL DEFAULT '',
  team           text        NOT NULL DEFAULT '',
  avg_pick_no    real        NOT NULL,
  draft_count    integer     NOT NULL,
  snapshotted_at timestamptz NOT NULL DEFAULT now()
);

-- Per-player timeline lookup: WHERE user_id = ? AND year = ? AND player_id = ? ORDER BY snapshotted_at.
CREATE INDEX IF NOT EXISTS consensus_draft_history_lookup
  ON public.consensus_draft_history (user_id, year, player_id, snapshotted_at);

ALTER TABLE public.consensus_draft_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "consensus_draft_history_self" ON public.consensus_draft_history;
CREATE POLICY "consensus_draft_history_self" ON public.consensus_draft_history FOR ALL
  USING      (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- Explicit grants: Supabase removes implicit default grants on new
-- objects (Oct 30 2026), so spell them out. The route writes as the
-- compiling user's own authenticated client (RLS-scoped), never the
-- service role — same auth model as consensus_draft_cache.
GRANT SELECT, INSERT, DELETE ON public.consensus_draft_history TO authenticated;
GRANT ALL                    ON public.consensus_draft_history TO service_role;

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('045_consensus_draft_history', 'append-only ADP history table for Phase G rookie-ADP-movement chart (G1)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
