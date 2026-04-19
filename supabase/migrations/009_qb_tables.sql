-- qb_plays: one row per QB snap, tracking formation, play type, and pass details.
-- Conditional fields:
--   timing/accuracy/depth_zone/route_type/coverage are NULL when play_type = 'run'
--   accuracy/depth_zone/route_type/coverage are NULL when timing = 'scramble'

CREATE TABLE IF NOT EXISTS qb_plays (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id        UUID        NOT NULL REFERENCES scouting_games(id) ON DELETE CASCADE,
  snap_position  TEXT        NOT NULL CHECK (snap_position IN ('shotgun', 'pistol', 'under_center')),
  play_type      TEXT        NOT NULL CHECK (play_type IN ('run', 'rpo', 'pass')),
  timing         TEXT        CHECK (timing IN ('first_option', 'second_option', 'checkdown', 'scramble')),
  accuracy       TEXT        CHECK (accuracy IN ('high', 'low', 'on_target', 'in_front', 'behind')),
  depth_zone     TEXT        CHECK (depth_zone IN (
                               'deep_left', 'deep_center', 'deep_right',
                               'mid_left',  'mid_center',  'mid_right',
                               'short_left','short_center','short_right'
                             )),
  route_type     TEXT        CHECK (route_type IN ('nine','post','dig','curl','slant','screen','flat','comeback','out','corner','other')),
  coverage       TEXT        CHECK (coverage IN ('man', 'zone')),
  play_notes     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE qb_plays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own QB plays" ON qb_plays
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_qb_plays_game_id ON qb_plays(game_id);
CREATE INDEX IF NOT EXISTS idx_qb_plays_user_id ON qb_plays(user_id);
