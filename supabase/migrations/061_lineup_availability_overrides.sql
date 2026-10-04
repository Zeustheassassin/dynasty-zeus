-- ============================================================
-- DynastyZeus — Migration 061
-- Run in the Supabase SQL editor after migration 060.
-- ============================================================
-- Adds lineup_availability_overrides — the user's own call on a player for
-- one NFL week, applied by the Lineup Coach (Starters tab) and the League
-- Overview status dot in EVERY league (no league_id: a player who won't play
-- is out everywhere).
--
--   OUT — keep him out of suggested lineups this week, whatever his tag says
--         (e.g. a late-game Questionable the news says will sit).
--   IN  — start him anyway: overrides an ESPN "unlikely to play" note and
--         silences the late-game pivot warning.
--
-- Scoped to (season, week) so a call expires on its own when Sleeper's week
-- rolls over — no cron cleanup. Local-first like finder_temp_blocks: the app
-- keeps a localStorage mirror, so the toggle works on that device even before
-- this migration is applied; this table syncs it across devices.
-- Purely additive — no DROP/ALTER on existing tables.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lineup_availability_overrides (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  player_id    text        NOT NULL,
  season       integer     NOT NULL,
  week         integer     NOT NULL,
  availability text        NOT NULL CHECK (availability IN ('OUT', 'IN')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, player_id, season, week)
);

ALTER TABLE public.lineup_availability_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lineup_availability_overrides_self" ON public.lineup_availability_overrides;
CREATE POLICY "lineup_availability_overrides_self" ON public.lineup_availability_overrides FOR ALL
  USING      (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- Explicit grants: Supabase removes implicit default grants on new
-- objects (Oct 30 2026), so spell them out. The app writes as the
-- logged-in user's own authenticated client (RLS-scoped), never the
-- service role — same auth model as finder_temp_blocks.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lineup_availability_overrides TO authenticated;
GRANT ALL                            ON public.lineup_availability_overrides TO service_role;

CREATE INDEX IF NOT EXISTS idx_lineup_availability_overrides_user_week
  ON public.lineup_availability_overrides (user_id, season, week);

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('061_lineup_availability_overrides', 'per-user, per-week Lineup Coach Out/In calls on a player, applied in every league')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
