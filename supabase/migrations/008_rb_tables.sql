-- RB play-by-play charting table
-- Reuses scouting_games for game metadata (prospect_id, season_year, opponent, etc.)

CREATE TABLE IF NOT EXISTS rb_plays (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id            UUID        NOT NULL REFERENCES scouting_games(id) ON DELETE CASCADE,
  formation          TEXT        NOT NULL CHECK (formation IN ('gun', 'pistol', 'under_center')),
  run_type           TEXT        NOT NULL CHECK (run_type IN ('outside_man_gap', 'inside_man_gap', 'outside_zone', 'inside_zone', 'pass_block')),
  success            BOOLEAN,
  loaded_box         BOOLEAN     NOT NULL DEFAULT false,
  unblocked_defender BOOLEAN     NOT NULL DEFAULT false,
  broken_tackle      BOOLEAN     NOT NULL DEFAULT false,
  explosive_play     BOOLEAN     NOT NULL DEFAULT false,
  run_stuff          BOOLEAN     NOT NULL DEFAULT false,
  play_notes         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE rb_plays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own rb_plays"
  ON rb_plays FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX rb_plays_game_id_idx  ON rb_plays(game_id);
CREATE INDEX rb_plays_user_id_idx  ON rb_plays(user_id);
