-- ============================================================
-- Migration 020 — Scouting Hub aggregate views (Perf Plan Phase 1 + 3)
-- ============================================================
-- Replaces the client-side per-snap reduce in ScoutingHub.prospectsWithStats
-- with server-side aggregate views. The client merges view rows with
-- `prospects` and computes adj_success_above_exp from league_route_baselines.
--
-- Plain views (not materialized) — switch to materialized views in Phase 4
-- only if production query latency exceeds ~200ms.
--
-- Indexes (Phase 3): all *_plays(game_id) and scouting_games(prospect_id)
-- indexes already exist from earlier migrations (007, 008, 009, 010). They
-- are re-asserted with IF NOT EXISTS for idempotency. Charting boards filter
-- plays by `game_id IN (prospect_game_ids)`, so no prospect_id column is
-- needed on the *_plays tables.

-- ── Phase 3: indexes (idempotent, already exist) ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_route_plays_game_id        ON route_plays(game_id);
CREATE INDEX IF NOT EXISTS idx_rb_plays_game_id           ON rb_plays(game_id);
CREATE INDEX IF NOT EXISTS idx_qb_plays_game_id           ON qb_plays(game_id);
CREATE INDEX IF NOT EXISTS idx_te_plays_game_id           ON te_plays(game_id);
CREATE INDEX IF NOT EXISTS idx_scouting_games_prospect_id ON scouting_games(prospect_id);

-- ── Phase 1: league_route_baselines ───────────────────────────────────────
-- Long-format: one row per ('route', route_type) and one per ('coverage', cvg).
-- Used by the client to compute per-prospect adj_success_above_exp (SAE).

CREATE VIEW league_route_baselines
WITH (security_invoker = on) AS
SELECT
  'route'::text                            AS kind,
  route_type                               AS key,
  COUNT(*)::int                            AS n,
  COUNT(*) FILTER (WHERE was_open)::int    AS open_n
FROM route_plays
WHERE no_route_run = false
GROUP BY route_type
UNION ALL
SELECT
  'coverage'::text                         AS kind,
  coverage                                 AS key,
  COUNT(*)::int                            AS n,
  COUNT(*) FILTER (WHERE was_open)::int    AS open_n
FROM route_plays
WHERE no_route_run = false
  AND coverage IN ('man','zone','double','press')
GROUP BY coverage;

GRANT SELECT ON league_route_baselines TO authenticated;

-- ── Phase 1: prospect_route_stats ─────────────────────────────────────────
-- One row per prospect that has at least one scouting_games row. Mirrors
-- ScoutingHub.prospectsWithStats field-for-field for route_plays-derived
-- fields. Two values (route_stats, coverage_stats) are returned as raw
-- jsonb without the has_charted_open_data gating; the client merge applies
-- the gating (open=0/catches=-1 when has_charted_open_data is false) so the
-- view stays a pure projection of the underlying data.
--
-- adj_success_above_exp is computed in the client merge from this view's
-- route_type_counts/coverage_counts + league_route_baselines.

