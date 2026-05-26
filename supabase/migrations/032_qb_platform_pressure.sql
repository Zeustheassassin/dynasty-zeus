-- Add Platform + Pressure tracking to qb_plays.
-- Platform describes QB body posture at the throw; Pressure describes
-- the rush picture and how the QB handled it.
--
-- All four columns are nullable: existing rows stay NULL (treated as
-- "unknown" by stats; not counted in Platform% / Pressure% denominators).
-- New plays must populate them per the UI validation rules.

ALTER TABLE qb_plays
  ADD COLUMN IF NOT EXISTS platform           text,
  ADD COLUMN IF NOT EXISTS platform_side      text,
  ADD COLUMN IF NOT EXISTS pressure           text,
  ADD COLUMN IF NOT EXISTS pressure_handling  text;

ALTER TABLE qb_plays
  ADD CONSTRAINT qb_plays_platform_check
    CHECK (platform IS NULL OR platform IN ('on_platform', 'off_platform', 'on_the_run'));

ALTER TABLE qb_plays
  ADD CONSTRAINT qb_plays_platform_side_check
    CHECK (platform_side IS NULL OR platform_side IN ('strong_side', 'cross_body'));

-- platform_side only meaningful when platform = 'on_the_run'.
ALTER TABLE qb_plays
  ADD CONSTRAINT qb_plays_platform_side_only_on_the_run
    CHECK (platform_side IS NULL OR platform = 'on_the_run');

ALTER TABLE qb_plays
  ADD CONSTRAINT qb_plays_pressure_check
    CHECK (pressure IS NULL OR pressure IN ('clean', 'mid', 'backside', 'front_side'));

ALTER TABLE qb_plays
  ADD CONSTRAINT qb_plays_pressure_handling_check
    CHECK (pressure_handling IS NULL OR pressure_handling IN ('step_up', 'bail_front_side', 'bail_backside'));

-- pressure_handling only meaningful when pressure is set and not clean.
ALTER TABLE qb_plays
  ADD CONSTRAINT qb_plays_handling_only_when_pressured
    CHECK (pressure_handling IS NULL OR (pressure IS NOT NULL AND pressure <> 'clean'));
