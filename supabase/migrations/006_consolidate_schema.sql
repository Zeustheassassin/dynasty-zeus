-- ============================================================
-- Migration 006 — Consolidate user-data schema into migration chain
-- ============================================================
-- Context:
--   All tables below were originally created by running schema.sql
--   manually in the Supabase SQL editor.  That file is NOT part of
--   the migration chain, so a fresh install that only runs
--   migrations 001-005 would be missing all user-data tables.
--
--   This migration brings every table from schema.sql into the chain
--   using CREATE TABLE IF NOT EXISTS so it is safe to re-run on
--   databases where schema.sql has already been applied.
--
-- What this migration does:
--   - Creates 19 user-data tables with RLS policies
--   - Tables covered: notes, league_notes, league_management,
--     commissioner_payments, rookie_board, watchlists, alerts,
--     consensus_draft_cache, consensus_draft_meta, player_notes,
--     player_dispositions, player_value_snapshots, trade_attempts,
--     leaguemate_profiles, league_simulations, draft_board_picks,
--     owner_tendencies, consensus_player_grades, rookie_board_tiers
--
-- Rollback: drop each table individually — all user data will be lost.
-- There is no safe rollback for this migration in production.
-- ============================================================


-- ── notes (title/body note cards) ────────────────────────────
CREATE TABLE IF NOT EXISTS notes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title      text        NOT NULL DEFAULT '',
  body       text        NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notes_self" ON notes;
CREATE POLICY "notes_self" ON notes FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);


-- ── league_notes (per-league free-text notes) ─────────────────
CREATE TABLE IF NOT EXISTS league_notes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  league_id  text        NOT NULL,
  content    text        NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, league_id)
);
ALTER TABLE league_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "league_notes_self" ON league_notes;
CREATE POLICY "league_notes_self" ON league_notes FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);


-- ── league_management (per-league checkbox flags) ────────────
CREATE TABLE IF NOT EXISTS league_management (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  league_id        text        NOT NULL,
  paid_2026        boolean     NOT NULL DEFAULT false,
  paid_2027        boolean     NOT NULL DEFAULT false,
  paid_2028        boolean     NOT NULL DEFAULT false,
  paid_2029        boolean     NOT NULL DEFAULT false,
  commissioner     boolean     NOT NULL DEFAULT false,
  year_in_advance  boolean     NOT NULL DEFAULT false,
  picks_traded     boolean     NOT NULL DEFAULT false,
  amount           text        NOT NULL DEFAULT '',
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, league_id)
);
ALTER TABLE league_management ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "league_management_self" ON league_management;
CREATE POLICY "league_management_self" ON league_management FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);


-- ── commissioner_payments (per-league per-owner paid years) ───
CREATE TABLE IF NOT EXISTS commissioner_payments (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  league_id  text        NOT NULL,
  owner_id   text        NOT NULL,
  paid_2026  boolean     NOT NULL DEFAULT false,
  paid_2027  boolean     NOT NULL DEFAULT false,
  paid_2028  boolean     NOT NULL DEFAULT false,
  paid_2029  boolean     NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, league_id, owner_id)
);
ALTER TABLE commissioner_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "commissioner_payments_self" ON commissioner_payments;
CREATE POLICY "commissioner_payments_self" ON commissioner_payments FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);


-- ── rookie_board (custom player rankings order) ───────────────
CREATE TABLE IF NOT EXISTS rookie_board (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  year       text        NOT NULL,
  players    jsonb       NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, year)
);
ALTER TABLE rookie_board ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rookie_board_self" ON rookie_board;
CREATE POLICY "rookie_board_self" ON rookie_board FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);


-- ── watchlists (alerts center tracked players) ─────────────────
CREATE TABLE IF NOT EXISTS watchlists (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  player_id      text        NOT NULL,
  label          text        NOT NULL DEFAULT '',
  threshold_up   integer     NOT NULL DEFAULT 250,
  threshold_down integer     NOT NULL DEFAULT 250,
  league_id      text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, player_id)
);
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "watchlists_self" ON watchlists;
CREATE POLICY "watchlists_self" ON watchlists FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);


-- ── alerts (alerts center cache + dismiss state) ───────────────
CREATE TABLE IF NOT EXISTS alerts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  alert_id   text        NOT NULL,
  category   text        NOT NULL DEFAULT 'watchlist',
  source     text        NOT NULL DEFAULT 'internal',
  severity   text        NOT NULL DEFAULT 'low',
  title      text        NOT NULL DEFAULT '',
  detail     text        NOT NULL DEFAULT '',
  actionable boolean     NOT NULL DEFAULT true,
  dismissed  boolean     NOT NULL DEFAULT false,
  league_id  text,
  player_id  text,
  payload    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, alert_id)
);
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "alerts_self" ON alerts;
CREATE POLICY "alerts_self" ON alerts FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);