CREATE VIEW prospect_route_stats
WITH (security_invoker = on) AS
WITH
  per_game AS (
    -- Per-game stats with summary fallback. When summary_targets IS NULL we
    -- count from this game's route_plays; otherwise we use the summary_*
    -- columns. Mirrors the JS branch on `g.summary_targets != null`.
    SELECT
      sg.id          AS game_id,
      sg.prospect_id,
      CASE WHEN sg.summary_targets IS NOT NULL THEN sg.summary_targets
           ELSE COUNT(rp.id) FILTER (WHERE rp.no_route_run = false AND rp.targeted)::int
      END AS tgt,
      CASE WHEN sg.summary_targets IS NOT NULL THEN COALESCE(sg.summary_catches, 0)
           ELSE COUNT(rp.id) FILTER (WHERE rp.no_route_run = false AND rp.targeted AND rp.success = true)::int
      END AS ctch,
      CASE WHEN sg.summary_targets IS NOT NULL THEN COALESCE(sg.summary_drops, 0)
           ELSE COUNT(rp.id) FILTER (WHERE rp.no_route_run = false AND rp.targeted AND rp.success = false)::int
      END AS drops,
      CASE WHEN sg.summary_targets IS NOT NULL THEN COALESCE(sg.summary_contested, 0)
           ELSE COUNT(rp.id) FILTER (WHERE rp.no_route_run = false AND rp.contested)::int
      END AS contested,
      CASE WHEN sg.summary_targets IS NOT NULL THEN COALESCE(sg.summary_contested_catches, 0)
           ELSE COUNT(rp.id) FILTER (WHERE rp.no_route_run = false AND rp.contested AND rp.success = true)::int
      END AS contested_catches
    FROM scouting_games sg
    LEFT JOIN route_plays rp ON rp.game_id = sg.id
    GROUP BY sg.id, sg.prospect_id, sg.summary_targets, sg.summary_catches,
             sg.summary_drops, sg.summary_contested, sg.summary_contested_catches
  ),
  summary_agg AS (
    SELECT
      prospect_id,
      SUM(tgt)::int             AS targets,
      SUM(ctch)::int            AS catches,
      SUM(drops)::int           AS drops,
      SUM(contested)::int       AS contested,
      SUM(contested_catches)::int AS contested_catches,
      COUNT(*)::int             AS total_games
    FROM per_game
    GROUP BY prospect_id
  ),
  play_agg AS (
    -- Per-prospect aggregates from raw plays. LEFT JOIN so prospects with
    -- games but zero logged plays still appear with zeroed counts.
    SELECT
      sg.prospect_id,
      COUNT(rp.id)::int                                                          AS total_snaps,
      COUNT(rp.id) FILTER (WHERE NOT rp.no_route_run)::int                       AS total_routes,
      COALESCE(SUM(rp.yards) FILTER (WHERE NOT rp.no_route_run), 0)::int         AS total_yards,
      COUNT(rp.id) FILTER (WHERE rp.alignment = 'left')::int                     AS n_left,
      COUNT(rp.id) FILTER (WHERE rp.alignment = 'right')::int                    AS n_right,
      COUNT(rp.id) FILTER (WHERE rp.alignment = 'slot')::int                     AS n_slot,
      COUNT(rp.id) FILTER (WHERE rp.alignment = 'backfield')::int                AS n_backfield,
      COUNT(rp.id) FILTER (WHERE rp.on_line)::int                                AS n_on_line,
      COUNT(rp.id) FILTER (WHERE NOT rp.no_route_run AND rp.was_open)::int       AS open_routes,
      COUNT(rp.id) FILTER (WHERE NOT rp.no_route_run AND NOT rp.on_line)::int    AS depth_behind_los,
      COUNT(rp.id) FILTER (WHERE NOT rp.no_route_run AND rp.on_line)::int        AS depth_on_los,
      -- has_charted_open_data: any route_run with was_open OR any with targeted+success known
      COALESCE(BOOL_OR(NOT rp.no_route_run AND rp.was_open), false)
        OR COALESCE(BOOL_OR(NOT rp.no_route_run AND rp.targeted AND rp.success IS NOT NULL), false)
        AS has_charted_open_data
    FROM scouting_games sg
    LEFT JOIN route_plays rp ON rp.game_id = sg.id
    GROUP BY sg.prospect_id
  ),
  route_type_agg AS (
    SELECT
      sg.prospect_id,
      rp.route_type,
      COUNT(*)::int                                                  AS cnt,
      COUNT(*) FILTER (WHERE rp.was_open)::int                       AS open_cnt,
      COUNT(*) FILTER (WHERE rp.targeted)::int                       AS tgt_cnt,
      COUNT(*) FILTER (WHERE rp.targeted AND rp.success = true)::int AS ctch_cnt
    FROM scouting_games sg
    JOIN route_plays rp ON rp.game_id = sg.id
    WHERE rp.no_route_run = false
    GROUP BY sg.prospect_id, rp.route_type
  ),
  route_stats_jsonb AS (
    SELECT
      prospect_id,
      jsonb_object_agg(
        route_type,
        jsonb_build_object('count', cnt, 'open', open_cnt, 'targets', tgt_cnt, 'catches', ctch_cnt)
      ) AS route_stats_raw,
      jsonb_object_agg(route_type, cnt) AS route_type_counts
    FROM route_type_agg
    GROUP BY prospect_id
  ),
  coverage_agg AS (
    SELECT
      sg.prospect_id,
      rp.coverage,
      COUNT(*)::int                                                  AS cnt,
      COUNT(*) FILTER (WHERE rp.was_open)::int                       AS open_cnt,
      COUNT(*) FILTER (WHERE rp.targeted AND rp.success = true)::int AS ctch_cnt
    FROM scouting_games sg
    JOIN route_plays rp ON rp.game_id = sg.id
    WHERE rp.no_route_run = false
      AND rp.coverage IN ('man','zone','double','press')
    GROUP BY sg.prospect_id, rp.coverage
  ),
  coverage_jsonb AS (
    SELECT
      prospect_id,
      jsonb_object_agg(
        coverage,
        jsonb_build_object('count', cnt, 'open', open_cnt, 'catches', ctch_cnt)
      ) AS coverage_stats_raw,
      jsonb_object_agg(coverage, cnt) AS coverage_counts
    FROM coverage_agg
    GROUP BY prospect_id
  ),
  align_charted AS (
    -- Charted route runs only (games where summary_targets IS NULL).
    -- Used for align_n_* counts and open_pct_* splits.
    SELECT
      sg.prospect_id,
      rp.alignment,
      rp.on_line,
      rp.was_open
    FROM scouting_games sg
    JOIN route_plays rp ON rp.game_id = sg.id
    WHERE sg.summary_targets IS NULL
      AND rp.no_route_run = false
  ),
  align_agg AS (
    SELECT
      prospect_id,
      COUNT(*) FILTER (WHERE alignment = 'slot')::int                          AS align_n_slot,
      COUNT(*) FILTER (WHERE alignment = 'slot' AND on_line)::int              AS align_n_slot_on_line,
      COUNT(*) FILTER (WHERE alignment = 'slot' AND NOT on_line)::int          AS align_n_slot_off_line,
      COUNT(*) FILTER (WHERE alignment = 'right')::int                         AS align_n_right,
      COUNT(*) FILTER (WHERE alignment = 'right' AND on_line)::int             AS align_n_right_on_line,
      COUNT(*) FILTER (WHERE alignment = 'right' AND NOT on_line)::int         AS align_n_right_off_line,
      COUNT(*) FILTER (WHERE alignment = 'left')::int                          AS align_n_left,
      COUNT(*) FILTER (WHERE alignment = 'left' AND on_line)::int              AS align_n_left_on_line,
      COUNT(*) FILTER (WHERE alignment = 'left' AND NOT on_line)::int          AS align_n_left_off_line,
      COUNT(*) FILTER (WHERE alignment = 'backfield')::int                     AS align_n_backfield,
      CASE WHEN COUNT(*) FILTER (WHERE alignment = 'slot') > 0
        THEN ROUND(100.0 * COUNT(*) FILTER (WHERE alignment = 'slot' AND was_open)
                       / COUNT(*) FILTER (WHERE alignment = 'slot'), 1)
      END AS open_pct_slot,
      CASE WHEN COUNT(*) FILTER (WHERE alignment = 'slot' AND on_line) > 0
        THEN ROUND(100.0 * COUNT(*) FILTER (WHERE alignment = 'slot' AND on_line AND was_open)
                       / COUNT(*) FILTER (WHERE alignment = 'slot' AND on_line), 1)
      END AS open_pct_slot_on_line,
      CASE WHEN COUNT(*) FILTER (WHERE alignment = 'slot' AND NOT on_line) > 0
        THEN ROUND(100.0 * COUNT(*) FILTER (WHERE alignment = 'slot' AND NOT on_line AND was_open)
                       / COUNT(*) FILTER (WHERE alignment = 'slot' AND NOT on_line), 1)
      END AS open_pct_slot_off_line,
      CASE WHEN COUNT(*) FILTER (WHERE alignment = 'right') > 0
        THEN ROUND(100.0 * COUNT(*) FILTER (WHERE alignment = 'right' AND was_open)
                       / COUNT(*) FILTER (WHERE alignment = 'right'), 1)
      END AS open_pct_right,
      CASE WHEN COUNT(*) FILTER (WHERE alignment = 'right' AND on_line) > 0
        THEN ROUND(100.0 * COUNT(*) FILTER (WHERE alignment = 'right' AND on_line AND was_open)
                       / COUNT(*) FILTER (WHERE alignment = 'right' AND on_line), 1)
      END AS open_pct_right_on_line,
      CASE WHEN COUNT(*) FILTER (WHERE alignment = 'right' AND NOT on_line) > 0
        THEN ROUND(100.0 * COUNT(*) FILTER (WHERE alignment = 'right' AND NOT on_line AND was_open)
                       / COUNT(*) FILTER (WHERE alignment = 'right' AND NOT on_line), 1)
      END AS open_pct_right_off_line,
      CASE WHEN COUNT(*) FILTER (WHERE alignment = 'left') > 0
        THEN ROUND(100.0 * COUNT(*) FILTER (WHERE alignment = 'left' AND was_open)
                       / COUNT(*) FILTER (WHERE alignment = 'left'), 1)
      END AS open_pct_left,
      CASE WHEN COUNT(*) FILTER (WHERE alignment = 'left' AND on_line) > 0
        THEN ROUND(100.0 * COUNT(*) FILTER (WHERE alignment = 'left' AND on_line AND was_open)
                       / COUNT(*) FILTER (WHERE alignment = 'left' AND on_line), 1)
      END AS open_pct_left_on_line,
      CASE WHEN COUNT(*) FILTER (WHERE alignment = 'left' AND NOT on_line) > 0
        THEN ROUND(100.0 * COUNT(*) FILTER (WHERE alignment = 'left' AND NOT on_line AND was_open)
                       / COUNT(*) FILTER (WHERE alignment = 'left' AND NOT on_line), 1)
      END AS open_pct_left_off_line,
      CASE WHEN COUNT(*) FILTER (WHERE alignment = 'backfield') > 0
        THEN ROUND(100.0 * COUNT(*) FILTER (WHERE alignment = 'backfield' AND was_open)
                       / COUNT(*) FILTER (WHERE alignment = 'backfield'), 1)
      END AS open_pct_backfield
    FROM align_charted
    GROUP BY prospect_id
  )
