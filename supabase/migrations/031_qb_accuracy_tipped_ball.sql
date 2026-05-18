-- Add 'tipped_ball' to the qb_plays accuracy check constraint.
-- A tipped ball is logged so the play is still recorded (result, depth, route,
-- coverage), but it is excluded from QB accuracy metrics in the UI because the
-- intended trajectory is unknowable after the deflection.
ALTER TABLE qb_plays DROP CONSTRAINT IF EXISTS qb_plays_accuracy_check;

ALTER TABLE qb_plays
  ADD CONSTRAINT qb_plays_accuracy_check
  CHECK (accuracy IN ('high', 'low', 'on_target', 'in_front', 'behind', 'tipped_ball'));
