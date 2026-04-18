-- ============================================================
-- Migration 007c — Add auth.uid() defaults to scouting tables
-- This lets the app insert rows without explicitly passing user_id.
-- ============================================================

ALTER TABLE prospects      ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE scouting_games ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE route_plays    ALTER COLUMN user_id SET DEFAULT auth.uid();
