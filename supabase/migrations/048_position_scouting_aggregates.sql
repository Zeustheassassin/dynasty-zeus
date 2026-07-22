-- ============================================================
-- Migration 048 — QB/RB/TE full-career scouting aggregates
-- ============================================================
-- Extends prospect_qb_stats / prospect_rb_stats / prospect_te_stats
-- (stubs since 020, extended once already in 028) with jsonb success-rate
-- breakdowns, mirroring the pattern WR's prospect_route_stats.coverage_stats_raw
-- already uses. CREATE OR REPLACE VIEW — non-destructive, existing columns
-- (total_snaps/total_games/total_throws/total_routes) are unchanged.
--
-- Follows 020's CTE style: every aggregate (base counts + jsonb breakdown)
-- is pre-grouped to one row per prospect_id in its own CTE, then the final
-- SELECT is a plain LEFT JOIN with no GROUP BY of its own.
--
-- QB depth_zone_stats_raw: keyed "short"/"mid"/"deep" (bucketed from the
-- 9-zone depth_zone column via split_part). Population mirrors
-- QBChartingBoard.tsx's headerStats "thrownPlays" definition: play_type
-- <> 'run' and timing NOT IN ('scramble','sack','throw_away'). onTarget
-- counts accuracy = 'on_target' within that same population.
--
-- RB run_type_stats_raw: keyed by the 4 raw run_type values that represent
-- actual run-scheme attempts (outside_zone/inside_zone/outside_man_gap/
-- inside_man_gap). success counts run_type rows where success = true.
--
-- TE coverage_stats_raw: same shape as WR's (man/zone/press/double →
-- count/open/catches), sourced from te_plays where play_type = 'route_run'.
-- TE block_stats_raw: keyed inline/movement (count/success), sourced from
-- te_plays where play_type IN ('run_block','pass_block').

CREATE OR REPLACE VIEW prospect_qb_stats
WITH (security_invoker = on) AS
WITH
  base_agg AS (
    SELECT
      sg.prospect_id,
      COUNT(qp.id)::int AS total_snaps,
      COUNT(DISTINCT sg.id)::int AS total_games,
      COUNT(qp.id) FILTER (
        WHERE qp.play_type IN ('rpo', 'pass')
          AND qp.timing IN ('first_option', 'second_option', 'checkdown')
      )::int AS total_throws
    FROM scouting_games sg
    LEFT JOIN qb_plays qp ON qp.game_id = sg.id
    GROUP BY sg.prospect_id
  ),
  thrown AS (
    SELECT sg.prospect_id, qp.depth_zone, qp.accuracy
    FROM scouting_games sg
    JOIN qb_plays qp ON qp.game_id = sg.id
    WHERE qp.play_type <> 'run'
      AND (qp.timing IS NULL OR qp.timing NOT IN ('scramble', 'sack', 'throw_away'))
      AND qp.depth_zone IS NOT NULL
  ),
  depth_zone_agg AS (
    SELECT
      prospect_id,
      split_part(depth_zone, '_', 1) AS zone,
      COUNT(*)::int                                       AS cnt,
      COUNT(*) FILTER (WHERE accuracy = 'on_target')::int AS on_target_cnt
    FROM thrown
    GROUP BY prospect_id, split_part(depth_zone, '_', 1)
  ),
  depth_zone_jsonb AS (
    SELECT
      prospect_id,
      jsonb_object_agg(zone, jsonb_build_object('count', cnt, 'onTarget', on_target_cnt)) AS depth_zone_stats_raw
    FROM depth_zone_agg
    GROUP BY prospect_id
  )
SELECT
  ba.prospect_id,
  ba.total_snaps,
  ba.total_games,
  ba.total_throws,
  COALESCE(dz.depth_zone_stats_raw, '{}'::jsonb) AS depth_zone_stats_raw
FROM base_agg ba
LEFT JOIN depth_zone_jsonb dz ON dz.prospect_id = ba.prospect_id;

GRANT SELECT ON prospect_qb_stats TO authenticated;

