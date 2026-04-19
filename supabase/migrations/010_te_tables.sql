-- te_plays: one row per TE snap, tracking alignment, play type, blocking, and route details.
-- Conditional fields:
--   block_type/block_success are NULL when play_type = 'route_run'
--   coverage/route_type/was_open/targeted are NULL when play_type IN ('run_block','pass_block')
--   caught/dropped/contested_target/contested_catch are NULL when targeted IS NOT TRUE
--   contested_catch is NULL when contested_target IS NOT TRUE
--   broken_tackle applies to all play types

CREATE TABLE IF NOT EXISTS te_plays (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id           UUID        NOT NULL REFERENCES scouting_games(id) ON DELETE CASCADE,
  location          TEXT        NOT NULL CHECK (location IN ('left', 'right', 'backfield')),
  positioning       TEXT        NOT NULL CHECK (positioning IN ('wide', 'slot', 'inline', 'full_back', 'running_back')),
  play_type         TEXT        NOT NULL CHECK (play_type IN ('run_block', 'pass_block', 'route_run')),

  -- Blocking fields (NULL when route_run)
  block_type        TEXT        CHECK (block_type IN ('movement', 'inline')),
  block_success     BOOLEAN,

  -- Route fields (NULL when run_block or pass_block)
  coverage          TEXT        CHECK (coverage IN ('man', 'zone', 'press', 'double')),
  route_type        TEXT        CHECK (route_type IN ('nine','post','dig','curl','slant','screen','flat','comeback','out','corner','other')),
  was_open          BOOLEAN,
  targeted          BOOLEAN,

  -- Target outcome fields (NULL when targeted IS NOT TRUE)
  caught            BOOLEAN,
  dropped           BOOLEAN,
  contested_target  BOOLEAN,

  -- NULL when contested_target IS NOT TRUE
  contested_catch   BOOLEAN,

  broken_tackle     BOOLEAN     NOT NULL DEFAULT false,
  play_notes        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE te_plays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own TE plays" ON te_plays
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_te_plays_game_id ON te_plays(game_id);
CREATE INDEX IF NOT EXISTS idx_te_plays_user_id ON te_plays(user_id);
