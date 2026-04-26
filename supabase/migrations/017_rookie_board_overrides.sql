-- rookie_board_overrides: per-user customizations on top of the upstream rookie sheet.
-- - added: array of { name, position } the user manually added (not in the upstream sheet)
-- - name_edits: map of { "<normalized-bad-name>": "Corrected Name" } so the rookie board
--   can fix sheet typos without waiting for the source spreadsheet to be updated.
-- One row per (user, year) — keyed the same way as rookie_board_tiers and rookie_board.

CREATE TABLE IF NOT EXISTS rookie_board_overrides (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  year        text        NOT NULL,
  added       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  name_edits  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, year)
);

ALTER TABLE rookie_board_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rookie_board_overrides_self" ON rookie_board_overrides;
CREATE POLICY "rookie_board_overrides_self" ON rookie_board_overrides FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
