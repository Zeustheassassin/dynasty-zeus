-- player_nfl_draft_info: per-user log of where each rookie was drafted in the actual NFL Draft.
-- One row per user. draft_info JSONB is keyed by player_key (Sleeper player_id, or "name:<name>"
-- fallback when player_id is missing) and stores { team, round, pick } per player.

CREATE TABLE IF NOT EXISTS player_nfl_draft_info (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  draft_info  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE player_nfl_draft_info ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "player_nfl_draft_info_self" ON player_nfl_draft_info;
CREATE POLICY "player_nfl_draft_info_self" ON player_nfl_draft_info FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
