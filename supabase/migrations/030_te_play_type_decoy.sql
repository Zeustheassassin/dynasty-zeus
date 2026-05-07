-- Migration 030 — Add 'decoy' to te_plays.play_type CHECK constraint
-- Mirrors RB's decoy run_type: a snap that is neither block nor route
-- (a fake route on a run play). No data is touched and the column is
-- unchanged; existing rows all satisfy the wider check.

ALTER TABLE te_plays DROP CONSTRAINT te_plays_play_type_check;

ALTER TABLE te_plays ADD CONSTRAINT te_plays_play_type_check
  CHECK (play_type IN ('run_block', 'pass_block', 'route_run', 'decoy'));
