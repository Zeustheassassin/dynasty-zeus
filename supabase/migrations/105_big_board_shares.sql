-- ============================================================
-- DynastyZeus — Migration 105
-- Run in the Supabase SQL editor after migration 104. The code that uses it
-- can deploy first: until this runs, the Big Board's Share button stays off
-- ("needs migration 105"), the Redact toggle's saves fail and roll back, and
-- /board links answer "Board not found".
-- ============================================================
-- big_board_shares: a public, read-only link to one draft class's Big Board
-- (the user, 2026-11-25: "make my big board sharable ... like how i have my
-- rosters as sharable ... per year so either 2027 or 2028 or 2029 etc and
-- always full board not positional").
--
-- One row per user per class year. `token` is the link (/board/{token}),
-- 32 random hex characters from gen_random_uuid(), so a link can't be guessed
-- and one year's link doesn't open another year. `rows` is the class's All
-- board as the Big Board shows it (OVR order; sample dot and %, charted
-- counts, grades, position rank, identity), written by the owner's Big Board
-- whenever it is open and the class changed (lib/scouting/sharedBoard.ts). A
-- snapshot, not a live read: the board's counts, ages and Pre grades are
-- worked out in the browser, so the server couldn't rebuild them the same way.
--
-- prospects.share_redacted: a player the owner marks Redacted on the Big
-- Board (the user, same day: "Can i Mark a player on my big board as Redacted
-- for sharing purposes"). His shared row keeps its rank, sample, charted
-- counts, grades, position rank and position, but reads "Redacted" with no
-- school, age, height or weight; the real name is never written into `rows`.
--
-- Owner-only RLS on the table. Anyone with a link reads it through
-- get_shared_big_board(token), SECURITY DEFINER, which returns that one row's
-- class year, rows and updated_at and nothing else (never the user id).
-- save_big_board_share(year, rows) creates or replaces the caller's row for
-- the year and returns its token (SECURITY INVOKER, so RLS applies).
--
-- Purely additive: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS
-- (prospects.share_redacted, NOT NULL DEFAULT false; the existing grants and
-- owner-only RLS on prospects cover it), CREATE OR REPLACE FUNCTION, explicit
-- grants, RLS + policy, ledger row. No DROP, DELETE or TRUNCATE.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.big_board_shares (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  class_year  integer     NOT NULL CHECK (class_year BETWEEN 2000 AND 2100),
  token       text        NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', '')
                          CHECK (token ~ '^[0-9a-f]{32}$'),
  rows        jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(rows) = 'array'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, class_year)
);

COMMENT ON TABLE public.big_board_shares IS
  'Public read-only Big Board links, one per user per class year: /board/{token}. rows = the class''s All board as of the owner''s last Big Board visit (lib/scouting/sharedBoard.ts).';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.big_board_shares TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.big_board_shares TO service_role;

ALTER TABLE public.big_board_shares ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'big_board_shares' AND policyname = 'Users manage their own board shares'
  ) THEN
    CREATE POLICY "Users manage their own board shares"
      ON public.big_board_shares
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ── Redacted on shared links ────────────────────────────────
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS share_redacted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.prospects.share_redacted IS
  'Redacted on shared Big Board links (migration 105): the link reads "Redacted" with no school, age, height or weight; rank, sample, counts and grades still show.';

-- ── Save (owner) ────────────────────────────────────────────
-- Creates the caller's link for the year, or replaces its rows; the token
-- never changes, so a link already sent keeps working. Returns the token.
CREATE OR REPLACE FUNCTION public.save_big_board_share(p_class_year integer, p_rows jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_user  uuid := auth.uid();
  v_token text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'expected an array of board rows' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_rows) > 2000 THEN
    RAISE EXCEPTION 'too many board rows' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.big_board_shares AS s (user_id, class_year, rows, updated_at)
  VALUES (v_user, p_class_year, p_rows, now())
  ON CONFLICT (user_id, class_year)
  DO UPDATE SET rows = EXCLUDED.rows, updated_at = now()
  RETURNING s.token INTO v_token;

  RETURN v_token;
END;
$fn$;

COMMENT ON FUNCTION public.save_big_board_share(integer, jsonb) IS
  'Creates or replaces the caller''s shared Big Board for a class year; returns the link token.';

REVOKE EXECUTE ON FUNCTION public.save_big_board_share(integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_big_board_share(integer, jsonb) TO authenticated, service_role;

-- ── Read (anyone with the link) ─────────────────────────────
-- SECURITY DEFINER so a signed-out visitor can read the one row the token
-- names. Returns no user id. A malformed token returns nothing.
CREATE OR REPLACE FUNCTION public.get_shared_big_board(p_token text)
RETURNS TABLE (class_year integer, rows jsonb, updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT s.class_year, s.rows, s.updated_at
  FROM public.big_board_shares s
  WHERE p_token ~ '^[0-9a-f]{32}$' AND s.token = p_token;
$fn$;

COMMENT ON FUNCTION public.get_shared_big_board(text) IS
  'One shared Big Board by its link token (class year, rows, updated_at), for the public /board page. No user id.';

REVOKE EXECUTE ON FUNCTION public.get_shared_big_board(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_big_board(text) TO anon, authenticated, service_role;

-- PostgREST picks up the new table and functions.
NOTIFY pgrst, 'reload schema';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('105_big_board_shares', 'big_board_shares + save_big_board_share / get_shared_big_board (public per-class Big Board links), prospects.share_redacted')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