CREATE OR REPLACE VIEW prospect_rb_stats
WITH (security_invoker = on) AS
WITH
  base_agg AS (
    SELECT
      sg.prospect_id,
      COUNT(rp.id)::int AS total_snaps,
      COUNT(DISTINCT sg.id)::int AS total_games
    FROM scouting_games sg
    LEFT JOIN rb_plays rp ON rp.game_id = sg.id
    GROUP BY sg.prospect_id
  ),
  run_type_agg AS (
    SELECT
      sg.prospect_id,
      rp.run_type,
      COUNT(*)::int                                   AS cnt,
      COUNT(*) FILTER (WHERE rp.success = true)::int   AS success_cnt
    FROM scouting_games sg
    JOIN rb_plays rp ON rp.game_id = sg.id
    WHERE rp.run_type IN ('outside_zone', 'inside_zone', 'outside_man_gap', 'inside_man_gap')
    GROUP BY sg.prospect_id, rp.run_type
  ),
  run_type_jsonb AS (
    SELECT
      prospect_id,
      jsonb_object_agg(run_type, jsonb_build_object('count', cnt, 'success', success_cnt)) AS run_type_stats_raw
    FROM run_type_agg
    GROUP BY prospect_id
  )
SELECT
  ba.prospect_id,
  ba.total_snaps,
  ba.total_games,
  COALESCE(rt.run_type_stats_raw, '{}'::jsonb) AS run_type_stats_raw
FROM base_agg ba
LEFT JOIN run_type_jsonb rt ON rt.prospect_id = ba.prospect_id;

GRANT SELECT ON prospect_rb_stats TO authenticated;

CREATE OR REPLACE VIEW prospect_te_stats
WITH (security_invoker = on) AS
WITH
  base_agg AS (
    SELECT
      sg.prospect_id,
      COUNT(tp.id)::int AS total_snaps,
      COUNT(DISTINCT sg.id)::int AS total_games,
      COUNT(tp.id) FILTER (WHERE tp.play_type = 'route_run')::int AS total_routes
    FROM scouting_games sg
    LEFT JOIN te_plays tp ON tp.game_id = sg.id
    GROUP BY sg.prospect_id
  ),
  coverage_agg AS (
    SELECT
      sg.prospect_id,
      tp.coverage,
      COUNT(*)::int                                                     AS cnt,
      COUNT(*) FILTER (WHERE tp.was_open)::int                          AS open_cnt,
      COUNT(*) FILTER (WHERE tp.targeted AND tp.caught = true)::int     AS ctch_cnt
    FROM scouting_games sg
    JOIN te_plays tp ON tp.game_id = sg.id
    WHERE tp.play_type = 'route_run'
      AND tp.coverage IN ('man', 'zone', 'press', 'double')
    GROUP BY sg.prospect_id, tp.coverage
  ),
  coverage_jsonb AS (
    SELECT
      prospect_id,
      jsonb_object_agg(coverage, jsonb_build_object('count', cnt, 'open', open_cnt, 'catches', ctch_cnt)) AS coverage_stats_raw
    FROM coverage_agg
    GROUP BY prospect_id
  ),
  block_agg AS (
    SELECT
      sg.prospect_id,
      tp.block_type,
      COUNT(*)::int                                       AS cnt,
      COUNT(*) FILTER (WHERE tp.block_success = true)::int AS success_cnt
    FROM scouting_games sg
    JOIN te_plays tp ON tp.game_id = sg.id
    WHERE tp.play_type IN ('run_block', 'pass_block')
      AND tp.block_type IS NOT NULL
    GROUP BY sg.prospect_id, tp.block_type
  ),
  block_jsonb AS (
    SELECT
      prospect_id,
      jsonb_object_agg(block_type, jsonb_build_object('count', cnt, 'success', success_cnt)) AS block_stats_raw
    FROM block_agg
    GROUP BY prospect_id
  )
SELECT
  ba.prospect_id,
  ba.total_snaps,
  ba.total_games,
  ba.total_routes,
  COALESCE(cv.coverage_stats_raw, '{}'::jsonb) AS coverage_stats_raw,
  COALESCE(bl.block_stats_raw, '{}'::jsonb)    AS block_stats_raw
FROM base_agg ba
LEFT JOIN coverage_jsonb cv ON cv.prospect_id = ba.prospect_id
LEFT JOIN block_jsonb bl    ON bl.prospect_id = ba.prospect_id;

GRANT SELECT ON prospect_te_stats TO authenticated;
