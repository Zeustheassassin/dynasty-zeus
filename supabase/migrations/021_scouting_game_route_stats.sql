-- ============================================================
-- Migration 021 — Scouting Hub per-game route aggregates (Perf Plan Phase 2)
-- ============================================================
-- GamesLog renders one row per scouting_game and shows per-game
-- routes / targets / catches / man-open% / zone-open%. Before this view,
-- ScoutingHub.loadAll paginated raw route_plays for ALL games to compute
-- those columns client-side. This view returns one row per game so the
-- client can fetch a small fixed-size payload instead of every play.
--
-- Mirrors the JS branch in components/scouting/GamesLog.tsx:
--   - routes  = COUNT route_plays where no_route_run = false (charted route runs)
--   - targets = summary_targets when set, else COUNT(targeted) over route runs
--   - catches = summary_catches when set, else COUNT(targeted AND success) over route runs
--   - man_open_pct  = was_open rate among coverage='man'  route runs (NULL if no man  plays)
--   - zone_open_pct = was_open rate among coverage='zone' route runs (NULL if no zone plays)
--
-- Idempotency: indexes from migration 020 are sufficient — this view
-- only adds a SELECT, no new index needed. Plain view (not materialized)
-- to match the rest of the Phase 1 work.

CREATE VIEW prospect_game_route_stats
WITH (security_invoker = on) AS
WITH
  per_game AS (
    SELECT
      sg.id           AS game_id,
      sg.prospect_id,
      sg.summary_targets,
      sg.summary_catches,
      COUNT(rp.id) FILTER (WHERE rp.no_route_run = false)::int                              AS routes,
      COUNT(rp.id) FILTER (WHERE rp.no_route_run = false AND rp.targeted)::int              AS computed_targets,
      COUNT(rp.id) FILTER (WHERE rp.no_route_run = false AND rp.targeted AND rp.success)::int
                                                                                            AS computed_catches,
      COUNT(rp.id) FILTER (WHERE rp.no_route_run = false AND rp.coverage = 'man')::int      AS man_n,
      COUNT(rp.id) FILTER (WHERE rp.no_route_run = false AND rp.coverage = 'man'  AND rp.was_open)::int
                                                                                            AS man_open_n,
      COUNT(rp.id) FILTER (WHERE rp.no_route_run = false AND rp.coverage = 'zone')::int     AS zone_n,
      COUNT(rp.id) FILTER (WHERE rp.no_route_run = false AND rp.coverage = 'zone' AND rp.was_open)::int
                                                                                            AS zone_open_n
    FROM scouting_games sg
    LEFT JOIN route_plays rp ON rp.game_id = sg.id
    GROUP BY sg.id, sg.prospect_id, sg.summary_targets, sg.summary_catches
  )
SELECT
  game_id,
  prospect_id,
  routes,
  COALESCE(summary_targets, computed_targets) AS targets,
  COALESCE(summary_catches, computed_catches) AS catches,
  CASE WHEN man_n  > 0 THEN ROUND(100.0 * man_open_n  / man_n)::int  END AS man_open_pct,
  CASE WHEN zone_n > 0 THEN ROUND(100.0 * zone_open_n / zone_n)::int END AS zone_open_pct
FROM per_game;

GRANT SELECT ON prospect_game_route_stats TO authenticated;

-- After running: NOTIFY pgrst, 'reload schema';
