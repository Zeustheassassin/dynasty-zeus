-- ============================================================
-- DynastyZeus — Migration 058
-- Run in the Supabase SQL editor after migration 057.
-- ============================================================
-- Adds prospect_game_route_cells: the same route-situation cells as
-- prospect_route_cells (057), split by game. One row per (prospect, game):
--
--   { "curl|man|left|on": [n, open_n], "nine|press|right|off": [...], ... }
--
-- The Big Board's AE Score adjusts WR SAE / cSAE for opponent strength (the
-- opponent's P4 / G5 / FCS tier in each game, read from scouting_games.opponent
-- by lib/scouting/opponentTier.ts). That needs each route tied to its game;
-- 057 sums a prospect's games together. Only the Big Board fetches this view,
-- when it opens. Until it's applied, the WR AE Score just isn't
-- opponent-adjusted; nothing else changes.
--
-- Purely additive — CREATE OR REPLACE VIEW, no DROP/ALTER...DROP/
-- DELETE/TRUNCATE. security_invoker = on, so route_plays' and
-- scouting_games' RLS (owner-only) applies exactly as it does for 057;
-- SELECT granted to authenticated like it.
-- ============================================================

CREATE OR REPLACE VIEW prospect_game_route_cells
WITH (security_invoker = on) AS
WITH
  tagged AS (
    SELECT
      sg.prospect_id,
      sg.id AS game_id,
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
      game_id,
      cell,
      COUNT(*)::int                         AS n,
      COUNT(*) FILTER (WHERE was_open)::int AS open_n
    FROM tagged
    GROUP BY prospect_id, game_id, cell
  )
SELECT
  prospect_id,
  game_id,
  jsonb_object_agg(cell, jsonb_build_array(n, open_n)) AS cells
FROM cell_counts
GROUP BY prospect_id, game_id;

GRANT SELECT ON prospect_game_route_cells TO authenticated;

COMMENT ON VIEW prospect_game_route_cells IS
  'Per-prospect, per-game route counts (n, open_n) by route_type|coverage|alignment|on_line cell — feeds the opponent-strength adjustment to the WR AE Score.';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('058_prospect_game_route_cells', 'Adds prospect_game_route_cells (057''s route cells split by game) for the opponent-strength adjustment to the WR AE Score')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
