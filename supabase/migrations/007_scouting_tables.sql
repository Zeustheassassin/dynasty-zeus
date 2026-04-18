-- ============================================================
-- Migration 007 — Scouting Hub
-- Tables: prospects, scouting_games, route_plays
-- ============================================================


-- ── prospects ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prospects (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name              text        NOT NULL,
  school            text        NOT NULL DEFAULT '',
  conference        text        NOT NULL DEFAULT '',
  position          text        NOT NULL DEFAULT 'WR',
  draft_class_year  integer     NOT NULL DEFAULT 2026,
  height            text        NOT NULL DEFAULT '',
  weight            integer,
  birthday          date,
  personal_rank     integer,
  pff_rank          integer,
  mock_draft_rank   integer,
  drafttek_rank     integer,
  pfn_rank          integer,
  should_play       text        NOT NULL DEFAULT '',
  will_play_pre     text        NOT NULL DEFAULT '',
  will_play_post    text        NOT NULL DEFAULT '',
  charting_decision text        NOT NULL DEFAULT 'pending',
  charting_notes    text        NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE prospects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "prospects_self" ON prospects;
CREATE POLICY "prospects_self" ON prospects FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);


-- ── scouting_games ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scouting_games (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  prospect_id  uuid        REFERENCES prospects(id) ON DELETE CASCADE NOT NULL,
  season_year  integer     NOT NULL,
  opponent     text        NOT NULL DEFAULT '',
  game_slot    integer     NOT NULL DEFAULT 1,
  game_type    text        NOT NULL DEFAULT 'regular',
  watch_date   date,
  notes        text        NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE scouting_games ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scouting_games_self" ON scouting_games;
CREATE POLICY "scouting_games_self" ON scouting_games FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);


-- ── route_plays ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS route_plays (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  game_id     uuid        REFERENCES scouting_games(id) ON DELETE CASCADE NOT NULL,
  route_type  text        NOT NULL DEFAULT 'other',
  alignment   text        NOT NULL DEFAULT 'right',
  on_line     boolean     NOT NULL DEFAULT true,
  targeted    boolean     NOT NULL DEFAULT false,
  success     boolean,
  yards       integer,
  play_notes  text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE route_plays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "route_plays_self" ON route_plays;
CREATE POLICY "route_plays_self" ON route_plays FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);


-- ── indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_prospects_user_draft   ON prospects(user_id, draft_class_year);
CREATE INDEX IF NOT EXISTS idx_scouting_games_prospect ON scouting_games(prospect_id);
CREATE INDEX IF NOT EXISTS idx_route_plays_game        ON route_plays(game_id);
