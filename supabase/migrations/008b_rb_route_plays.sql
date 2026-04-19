-- Add route run support to rb_plays.
-- New run_type value 'route': RB runs a passing route (not a run or pass block).
-- aligned_as_wr: true when RB lined up wide like a WR at the snap.
-- targeted: true when the QB threw at the RB on this route.
-- The existing 'success' column holds the result:
--   null  = route run, not targeted
--   true  = caught
--   false = dropped

-- Expand the run_type constraint to allow 'route'
ALTER TABLE rb_plays DROP CONSTRAINT IF EXISTS rb_plays_run_type_check;
ALTER TABLE rb_plays
  ADD CONSTRAINT rb_plays_run_type_check
  CHECK (run_type IN ('outside_man_gap', 'inside_man_gap', 'outside_zone', 'inside_zone', 'pass_block', 'route'));

ALTER TABLE rb_plays
  ADD COLUMN IF NOT EXISTS aligned_as_wr BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE rb_plays
  ADD COLUMN IF NOT EXISTS targeted BOOLEAN NOT NULL DEFAULT false;
