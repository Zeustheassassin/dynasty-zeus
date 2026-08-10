-- ============================================================
-- DynastyZeus — Migration 049
-- Run in the Supabase SQL editor after migration 048.
-- ============================================================
-- Adds finder_temp_blocks — two related, time-boxed Trade Finder
-- suppressions sharing one table (same shape, different `kind`):
--
--   PLAYER_NO_INTEREST — the user personally doesn't want a specific
--     opposing player to appear as a receive-side suggestion for a
--     chosen duration (1 week/1 month/3 months/6 months). Independent
--     of the opponent's own SELL_NO/SELL_OK willingness tag (that's a
--     separate axis in league_player_tags) — this is about the USER's
--     interest, not the opponent's. block_key = bare player_id (not
--     scoped to the opponent's roster, so the block still applies if
--     the player later moves teams).
--
--   TRADE_DISCARD — the user dismissed one specific Finder-suggested
--     trade (exact give/receive/opponent combination); suppressed for
--     a fixed 2 weeks. block_key = the app's buildTradeFingerprint(...)
--     signature (components/tradeHub/shared.ts).
--
-- Both are per-(user, league), expire via expires_at (no cron cleanup —
-- every read filters expires_at > now() client-side), and sync across
-- devices the same way league_player_tags/league_notes/player_notes do
-- (local-first cache + this table as source of truth).
-- Purely additive — no DROP/ALTER on existing tables.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.finder_temp_blocks (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  league_id  text        NOT NULL,
  kind       text        NOT NULL,           -- 'PLAYER_NO_INTEREST' | 'TRADE_DISCARD'
  block_key  text        NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, league_id, kind, block_key)
);

ALTER TABLE public.finder_temp_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finder_temp_blocks_self" ON public.finder_temp_blocks;
CREATE POLICY "finder_temp_blocks_self" ON public.finder_temp_blocks FOR ALL
  USING      (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- Explicit grants: Supabase removes implicit default grants on new
-- objects (Oct 30 2026), so spell them out. The app writes as the
-- logged-in user's own authenticated client (RLS-scoped), never the
-- service role — same auth model as league_bylaws/league_notes.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finder_temp_blocks TO authenticated;
GRANT ALL                            ON public.finder_temp_blocks TO service_role;

-- Fast lookup by user + league (the most common query pattern)
CREATE INDEX IF NOT EXISTS idx_finder_temp_blocks_user_league
  ON public.finder_temp_blocks (user_id, league_id);

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('049_finder_temp_blocks', 'time-boxed per-user Trade Finder suppressions: player No Interest + trade Discard')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