SELECT
  sa.prospect_id,
  sa.total_games,
  COALESCE(pa.total_snaps, 0)              AS total_snaps,
  COALESCE(pa.total_routes, 0)             AS total_routes,
  COALESCE(pa.total_yards, 0)              AS total_yards,
  COALESCE(pa.open_routes, 0)              AS open_routes,
  sa.targets, sa.catches, sa.drops, sa.contested, sa.contested_catches,
  CASE WHEN COALESCE(pa.has_charted_open_data, false) AND COALESCE(pa.total_routes, 0) > 0
    THEN ROUND(100.0 * pa.open_routes / pa.total_routes, 1)
  END AS success_rate,
  CASE WHEN COALESCE(pa.total_routes, 0) > 0
    THEN ROUND(100.0 * sa.targets / pa.total_routes, 1)
  END AS target_rate,
  CASE WHEN sa.catches > 0 THEN ROUND(pa.total_yards::numeric / sa.catches, 1) END AS avg_ypc,
  CASE WHEN COALESCE(pa.total_snaps, 0) > 0 THEN ROUND(100.0 * pa.n_left      / pa.total_snaps, 1) END AS pct_left,
  CASE WHEN COALESCE(pa.total_snaps, 0) > 0 THEN ROUND(100.0 * pa.n_right     / pa.total_snaps, 1) END AS pct_right,
  CASE WHEN COALESCE(pa.total_snaps, 0) > 0 THEN ROUND(100.0 * pa.n_slot      / pa.total_snaps, 1) END AS pct_slot,
  CASE WHEN COALESCE(pa.total_snaps, 0) > 0 THEN ROUND(100.0 * pa.n_backfield / pa.total_snaps, 1) END AS pct_backfield,
  CASE WHEN COALESCE(pa.total_snaps, 0) > 0 THEN ROUND(100.0 * pa.n_on_line   / pa.total_snaps, 1) END AS pct_on_line,
  COALESCE(pa.depth_behind_los, 0)         AS depth_behind_los,
  COALESCE(pa.depth_on_los, 0)             AS depth_on_los,
  COALESCE(pa.has_charted_open_data, false) AS has_charted_open_data,
  COALESCE(rs.route_stats_raw, '{}'::jsonb)    AS route_stats_raw,
  COALESCE(rs.route_type_counts, '{}'::jsonb)  AS route_type_counts,
  COALESCE(cv.coverage_stats_raw, '{}'::jsonb) AS coverage_stats_raw,
  COALESCE(cv.coverage_counts, '{}'::jsonb)    AS coverage_counts,
  COALESCE(ag.align_n_slot, 0)             AS align_n_slot,
  COALESCE(ag.align_n_slot_on_line, 0)     AS align_n_slot_on_line,
  COALESCE(ag.align_n_slot_off_line, 0)    AS align_n_slot_off_line,
  COALESCE(ag.align_n_right, 0)            AS align_n_right,
  COALESCE(ag.align_n_right_on_line, 0)    AS align_n_right_on_line,
  COALESCE(ag.align_n_right_off_line, 0)   AS align_n_right_off_line,
  COALESCE(ag.align_n_left, 0)             AS align_n_left,
  COALESCE(ag.align_n_left_on_line, 0)     AS align_n_left_on_line,
  COALESCE(ag.align_n_left_off_line, 0)    AS align_n_left_off_line,
  COALESCE(ag.align_n_backfield, 0)        AS align_n_backfield,
  ag.open_pct_slot,         ag.open_pct_slot_on_line,    ag.open_pct_slot_off_line,
  ag.open_pct_right,        ag.open_pct_right_on_line,   ag.open_pct_right_off_line,
  ag.open_pct_left,         ag.open_pct_left_on_line,    ag.open_pct_left_off_line,
  ag.open_pct_backfield
