-- ============================================================
-- DynastyZeus — Migration 098
-- Run in the Supabase SQL editor after migration 097. Safe to run before or
-- after the code deploys: until these functions exist, the Big Board's
-- mirrored Pre grades show on the board but aren't saved (logged), and the
-- Realign ranks buttons say the save failed and change nothing.
-- ============================================================
-- Two asks from the user (2026-11-12):
--
-- 1. The pre-draft grade mirrors the Dynasty Score on a curve
--    (−10 → 0, −2.25 → 50, 0 → 75, +2.25 → 95, +4 → 100; lib/scouting/
--    prospectGrade.ts gradeFromDynasty) while the class is still to be
--    drafted. The Big Board writes the grades it computes, many prospects in
--    one call: save_prospect_pre_grades({ "<prospect id>": 87.3, ... }).
--    Like save_prospect_board_scores (068) it doesn't touch updated_at: the
--    grade is derived, not an edit. Returns the rows written.
--
-- 2. Buttons that realign a class's ranks by Dynasty or Dynasty+
--    (lib/scouting/realignRanks.ts), and their Undo, write many prospects'
--    OVR and position ranks in one all-or-nothing call:
--    set_prospect_ranks({ "<prospect id>": { "overall_rank": 3, "personal_rank": 1 }, ... }).
--    A field left out keeps its value; null unranks. A rank that isn't a
--    whole number from 1 (or null) fails the whole call, so nothing is ever
--    half written. Stamps updated_at, like move_prospect_overall_rank (068).
--    Returns the rows written.
--
-- Both are SECURITY INVOKER: they run as the signed-in user, so prospects'
-- owner-only RLS applies, and each also filters on auth.uid(). Keys that
-- aren't one of the caller's prospects are skipped.
--
-- Additive: two new functions, explicit EXECUTE grants (anon and PUBLIC
-- revoked), ledger row. No DROP, DELETE, TRUNCATE or ALTER of anything that
-- exists.
-- ============================================================

-- ── 1. Mirrored pre-draft grades, one call ──────────────────
-- Values that aren't numbers are skipped; numbers are rounded to one decimal
-- and held to the column's 1–100 CHECK (migration 054).
CREATE OR REPLACE FUNCTION public.save_prospect_pre_grades(p_grades jsonb)
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
  IF p_grades IS NULL OR jsonb_typeof(p_grades) <> 'object' THEN
    RAISE EXCEPTION 'expected an object of prospect id to grade' USING ERRCODE = '22023';
  END IF;

  UPDATE public.prospects p
  SET pre_draft_grade = LEAST(100, GREATEST(1, round((s.value #>> '{}')::numeric, 1)))
  FROM jsonb_each(p_grades) AS s(key, value)
  WHERE p.id::text = s.key AND p.user_id = v_user AND jsonb_typeof(s.value) = 'number';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

COMMENT ON FUNCTION public.save_prospect_pre_grades(jsonb) IS
  'Writes many prospects'' pre_draft_grade (the Big Board''s Dynasty mirror) in one call: { prospect id: grade }. Returns the rows written.';

REVOKE EXECUTE ON FUNCTION public.save_prospect_pre_grades(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_prospect_pre_grades(jsonb) TO authenticated, service_role;

-- ── 2. Many ranks, one call ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_prospect_ranks(p_ranks jsonb)
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
  IF p_ranks IS NULL OR jsonb_typeof(p_ranks) <> 'object' THEN
    RAISE EXCEPTION 'expected an object of prospect id to ranks' USING ERRCODE = '22023';
  END IF;

  -- Every value an object; each rank given a whole number from 1, or null.
  -- CASE checks in order, so the cast only sees numbers.
  IF EXISTS (
    SELECT 1
    FROM jsonb_each(p_ranks) AS s(key, value)
    CROSS JOIN (VALUES ('overall_rank'), ('personal_rank')) AS f(name)
    WHERE CASE
      WHEN jsonb_typeof(s.value) <> 'object' THEN true
      WHEN NOT (s.value ? f.name) THEN false
      WHEN jsonb_typeof(s.value -> f.name) = 'null' THEN false
      WHEN jsonb_typeof(s.value -> f.name) <> 'number' THEN true
      ELSE (s.value ->> f.name)::numeric < 1
        OR (s.value ->> f.name)::numeric > 2147483647
        OR (s.value ->> f.name)::numeric % 1 <> 0
    END
  ) THEN
    RAISE EXCEPTION 'each rank must be a whole number from 1, or null' USING ERRCODE = '22023';
  END IF;

  UPDATE public.prospects p
  SET overall_rank  = CASE WHEN s.value ? 'overall_rank'
                           THEN (s.value ->> 'overall_rank')::numeric::integer
                           ELSE p.overall_rank END,
      personal_rank = CASE WHEN s.value ? 'personal_rank'
                           THEN (s.value ->> 'personal_rank')::numeric::integer
                           ELSE p.personal_rank END,
      updated_at    = now()
  FROM jsonb_each(p_ranks) AS s(key, value)
  WHERE p.id::text = s.key AND p.user_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

COMMENT ON FUNCTION public.set_prospect_ranks(jsonb) IS
  'Sets many prospects'' overall_rank / personal_rank in one all-or-nothing call: { prospect id: { overall_rank?, personal_rank? } }. Returns the rows written.';

REVOKE EXECUTE ON FUNCTION public.set_prospect_ranks(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_prospect_ranks(jsonb) TO authenticated, service_role;

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
    VALUES ('098_pre_grade_mirror_rank_realign', 'save_prospect_pre_grades (Pre grade mirrors Dynasty) and set_prospect_ranks (Big Board Realign ranks + Undo)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
