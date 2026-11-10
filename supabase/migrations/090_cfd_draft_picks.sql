-- ============================================================
-- 090: NFL draft results, a shared CollegeFootballData cache (Dynasty+ landing spot)
-- ============================================================
-- Every NFL pick of a draft year (CFD /draft/picks), so Dynasty Score Plus can
-- count rookie competition: the players at his position (and, for a WR, Move
-- TEs) his team drafted ahead of him. The Big Board's Post-Draft tab loads a
-- year through POST /api/scouting/nfl-draft, which also fills each matched
-- prospect's draft_round / draft_pick / draft_team.
--
-- Same shape and access as the other cfd_* caches (migration 065): public
-- data, any signed-in user reads, adds and refreshes; no delete. The year's
-- fetch is recorded in cfd_fetch_log under 'draft:<year>'.
--
-- Purely additive: CREATE TABLE IF NOT EXISTS, policies created only when
-- missing, explicit grants, ledger row. No DROP, DELETE or TRUNCATE.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cfd_draft_picks (
  year        integer     NOT NULL,
  overall     integer     NOT NULL,
  round       integer     NOT NULL,
  pick        integer     NOT NULL,
  nfl_team_id integer,
  nfl_team    text        NOT NULL,  -- nickname, e.g. 'Eagles' (prospects.draft_team's style)
  position    text        NOT NULL,  -- CFD's, e.g. 'Wide Receiver'
  name        text        NOT NULL,
  college     text,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (year, overall)
);

ALTER TABLE public.cfd_draft_picks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cfd_draft_picks' AND policyname = 'cfd_draft_picks_read') THEN
    CREATE POLICY cfd_draft_picks_read ON public.cfd_draft_picks FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cfd_draft_picks' AND policyname = 'cfd_draft_picks_insert') THEN
    CREATE POLICY cfd_draft_picks_insert ON public.cfd_draft_picks FOR INSERT WITH CHECK (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cfd_draft_picks' AND policyname = 'cfd_draft_picks_update') THEN
    CREATE POLICY cfd_draft_picks_update ON public.cfd_draft_picks FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- Explicit grants (Supabase removes implicit default grants on new objects).
-- No anon grant; no DELETE for users.
GRANT SELECT, INSERT, UPDATE ON public.cfd_draft_picks TO authenticated;
GRANT ALL ON public.cfd_draft_picks TO service_role;

COMMENT ON TABLE public.cfd_draft_picks IS
  'Every NFL draft pick per year from CollegeFootballData /draft/picks (shared cache), for Dynasty+ rookie competition (migration 090).';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('090_cfd_draft_picks', 'cfd_draft_picks: every NFL draft pick per year (shared CFD cache) for Dynasty+ rookie competition; loaded from the Big Board Post-Draft tab')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
