-- league_draft_snapshots: user-named point-in-time saves of a completed Live
-- Draft Board. Mirrors the big_board_snapshots pattern.
--
-- snapshot_data is a JSONB object capturing everything needed to re-render the
-- 12-column grid offline (so consensus drift doesn't change historical
-- REACH/VALUE flags):
--   {
--     leagueName: string,
--     leagueId: string | null,
--     season: string,
--     numTeams: number,
--     numRounds: number,
--     headers: [{ slot: number, userId: string | null, username: string }],
--     picks: [{
--       slot: string, pickNo: number, round: number, slotInRound: number,
--       playerId: string | null, name: string, position: string, team: string,
--       drafterUserId: string | null, drafterName: string,
--       poolRank: number,                  -- consensus/FC pool rank at save time
--     }]
--   }

CREATE TABLE IF NOT EXISTS league_draft_snapshots (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name          text        NOT NULL,
  snapshot_data jsonb       NOT NULL DEFAULT '{}'::jsonb,
  saved_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS league_draft_snapshots_user_idx ON league_draft_snapshots (user_id);

ALTER TABLE league_draft_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "league_draft_snapshots_self" ON league_draft_snapshots;
CREATE POLICY "league_draft_snapshots_self" ON league_draft_snapshots FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