-- ── consensus_draft_cache (per-player aggregated picks per user/year) ─
CREATE TABLE IF NOT EXISTS consensus_draft_cache (
  user_id      uuid    REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  year         integer NOT NULL,
  player_id    text    NOT NULL,
  player_name  text    NOT NULL DEFAULT '',
  position     text    NOT NULL DEFAULT '',
  team         text    NOT NULL DEFAULT '',
  avg_pick_no  real    NOT NULL,
  draft_count  integer NOT NULL,
  PRIMARY KEY (user_id, year, player_id)
);
ALTER TABLE consensus_draft_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "consensus_cache_self" ON consensus_draft_cache;
CREATE POLICY "consensus_cache_self" ON consensus_draft_cache FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);


-- ── consensus_draft_meta (compilation run metadata per user/year) ─
CREATE TABLE IF NOT EXISTS consensus_draft_meta (
  user_id              uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  year                 integer     NOT NULL,
  total_drafts         integer     NOT NULL DEFAULT 0,
  total_leagues        integer     NOT NULL DEFAULT 0,
  connected_user_count integer     NOT NULL DEFAULT 0,
  compiled_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, year)
);
ALTER TABLE consensus_draft_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "consensus_meta_self" ON consensus_draft_meta;
CREATE POLICY "consensus_meta_self" ON consensus_draft_meta FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);


-- ── player_notes (per-player free-text scouting notes) ────────
CREATE TABLE IF NOT EXISTS player_notes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  player_id  text        NOT NULL,
  note       text        NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, player_id)
);
ALTER TABLE player_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "player_notes_self" ON player_notes;
CREATE POLICY "player_notes_self" ON player_notes FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);


-- ── player_dispositions (buy/sell tags per player) ────────────
CREATE TABLE IF NOT EXISTS player_dispositions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  player_id  text        NOT NULL,
  sell       text        NOT NULL DEFAULT '',
  buy        text        NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, player_id)
);
ALTER TABLE player_dispositions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "player_dispositions_self" ON player_dispositions;
CREATE POLICY "player_dispositions_self" ON player_dispositions FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);


-- ── player_value_snapshots (dynasty value baseline for alerts) ─
-- One row per user — the entire player map snapshot lives in the jsonb column.
CREATE TABLE IF NOT EXISTS player_value_snapshots (
  user_id     uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL PRIMARY KEY,
  snapshot    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE player_value_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "player_value_snapshots_self" ON player_value_snapshots;
CREATE POLICY "player_value_snapshots_self" ON player_value_snapshots FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);


-- ── trade_attempts (trade log / CRM for trade hub) ────────────
CREATE TABLE IF NOT EXISTS trade_attempts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  league_id        text        NOT NULL,
  partner_roster_id integer    NOT NULL,
  partner_name     text        NOT NULL DEFAULT '',
  give_players     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  give_picks       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  receive_players  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  receive_picks    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  source           text        NOT NULL DEFAULT 'CALCULATOR',
  initiated_by     text        NOT NULL DEFAULT 'ME',
  status           text        NOT NULL DEFAULT 'PENDING',
  counter_details  text,
  attempted_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz
);
ALTER TABLE trade_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trade_attempts_self" ON trade_attempts;
CREATE POLICY "trade_attempts_self" ON trade_attempts FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);
-- Index for the common filter: all attempts for a user's specific league
CREATE INDEX IF NOT EXISTS trade_attempts_user_league ON trade_attempts (user_id, league_id);


-- ── leaguemate_profiles (cached per-league cross-league intel) ─
CREATE TABLE IF NOT EXISTS leaguemate_profiles (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  league_id  text        NOT NULL,
  profiles   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, league_id)
);
ALTER TABLE leaguemate_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leaguemate_profiles_self" ON leaguemate_profiles;
CREATE POLICY "leaguemate_profiles_self" ON leaguemate_profiles FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);


-- ── league_simulations (season simulator results per roster) ──
CREATE TABLE IF NOT EXISTS league_simulations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  league_id     text        NOT NULL,
  roster_id     integer     NOT NULL,
  playoff_odds  real        NOT NULL DEFAULT 0,
  title_odds    real        NOT NULL DEFAULT 0,
  expected_wins real        NOT NULL DEFAULT 0,
  avg_finish    real        NOT NULL DEFAULT 0,
  finish_range  text        NOT NULL DEFAULT '',
  computed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, league_id, roster_id)
);
ALTER TABLE league_simulations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "league_simulations_self" ON league_simulations;
CREATE POLICY "league_simulations_self" ON league_simulations FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);
-- Index for bulk load of all sims for a user on login
CREATE INDEX IF NOT EXISTS league_simulations_user ON league_simulations (user_id);


