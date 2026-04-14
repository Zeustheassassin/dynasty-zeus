-- ============================================================
-- DynastyZeus — Migration 003
-- Run in Supabase SQL editor after migration 002.
-- ============================================================
-- Creates the league_player_tags table: per-user, per-league
-- player tags used by the Trade Finder.
--
--   CORE         — "Do Not Sell": suppresses player from give-side
--   WANT_TO_TRADE — "Want to Move": boosts trades involving this player
-- ============================================================

CREATE TABLE IF NOT EXISTS public.league_player_tags (
  user_id    TEXT        NOT NULL,
  league_id  TEXT        NOT NULL,
  player_id  TEXT        NOT NULL,
  tag        TEXT        NOT NULL DEFAULT 'CORE', -- 'CORE' | 'WANT_TO_TRADE'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, league_id, player_id)
);

-- Each user can only see and modify their own rows
ALTER TABLE public.league_player_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "league_player_tags_self" ON public.league_player_tags
  FOR ALL
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

-- Fast lookup by user + league (the most common query pattern)
CREATE INDEX IF NOT EXISTS idx_league_player_tags_user_league
  ON public.league_player_tags (user_id, league_id);
