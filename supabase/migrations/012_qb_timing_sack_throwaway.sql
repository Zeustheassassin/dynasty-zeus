-- Add sack and throw_away to the qb_plays timing check constraint
ALTER TABLE qb_plays DROP CONSTRAINT IF EXISTS qb_plays_timing_check;

ALTER TABLE qb_plays
  ADD CONSTRAINT qb_plays_timing_check
  CHECK (timing IN ('first_option', 'second_option', 'checkdown', 'scramble', 'sack', 'throw_away'));
