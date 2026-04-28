-- ============================================================
-- Migration 023 — user_sleeper_links table
-- ============================================================
-- Maps Supabase auth users to their Sleeper user_id so server-side
-- jobs (specifically the leaguemate-alerts cron in app/api/cron/
-- leaguemate-alerts) know which Sleeper account to scan for each
-- registered user. The client upserts a row on login.
--
-- Why a dedicated table:
--   The Sleeper user_id is supplied by the client at request time
--   for every existing fan-out (compile-consensus, etc.). A cron
--   has no client, so we need a server-readable mapping.
--
-- Schema choice (PK on user_id):
--   One Sleeper account per Supabase user. If a user re-links to a
--   different Sleeper account the row is upserted, not duplicated.
--
-- Rollback: DROP TABLE user_sleeper_links;  (manual only)
-- ============================================================


CREATE TABLE IF NOT EXISTS user_sleeper_links (
  user_id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  sleeper_user_id  text        NOT NULL,
  sleeper_username text        NOT NULL DEFAULT '',
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_sleeper_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_sleeper_links_self" ON user_sleeper_links;
CREATE POLICY "user_sleeper_links_self" ON user_sleeper_links FOR ALL
  USING      (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- The cron reads via service-role key and bypasses RLS — no extra
-- policy needed. The self policy above covers all client paths
-- (insert on login, update on re-link, select for debugging).

-- Index on sleeper_user_id supports the cron's expected query
-- pattern: "list all (auth_user, sleeper_user) pairs to scan" via
-- a sequential scan today, but the index keeps reverse lookups
-- ("which auth user owns this sleeper id?") cheap as the table
-- grows past a few thousand rows.
CREATE INDEX IF NOT EXISTS idx_user_sleeper_links_sleeper_user_id
  ON public.user_sleeper_links (sleeper_user_id);