FROM summary_agg sa
LEFT JOIN play_agg pa          ON pa.prospect_id = sa.prospect_id
LEFT JOIN route_stats_jsonb rs ON rs.prospect_id = sa.prospect_id
LEFT JOIN coverage_jsonb cv    ON cv.prospect_id = sa.prospect_id
LEFT JOIN align_agg ag         ON ag.prospect_id = sa.prospect_id;

GRANT SELECT ON prospect_route_stats TO authenticated;

-- ── Phase 1: prospect_rb_stats / prospect_qb_stats / prospect_te_stats ────
-- Stubs for Session 1: total_snaps + total_games per prospect. Phase 2
-- (Session 2) will extend these to cover the fields RBStatsTable /
-- QBStatsTable / TEStatsTable consume today, when those tables are switched
-- away from raw rb_plays / qb_plays / te_plays. ProspectWithStats does not
-- depend on these views — they exist now so the migration shape matches the
-- plan, and so the indexes above can be EXPLAIN ANALYZE'd against them.

CREATE VIEW prospect_rb_stats
WITH (security_invoker = on) AS
SELECT
  sg.prospect_id,
  COUNT(rp.id)::int AS total_snaps,
  COUNT(DISTINCT sg.id)::int AS total_games
FROM scouting_games sg
LEFT JOIN rb_plays rp ON rp.game_id = sg.id
GROUP BY sg.prospect_id;

GRANT SELECT ON prospect_rb_stats TO authenticated;

CREATE VIEW prospect_qb_stats
WITH (security_invoker = on) AS
SELECT
  sg.prospect_id,
  COUNT(qp.id)::int AS total_snaps,
  COUNT(DISTINCT sg.id)::int AS total_games
FROM scouting_games sg
LEFT JOIN qb_plays qp ON qp.game_id = sg.id
GROUP BY sg.prospect_id;

GRANT SELECT ON prospect_qb_stats TO authenticated;

CREATE VIEW prospect_te_stats
WITH (security_invoker = on) AS
SELECT
  sg.prospect_id,
  COUNT(tp.id)::int AS total_snaps,
  COUNT(DISTINCT sg.id)::int AS total_games
FROM scouting_games sg
LEFT JOIN te_plays tp ON tp.game_id = sg.id
GROUP BY sg.prospect_id;

GRANT SELECT ON prospect_te_stats TO authenticated;
