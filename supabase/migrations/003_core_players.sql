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

-- RECONCILED (audit batch B8): this definition was originally TEXT user_id /
-- composite PK and diverged from supabase/schema.sql (the one-time fresh-project
-- snapshot), which uses a uuid+FK design. The two are now aligned on the schema.sql
-- shape: a surrogate uuid `id` PK, a uuid `user_id` FK to auth.users ON DELETE
-- CASCADE, and a UNIQUE(user_id, league_id, player_id) business key. This edit is
-- non-destructive on any live DB — CREATE TABLE IF NOT EXISTS is a no-op where the
-- table already exists, so the live column type is NOT altered here. The app stores
-- the auth UUID either way (the Supabase client marshals it correctly).
CREATE TABLE IF NOT EXISTS public.league_player_tags (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  league_id  TEXT        NOT NULL,
  player_id  TEXT        NOT NULL,
  tag        TEXT        NOT NULL, -- 'CORE' | 'WANT_TO_TRADE'
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, league_id, player_id)
);

-- Each user can only see and modify their own rows
ALTER TABLE public.league_player_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "league_player_tags_self" ON public.league_player_tags;
CREATE POLICY "league_player_tags_self" ON public.league_player_tags
  FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- Fast lookup by user + league (the most common query pattern)
CREATE INDEX IF NOT EXISTS idx_league_player_tags_user_league
  ON public.league_player_tags (user_id, league_id);
