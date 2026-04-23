-- big_board_snapshots: user-named point-in-time saves of the Rookie Big Board.
-- Each row is one named snapshot (e.g. "2026 Pre-Draft", "2026 Post-Draft").
-- Saving with the same name overwrites the previous row via the unique constraint.
-- snapshot_data is a JSONB array of player entries captured at save time:
--   [{ id, name, position, school, draft_class_year, overall_rank, personal_rank,
--      nfl_draft: { team, round, pick } | null }, ...]

CREATE TABLE IF NOT EXISTS big_board_snapshots (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name          text        NOT NULL,
  snapshot_data jsonb       NOT NULL DEFAULT '[]'::jsonb,
  saved_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS big_board_snapshots_user_idx ON big_board_snapshots (user_id);

ALTER TABLE big_board_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "big_board_snapshots_self" ON big_board_snapshots;
CREATE POLICY "big_board_snapshots_self" ON big_board_snapshots FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
