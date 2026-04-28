-- ============================================================
-- Migration 024 — league_transactions_cache table
-- ============================================================
-- Pre-computed cache of the user's "League transactions feed"
-- written by the cron at app/api/cron/league-transactions and
-- read by the dashboard's transactions list.
--
-- Why this exists:
--   The original client-side effect (app/hooks/useAppState.ts:3072)
--   fanned out to ~240 Sleeper calls/cold-session for a 34-league
--   user. Stage S3.7 moves that fan-out to a server cron so the
--   client only does one Supabase SELECT instead.
--
-- Schema choice (composite PK on user_id + transaction_id):
--   Each user gets their own annotated copy because the rendered
--   shape depends on which leagues they're in (leagueName,
--   rosterOwnerMap). Same Sleeper transaction would have different
--   stored payloads for different users only if the league name
--   were renamed mid-stream — payload is per-user safe.
--
-- Rollback: DROP TABLE league_transactions_cache;  (manual only)
-- ============================================================


CREATE TABLE IF NOT EXISTS league_transactions_cache (
  user_id        uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  transaction_id text        NOT NULL,
  league_id      text        NOT NULL,
  created        bigint      NOT NULL,
  payload        jsonb       NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, transaction_id)
);

ALTER TABLE league_transactions_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "league_transactions_cache_self" ON league_transactions_cache;
CREATE POLICY "league_transactions_cache_self" ON league_transactions_cache FOR ALL
  USING      (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- The cron writes with the service-role key and bypasses RLS — no
-- extra policy needed. The self policy covers all client paths.

-- The dashboard query is `SELECT … WHERE user_id = $1 ORDER BY
-- created DESC LIMIT 200`, so a (user_id, created DESC) index turns
-- that into a fast range scan on the index without sorting.
CREATE INDEX IF NOT EXISTS idx_league_transactions_cache_user_created
  ON public.league_transactions_cache (user_id, created DESC);
