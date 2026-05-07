-- Migration 029 — Add 'wing_back' to te_plays.positioning CHECK constraint
-- The original CHECK from migration 010 only allowed 5 values; adding a 6th
-- requires replacing the constraint. No data is touched (no existing rows
-- can violate the new wider check), and the column is unchanged.

ALTER TABLE te_plays DROP CONSTRAINT te_plays_positioning_check;

ALTER TABLE te_plays ADD CONSTRAINT te_plays_positioning_check
  CHECK (positioning IN ('wide', 'slot', 'inline', 'full_back', 'running_back', 'wing_back'));
