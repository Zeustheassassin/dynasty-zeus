-- Migration 007f — Add summary stat columns to scouting_games
-- Used by summary-imported games where per-play targeted/caught/etc are not tracked

ALTER TABLE scouting_games
  ADD COLUMN IF NOT EXISTS summary_targets        integer,
  ADD COLUMN IF NOT EXISTS summary_catches        integer,
  ADD COLUMN IF NOT EXISTS summary_drops          integer,
  ADD COLUMN IF NOT EXISTS summary_contested      integer,
  ADD COLUMN IF NOT EXISTS summary_contested_catches integer;
