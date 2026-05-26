-- Add QB touch tracking — whether the velocity / feel on the throw was
-- correct for the situation (e.g., feathered when needed vs. fastball into
-- a small window). Required for every pass attempt in the UI, defaulting
-- to 'correct' so the charter only flips it when something's off.
--
-- Nullable to keep existing rows valid; the UI's canLog never persists null
-- on a new play because the field is initialised to 'correct'.

ALTER TABLE qb_plays
  ADD COLUMN IF NOT EXISTS touch text;

ALTER TABLE qb_plays
  ADD CONSTRAINT qb_plays_touch_check
    CHECK (touch IS NULL OR touch IN ('correct', 'incorrect'));