-- ── draft_board_picks (user's manual pick-slot → player assignments) ─
CREATE TABLE IF NOT EXISTS draft_board_picks (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  league_id  text        NOT NULL,
  season     text        NOT NULL,
  pick_slot  text        NOT NULL,
  player_id  text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, league_id, season, pick_slot)
);
ALTER TABLE draft_board_picks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "draft_board_picks_self" ON draft_board_picks;
CREATE POLICY "draft_board_picks_self" ON draft_board_picks FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);


-- ── owner_tendencies (cached per-owner positional draft rates) ─
-- Keyed by Sleeper owner_user_id (text), not auth.users uuid.
-- Not tied to auth so owner data can be shared across users who league together.
-- INTENTIONAL DESIGN: open read + write for all authenticated users because
-- tendencies are non-PII aggregate stats computed from public Sleeper data and
-- shared cross-league. DELETE is explicitly blocked to prevent data vandalism.
CREATE TABLE IF NOT EXISTS owner_tendencies (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text        NOT NULL,
  season        text        NOT NULL,
  rates         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, season)
);
ALTER TABLE owner_tendencies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owner_tendencies_open_read"   ON owner_tendencies;
DROP POLICY IF EXISTS "owner_tendencies_open_write"  ON owner_tendencies;
DROP POLICY IF EXISTS "owner_tendencies_open_update" ON owner_tendencies;
DROP POLICY IF EXISTS "owner_tendencies_no_delete"   ON owner_tendencies;
-- Readable by all authenticated users (tendencies are not PII)
CREATE POLICY "owner_tendencies_open_read" ON owner_tendencies FOR SELECT
  USING (auth.role() = 'authenticated');
-- Any authenticated user may insert tendency rows (shared aggregate data)
CREATE POLICY "owner_tendencies_open_write" ON owner_tendencies FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "owner_tendencies_open_update" ON owner_tendencies FOR UPDATE
  USING  (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
-- DELETE is explicitly blocked — no authenticated user may delete tendency rows
CREATE POLICY "owner_tendencies_no_delete" ON owner_tendencies FOR DELETE
  USING (false);


-- ── consensus_player_grades (hit/neutral/bust grades per player) ─
-- Stored in a single jsonb blob keyed by "{year}_{player_id}"
CREATE TABLE IF NOT EXISTS consensus_player_grades (
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL PRIMARY KEY,
  grades     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE consensus_player_grades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "consensus_player_grades_self" ON consensus_player_grades;
CREATE POLICY "consensus_player_grades_self" ON consensus_player_grades FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);


-- ── rookie_board_tiers (tier-bracket assignments for the draft board) ─
-- tier labels stored as jsonb: { [player_id]: tierNumber }
CREATE TABLE IF NOT EXISTS rookie_board_tiers (
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  year       text        NOT NULL,
  tiers      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, year)
);
ALTER TABLE rookie_board_tiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rookie_board_tiers_self" ON rookie_board_tiers;
CREATE POLICY "rookie_board_tiers_self" ON rookie_board_tiers FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);


-- ── Re-apply user_id indexes now that tables are guaranteed present ─
-- Migration 005 wraps these in DO/EXCEPTION blocks as a safety net.
-- Running them here too ensures indexes exist even if 005 fired first
-- and skipped due to missing tables.
CREATE INDEX IF NOT EXISTS idx_alerts_user_id                ON public.alerts (user_id);
CREATE INDEX IF NOT EXISTS idx_watchlists_user_id            ON public.watchlists (user_id);
CREATE INDEX IF NOT EXISTS idx_league_notes_user_id          ON public.league_notes (user_id);
CREATE INDEX IF NOT EXISTS idx_player_notes_user_id          ON public.player_notes (user_id);
CREATE INDEX IF NOT EXISTS idx_player_dispositions_user_id   ON public.player_dispositions (user_id);
CREATE INDEX IF NOT EXISTS idx_player_value_snapshots_user_id ON public.player_value_snapshots (user_id);
CREATE INDEX IF NOT EXISTS idx_leaguemate_profiles_user_id   ON public.leaguemate_profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_rookie_board_user_id          ON public.rookie_board (user_id);
CREATE INDEX IF NOT EXISTS idx_rookie_board_tiers_user_id    ON public.rookie_board_tiers (user_id);
CREATE INDEX IF NOT EXISTS idx_league_management_user_id     ON public.league_management (user_id);
CREATE INDEX IF NOT EXISTS idx_commissioner_payments_user_id ON public.commissioner_payments (user_id);
