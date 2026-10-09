-- ============================================================
-- DynastyZeus — Migration 068
-- Run in the Supabase SQL editor after migration 067, BEFORE the code that
-- uses it deploys: the Big Board's OVR edits call move_prospect_overall_rank.
-- ============================================================
-- Stage 1 of driving the Draft Hub's rookie board from the scouting Big Board.
--
-- 1. prospects.board_scores: each prospect's scores as of the last Big Board
--    visit, for the draft board, which never computes scores itself. Live,
--    without traits, at the Dynasty sliders' weights then
--    (lib/scouting/boardScores.ts):
--
--      { "dynasty": 1.234, "plus": 3.234,          -- null without an AE Score / a round
--        "sample": { "n": 120, "share": 0.667, "tier": "half" },
--        "weights": { "age": 1, "size": 1, "draft": 2 },
--        "saved_at": "2026-10-09T..." }
--
-- 2. rookie_board_tiers.notes: the draft board's player notes, on the same
--    per-user, per-year row as its tiers, so they follow the account instead
--    of one browser's localStorage. { "<key>": "note text" }.
--
-- 3. move_prospect_overall_rank(p_id, p_rank): moves one prospect to an OVR
--    rank and renumbers the rest of his draft class 1..N, in one
--    all-or-nothing call. It replaces one UPDATE per row from the browser,
--    where a failed write could leave a class half-renumbered. Returns the
--    class's ranks after the move.
--
-- 4. save_prospect_board_scores(p_scores): writes many prospects'
--    board_scores in one call. { "<prospect id>": { ...board_scores } }.
--    Returns how many rows it wrote.
--
-- Both functions are SECURITY INVOKER: they run as the signed-in user, so
-- prospects' owner-only RLS applies, and each also filters on auth.uid().
--
-- Purely additive: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- explicit EXECUTE grants (anon and PUBLIC revoked), ledger row. No DROP,
-- DELETE or TRUNCATE. The existing grants and RLS on prospects and
-- rookie_board_tiers cover the new columns.
-- ============================================================

-- ── 1. Saved scores for the draft board ─────────────────────
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS board_scores jsonb;

COMMENT ON COLUMN public.prospects.board_scores IS
  'Dynasty, Dynasty+ and sample dot as of the last Big Board visit (live, no traits, slider weights then), read by the Draft Hub board — lib/scouting/boardScores.ts.';

-- ── 2. Draft board notes ────────────────────────────────────
ALTER TABLE public.rookie_board_tiers ADD COLUMN IF NOT EXISTS notes jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.rookie_board_tiers.notes IS
  'Draft board player notes for the year: { key: text }.';

-- ── 3. OVR move, one call ───────────────────────────────────
-- Ties in a class that is already out of order break by position rank, then
-- name, so the result is always a clean 1..N. A target past the end lands
-- last. Unranked prospects (overall_rank null) stay unranked.
CREATE OR REPLACE FUNCTION public.move_prospect_overall_rank(p_id uuid, p_rank integer)
RETURNS TABLE (prospect_id uuid, new_rank integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_user   uuid := auth.uid();
  v_class  integer;
  v_others integer;
  v_target integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_rank IS NULL OR p_rank < 1 THEN
    RAISE EXCEPTION 'rank must be 1 or more' USING ERRCODE = '22023';
  END IF;

  SELECT p.draft_class_year INTO v_class
  FROM public.prospects p
  WHERE p.id = p_id AND p.user_id = v_user
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'prospect not found' USING ERRCODE = 'P0002';
  END IF;

  -- Lock the class, so two moves in it run one after the other.
  PERFORM 1
  FROM public.prospects p
  WHERE p.user_id = v_user AND p.draft_class_year = v_class
  ORDER BY p.id
  FOR UPDATE;

  SELECT count(*) INTO v_others
  FROM public.prospects p
  WHERE p.user_id = v_user AND p.draft_class_year = v_class
    AND p.overall_rank IS NOT NULL AND p.id <> p_id;
  v_target := LEAST(p_rank, v_others + 1);

  WITH others AS (
    SELECT p.id AS pid,
           row_number() OVER (ORDER BY p.overall_rank, p.personal_rank NULLS LAST, p.name, p.id)::integer AS rn
    FROM public.prospects p
    WHERE p.user_id = v_user AND p.draft_class_year = v_class
      AND p.overall_rank IS NOT NULL AND p.id <> p_id
  ),
  ranks AS (
    SELECT o.pid, CASE WHEN o.rn < v_target THEN o.rn ELSE o.rn + 1 END AS rk FROM others o
    UNION ALL
    SELECT p_id, v_target
  )
  UPDATE public.prospects p
  SET overall_rank = r.rk, updated_at = now()
  FROM ranks r
  WHERE p.id = r.pid AND p.overall_rank IS DISTINCT FROM r.rk;

  RETURN QUERY
  SELECT p.id, p.overall_rank
  FROM public.prospects p
  WHERE p.user_id = v_user AND p.draft_class_year = v_class AND p.overall_rank IS NOT NULL
  ORDER BY p.overall_rank;
END;
$fn$;

COMMENT ON FUNCTION public.move_prospect_overall_rank(uuid, integer) IS
  'Moves one prospect to an OVR rank and renumbers his draft class 1..N in one call; returns the class''s ranks.';

REVOKE EXECUTE ON FUNCTION public.move_prospect_overall_rank(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_prospect_overall_rank(uuid, integer) TO authenticated, service_role;

-- ── 4. Saved scores, one call ───────────────────────────────
-- Keys that aren't one of the caller's prospects, and values that aren't
-- objects, are skipped. Doesn't touch updated_at: these are derived numbers,
-- not an edit.
CREATE OR REPLACE FUNCTION public.save_prospect_board_scores(p_scores jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_user  uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_scores IS NULL OR jsonb_typeof(p_scores) <> 'object' THEN
    RAISE EXCEPTION 'expected an object of prospect id to scores' USING ERRCODE = '22023';
  END IF;

  UPDATE public.prospects p
  SET board_scores = s.value
  FROM jsonb_each(p_scores) AS s(key, value)
  WHERE p.id::text = s.key AND p.user_id = v_user AND jsonb_typeof(s.value) = 'object';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

COMMENT ON FUNCTION public.save_prospect_board_scores(jsonb) IS
  'Writes many prospects'' board_scores in one call: { prospect id: scores }. Returns the rows written.';

REVOKE EXECUTE ON FUNCTION public.save_prospect_board_scores(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_prospect_board_scores(jsonb) TO authenticated, service_role;

-- PostgREST picks up the new functions.
NOTIFY pgrst, 'reload schema';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('068_draft_board_sync', 'prospects.board_scores, rookie_board_tiers.notes, move_prospect_overall_rank and save_prospect_board_scores (draft board sync, Stage 1)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
