-- ============================================================
-- DynastyZeus — Migration 069
-- Run in the Supabase SQL editor after migration 068. Safe before or after
-- the code deploys: until take_sleeper_call_slot exists, the server's RPC
-- fails and each lambda instance falls back to its own in-process window
-- (lib/server/sleeperBudget.ts).
-- ============================================================
-- Sleeper call-budget Stage 4: one global ceiling on server-side Sleeper
-- calls. Sleeper asks for under 1000 calls a minute per IP, and Vercel's
-- egress IPs aren't fixed, so every server job and every /api/sleeper/*
-- proxy call that actually reaches Sleeper draws on this one counter.
--
-- 1. sleeper_call_budget: a ring of 6 rows, one per 10-second window
--    (slot = window number mod 6). A row whose window_id is older than the
--    current window is simply reset by the next call that lands on it, so
--    nothing ever needs cleaning up. Six rows keep the last minute visible:
--
--      SELECT slot, window_id, calls, updated_at
--      FROM public.sleeper_call_budget ORDER BY window_id DESC;
--
-- 2. take_sleeper_call_slot(p_limit): counts one call in the current window
--    if it holds fewer than p_limit, in one atomic statement (concurrent
--    callers serialize on the row lock and re-check the limit). The server
--    passes 100 for someone waiting on a page and 60 for background jobs, so
--    jobs only run while the window is under 60. 100 a window = at most 700
--    in any 60 seconds, 600 sustained. Returns whether the call was counted,
--    the window's count, and the ms until the next window starts (the
--    server waits that long before asking again).
--
-- Server-only: the service role is the only role granted the table or the
-- function. anon / authenticated get neither, so a browser can't read or
-- bump the counter.
--
-- Purely additive: CREATE TABLE IF NOT EXISTS, seed rows ON CONFLICT DO
-- NOTHING, CREATE OR REPLACE FUNCTION, policy created only when missing,
-- explicit grants / revokes, ledger row. No DROP, DELETE or TRUNCATE.
-- ============================================================

-- ── 1. The ring ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sleeper_call_budget (
  slot        smallint    PRIMARY KEY CHECK (slot BETWEEN 0 AND 5),
  window_id   bigint      NOT NULL DEFAULT 0,
  calls       integer     NOT NULL DEFAULT 0 CHECK (calls >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sleeper_call_budget IS
  'Global Sleeper call counter: one row per 10s window (slot = window mod 6). Written only through take_sleeper_call_slot — lib/server/sleeperBudget.ts.';
COMMENT ON COLUMN public.sleeper_call_budget.window_id IS
  'floor(epoch ms / 10000) of the window this row''s count belongs to.';

INSERT INTO public.sleeper_call_budget (slot)
SELECT g FROM generate_series(0, 5) AS g
ON CONFLICT (slot) DO NOTHING;

-- ── 2. Take a slot ───────────────────────────────────────────
-- The window comes from the database clock, so every lambda agrees on it.
-- INSERT ... ON CONFLICT also recreates a slot row if one ever went missing.
CREATE OR REPLACE FUNCTION public.take_sleeper_call_slot(p_limit integer)
RETURNS TABLE (granted boolean, window_calls integer, ms_to_next_window integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_now_ms bigint   := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  v_window bigint   := v_now_ms / 10000;
  v_slot   smallint := (v_window % 6)::smallint;
  v_next   integer  := (10000 - v_now_ms % 10000)::integer;
  v_calls  integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'limit must be 1 to 1000' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.sleeper_call_budget AS b (slot, window_id, calls, updated_at)
  VALUES (v_slot, v_window, 1, clock_timestamp())
  ON CONFLICT (slot) DO UPDATE
    SET calls      = CASE WHEN b.window_id = v_window THEN b.calls + 1 ELSE 1 END,
        window_id  = v_window,
        updated_at = clock_timestamp()
    WHERE b.window_id <> v_window OR b.calls < p_limit
  RETURNING b.calls INTO v_calls;

  IF v_calls IS NOT NULL THEN
    RETURN QUERY SELECT true, v_calls, v_next;
    RETURN;
  END IF;

  -- Full: report the window's count without changing it.
  SELECT b.calls INTO v_calls
  FROM public.sleeper_call_budget b
  WHERE b.slot = v_slot AND b.window_id = v_window;
  RETURN QUERY SELECT false, COALESCE(v_calls, 0), v_next;
END;
$fn$;

COMMENT ON FUNCTION public.take_sleeper_call_slot(integer) IS
  'Counts one Sleeper call in the current 10s window if it holds fewer than p_limit (100 interactive, 60 background). Returns (granted, window_calls, ms_to_next_window).';

-- ── 3. Access: service role only ─────────────────────────────
ALTER TABLE public.sleeper_call_budget ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sleeper_call_budget' AND policyname = 'sleeper_call_budget_service'
  ) THEN
    CREATE POLICY "sleeper_call_budget_service" ON public.sleeper_call_budget
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Explicit grants (Supabase removes implicit default grants, Oct 30 2026). The
-- revokes undo any default privileges the project still hands new objects.
REVOKE ALL ON public.sleeper_call_budget FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sleeper_call_budget TO service_role;

REVOKE EXECUTE ON FUNCTION public.take_sleeper_call_slot(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_sleeper_call_slot(integer) TO service_role;

-- PostgREST picks up the new function.
NOTIFY pgrst, 'reload schema';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('069_sleeper_call_budget', 'sleeper_call_budget ring + take_sleeper_call_slot (global Sleeper call ceiling, call-budget Stage 4)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
