-- ============================================================
-- DynastyZeus — Migration 057
-- Run in the Supabase SQL editor after migration 056.
-- ============================================================
-- Adds prospect_route_cells: per prospect, how many routes he ran
-- (and how many were open) in each combination of the four charted
-- route situations — route type × coverage × alignment × on/off
-- the line. One row per prospect, cells packed into a jsonb object:
--
--   { "curl|man|left|on": [n, open_n], "nine|press|right|off": [...], ... }
--
-- WR SAE / cSAE now judge each route against routes like it: a
-- league difficulty model (lib/scouting/difficultyModel.ts) fit on
-- these cells stacks every situation's effect, so a go route vs
-- press counts as the hard rep it is. That needs the situations
-- crossed with each other; prospect_route_stats and
-- league_route_baselines (020) only carry each one on its own. The
-- league model is the sum of every prospect's cells — no separate
-- league view needed.
--
-- Until this is applied the app shows "—" for WR SAE / cSAE (the
-- fetch fails and the model has no data); everything else is
-- unaffected. league_route_baselines is no longer read by the app
-- but is left in place (no DROP).
--
-- route_type / coverage / alignment / on_line / was_open are all
-- NOT NULL on route_plays; coverage can be '' (uncharted), which
-- the client reads as "no coverage tag".
--
-- Purely additive — CREATE OR REPLACE VIEW, no DROP/ALTER...DROP/
-- DELETE/TRUNCATE. security_invoker = on, so route_plays' and
-- scouting_games' RLS (owner-only) applies exactly as it does for
-- the 020 views; SELECT granted to authenticated like them.
-- ============================================================

CREATE OR REPLACE VIEW prospect_route_cells
WITH (security_invoker = on) AS
WITH
  tagged AS (
    SELECT
      sg.prospect_id,
      rp.route_type || '|' || rp.coverage || '|' || rp.alignment || '|' ||
        CASE WHEN rp.on_line THEN 'on' ELSE 'off' END AS cell,
      rp.was_open
    FROM scouting_games sg
    JOIN route_plays rp ON rp.game_id = sg.id
    WHERE rp.no_route_run = false
  ),
  cell_counts AS (
    SELECT
      prospect_id,
      cell,
      COUNT(*)::int                         AS n,
      COUNT(*) FILTER (WHERE was_open)::int AS open_n
    FROM tagged
    GROUP BY prospect_id, cell
  )
SELECT
  prospect_id,
  jsonb_object_agg(cell, jsonb_build_array(n, open_n)) AS cells
FROM cell_counts
GROUP BY prospect_id;

GRANT SELECT ON prospect_route_cells TO authenticated;

COMMENT ON VIEW prospect_route_cells IS
  'Per-prospect route counts (n, open_n) by route_type|coverage|alignment|on_line cell — feeds the WR SAE difficulty model.';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('057_prospect_route_cells', 'Adds prospect_route_cells (route x coverage x alignment x on_line counts per prospect) for the WR SAE difficulty model')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
