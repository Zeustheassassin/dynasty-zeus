-- Extend rb_plays with run_block, decoy run types and route sub-fields.

-- 1. Expand run_type to include run_block and decoy
ALTER TABLE rb_plays DROP CONSTRAINT IF EXISTS rb_plays_run_type_check;
ALTER TABLE rb_plays
  ADD CONSTRAINT rb_plays_run_type_check
  CHECK (run_type IN (
    'outside_man_gap', 'inside_man_gap',
    'outside_zone', 'inside_zone',
    'pass_block', 'run_block', 'decoy', 'route'
  ));

-- 2. Route sub-type (Mid Curl, Flats, Big Boy Route)
ALTER TABLE rb_plays
  ADD COLUMN IF NOT EXISTS route_type TEXT
  CHECK (route_type IN ('mid_curl', 'flats', 'big_boy_route'));

-- 3. Was the RB open on the route?
ALTER TABLE rb_plays
  ADD COLUMN IF NOT EXISTS was_open BOOLEAN NOT NULL DEFAULT false;
