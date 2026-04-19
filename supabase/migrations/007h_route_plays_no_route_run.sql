-- Add no_route_run flag to route_plays.
-- When true, the player was on the field (aligned) but did not run a route
-- (e.g. run play, blocking assignment). Counts as a snap but not a route run.
-- Existing rows default to false (all previously logged plays are route runs).
ALTER TABLE route_plays
  ADD COLUMN IF NOT EXISTS no_route_run BOOLEAN NOT NULL DEFAULT false;
