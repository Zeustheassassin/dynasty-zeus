-- ============================================================
-- DynastyZeus — Migration 102
-- Run in the Supabase SQL editor after migration 101. The code that uses it
-- can deploy first: until this runs, the Prospect board's Fully Charted reads
-- the older view counts (QB balls thrown, RB runs, TE routes), which sit a few
-- throws off the Big Board for QBs.
-- ============================================================
-- prospect_sample_counts: each QB / RB / TE prospect's plays in his position's
-- headline AE metric, the count the Big Board's sample dot reads
-- (lib/scouting/sampleSize.ts). The Prospect board's Fully Charted uses it too
-- (the user, 2026-11-19: "Use the Big Boards Full Sample Metric to determine if
-- its a full sample for the prospect board"), so the two always agree without
-- loading every raw play. Each filter mirrors lib/scouting/aboveExpected.ts:
--
--   qb_graded_throws  isQBGradedThrow: play_type <> 'run', accuracy set and not 'tipped_ball'
--   rb_known_runs     isKnownRun: one of the four run schemes, success set
--   te_rated_routes   isRatedTERoute: play_type = 'route_run', was_open set
--
-- WR needs nothing here: his count is his SAE sample's, already on the prospect.
-- security_invoker, so the owner-only RLS on prospects / scouting_games / the
-- play tables applies, like the other prospect_*_stats views.
--
-- Purely additive: CREATE OR REPLACE VIEW (new), GRANT, ledger row. No DROP,
-- DELETE or TRUNCATE.
-- ============================================================

CREATE OR REPLACE VIEW public.prospect_sample_counts
WITH (security_invoker = on) AS
WITH
  qb AS (
    SELECT sg.prospect_id, COUNT(*)::int AS n
    FROM public.scouting_games sg
    JOIN public.qb_plays qp ON qp.game_id = sg.id
    WHERE qp.play_type <> 'run'
      AND qp.accuracy IS NOT NULL
      AND qp.accuracy <> 'tipped_ball'
    GROUP BY sg.prospect_id
  ),
  rb AS (
    SELECT sg.prospect_id, COUNT(*)::int AS n
    FROM public.scouting_games sg
    JOIN public.rb_plays rp ON rp.game_id = sg.id
    WHERE rp.run_type IN ('outside_zone', 'inside_zone', 'outside_man_gap', 'inside_man_gap')
      AND rp.success IS NOT NULL
    GROUP BY sg.prospect_id
  ),
  te AS (
    SELECT sg.prospect_id, COUNT(*)::int AS n
    FROM public.scouting_games sg
    JOIN public.te_plays tp ON tp.game_id = sg.id
    WHERE tp.play_type = 'route_run'
      AND tp.was_open IS NOT NULL
    GROUP BY sg.prospect_id
  )
SELECT
  p.id                AS prospect_id,
  COALESCE(qb.n, 0)   AS qb_graded_throws,
  COALESCE(rb.n, 0)   AS rb_known_runs,
  COALESCE(te.n, 0)   AS te_rated_routes
FROM public.prospects p
LEFT JOIN qb ON qb.prospect_id = p.id
LEFT JOIN rb ON rb.prospect_id = p.id
LEFT JOIN te ON te.prospect_id = p.id
WHERE qb.n IS NOT NULL OR rb.n IS NOT NULL OR te.n IS NOT NULL;

GRANT SELECT ON public.prospect_sample_counts TO authenticated;

COMMENT ON VIEW public.prospect_sample_counts IS
  'Each QB / RB / TE prospect''s plays in his headline AE metric (graded throws, known runs, rated TE routes): the Big Board sample dot and the Prospect board Fully Charted (migration 102).';

-- PostgREST picks up the new view.
NOTIFY pgrst, 'reload schema';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('102_prospect_sample_counts', 'prospect_sample_counts view: QB graded throws, RB known runs, TE rated routes (Fully Charted = Big Board full sample)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
