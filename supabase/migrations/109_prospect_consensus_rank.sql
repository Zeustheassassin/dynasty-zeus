-- ============================================================
-- DynastyZeus — Migration 109
-- Run in the Supabase SQL editor after migration 108. The code that uses it
-- can deploy first: until this runs, the Big Board's Consensus board panel
-- reads and reviews a CSV but can't save it (the message names this
-- migration), and Dynasty+ stays blank until a round is set, as today.
-- ============================================================
-- Consensus rank (stage 6 of the 2026-11-26 scouting plan): the user uploads
-- a consensus big board CSV for one draft class (rank, name, position,
-- college; the same source as the 2026-11-05 file), and each matched QB / RB
-- / WR / TE keeps his rank on it. Before his real pick is applied, Dynasty+
-- reads that rank as a projected pick: draft capital averaged over the picks
-- within 25% of it (lib/scouting/dynastyScore.ts projectedCapital). Capital
-- only: no team, role, depth or offense.
--
--   consensus_rank   his rank on the last upload for his class; null = not
--                    on it (or never checked)
--   consensus_class  the draft class that upload was for, so a prospect
--                    moved to another class stops reading it
--   consensus_at     when that upload was saved; with a null rank it means
--                    "checked, not on the consensus board"
--
-- save_prospect_consensus(p_class, p_ranks) replaces one class's consensus in
-- one all-or-nothing call: every QB / RB / WR / TE of the user's in that
-- class gets the rank in p_ranks ({ prospect id: rank }) or null, and the
-- class and time of the upload. An id that isn't the user's skill prospect
-- in that class fails the whole call. SECURITY INVOKER, so the existing
-- owner-only RLS on prospects applies; updated_at is left alone (like the
-- board scores, it's imported data, not an edit).
--
-- Purely additive: ADD COLUMN IF NOT EXISTS (nullable, no default), CHECKs
-- added only when missing, CREATE OR REPLACE FUNCTION, ledger row. The
-- existing grants and RLS on prospects cover the new columns. No DROP,
-- DELETE or TRUNCATE.
-- ============================================================

ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS consensus_rank integer;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS consensus_class integer;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS consensus_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prospects_consensus_rank_range'
      AND conrelid = 'public.prospects'::regclass
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_consensus_rank_range
      CHECK (consensus_rank IS NULL OR consensus_rank BETWEEN 1 AND 5000);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prospects_consensus_class_range'
      AND conrelid = 'public.prospects'::regclass
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_consensus_class_range
      CHECK (consensus_class IS NULL OR consensus_class BETWEEN 2000 AND 2100);
  END IF;
  -- An upload sets the class and the time together; a rank only comes with them.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prospects_consensus_upload_whole'
      AND conrelid = 'public.prospects'::regclass
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_consensus_upload_whole
      CHECK ((consensus_class IS NULL) = (consensus_at IS NULL)
        AND (consensus_rank IS NULL OR consensus_class IS NOT NULL));
  END IF;
END $$;

COMMENT ON COLUMN public.prospects.consensus_rank IS
  'His rank on the last consensus big board uploaded for consensus_class (migration 109); Dynasty+ reads it as a projected pick until his real one is set. Null = not on it.';
COMMENT ON COLUMN public.prospects.consensus_class IS
  'The draft class the consensus upload behind consensus_rank was for (migration 109); a prospect in another class ignores it.';
COMMENT ON COLUMN public.prospects.consensus_at IS
  'When that consensus upload was saved (migration 109); with a null rank, "checked: not on the consensus board".';

CREATE OR REPLACE FUNCTION public.save_prospect_consensus(p_class integer, p_ranks jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_user  uuid := auth.uid();
  v_keys  integer;
  v_found integer;
  v_count integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_class IS NULL OR p_class < 2000 OR p_class > 2100 THEN
    RAISE EXCEPTION 'expected a draft class year' USING ERRCODE = '22023';
  END IF;
  IF p_ranks IS NULL OR jsonb_typeof(p_ranks) <> 'object' THEN
    RAISE EXCEPTION 'expected an object of prospect id to consensus rank' USING ERRCODE = '22023';
  END IF;

  -- Each rank a whole number from 1 to 5000. CASE checks in order, so the cast only sees numbers.
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_ranks) AS s(key, value)
    WHERE CASE
      WHEN jsonb_typeof(s.value) <> 'number' THEN true
      ELSE (s.value #>> '{}')::numeric < 1
        OR (s.value #>> '{}')::numeric > 5000
        OR (s.value #>> '{}')::numeric % 1 <> 0
    END
  ) THEN
    RAISE EXCEPTION 'each consensus rank must be a whole number from 1 to 5000' USING ERRCODE = '22023';
  END IF;

  -- Every ranked id must be the user's QB / RB / WR / TE in this class.
  SELECT count(*) INTO v_keys FROM jsonb_object_keys(p_ranks);
  SELECT count(*) INTO v_found
  FROM public.prospects p
  WHERE p.user_id = v_user AND p.draft_class_year = p_class
    AND p.position IN ('QB', 'RB', 'WR', 'TE')
    AND p_ranks ? p.id::text;
  IF v_found <> v_keys THEN
    RAISE EXCEPTION 'a ranked prospect is not one of your % QB / RB / WR / TE prospects', p_class USING ERRCODE = '22023';
  END IF;

  UPDATE public.prospects p
  SET consensus_rank  = CASE WHEN p_ranks ? p.id::text
                             THEN (p_ranks ->> p.id::text)::numeric::integer
                             ELSE NULL END,
      consensus_class = p_class,
      consensus_at    = now()
  WHERE p.user_id = v_user AND p.draft_class_year = p_class
    AND p.position IN ('QB', 'RB', 'WR', 'TE');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

COMMENT ON FUNCTION public.save_prospect_consensus(integer, jsonb) IS
  'Replaces one class''s consensus big board ranks in one all-or-nothing call (migration 109): every QB / RB / WR / TE in p_class gets its rank from p_ranks ({ prospect id: rank }) or null, with the class and now(). Returns the rows written.';

REVOKE EXECUTE ON FUNCTION public.save_prospect_consensus(integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_prospect_consensus(integer, jsonb) TO authenticated, service_role;

-- PostgREST picks up the new columns and the function.
NOTIFY pgrst, 'reload schema';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('109_prospect_consensus_rank', 'prospects.consensus_rank / consensus_class / consensus_at + save_prospect_consensus: the consensus big board as a projected pick for Dynasty+')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
