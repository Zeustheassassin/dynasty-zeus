-- ============================================================
-- DynastyZeus — Migration 107
-- Run in the Supabase SQL editor after migration 106. The code that uses it
-- can deploy first: until this runs every game counts in its player's sample
-- (as today), and the boards' "Count in sample" switches stay off ("needs
-- migration 107").
-- ============================================================
-- scouting_games.count_in_sample: the "Count in sample" switch on an imported
-- game (stage 3 of the 2026-11-26 scouting plan, the user's approval of answer
-- 10). Imported = created before 2026-05-01, the bulk import charted under the
-- old press definition (lib/scouting/coverageEra.ts). The boards offer the
-- switch once the player has half a sample charted in the app.
--
--   count_in_sample  true (default) = the game's plays count toward his
--                    sample, his stats and his grades; false = set aside
--
-- A set-aside game leaves HIS numbers only. The league difficulty models still
-- fit on its plays (they read the play tables and the per-game views, which
-- keep every game), and the tape-work counts (games logged, charted games,
-- charted snaps: prospect_game_snap_stats) keep it too.
--
-- The CHECK keeps the switch on imported games: an in-app game always counts.
--
-- The per-player views below are re-created with the same columns, each
-- skipping a set-aside game's plays (its row in scouting_games still counts as
-- a logged game where a view counts games):
--   prospect_route_stats    (020)  WR stats, targets etc. and the summary fallback
--   prospect_route_cells    (057)  WR cells per player (unread since 058; kept in step)
--   prospect_rb_stats       (020/048)
--   prospect_qb_stats       (020/028/048)
--   prospect_te_stats       (020/028/048)
--   prospect_sample_counts  (102)  the Big Board dot / Fully Charted count
-- Each keeps security_invoker, so the owner-only RLS still applies; CREATE OR
-- REPLACE keeps the existing grants.
--
-- Purely additive: ADD COLUMN IF NOT EXISTS (NOT NULL DEFAULT true, so every
-- existing game keeps counting), CHECK added only when missing, CREATE OR
-- REPLACE VIEW with unchanged columns, ledger row. No DROP, DELETE or TRUNCATE.
-- ============================================================

ALTER TABLE public.scouting_games ADD COLUMN IF NOT EXISTS count_in_sample boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scouting_games_count_in_sample_imported_only'
      AND conrelid = 'public.scouting_games'::regclass
  ) THEN
    ALTER TABLE public.scouting_games
      ADD CONSTRAINT scouting_games_count_in_sample_imported_only
      CHECK (count_in_sample OR created_at < '2026-05-01T00:00:00Z');
  END IF;
END $$;

COMMENT ON COLUMN public.scouting_games.count_in_sample IS
  'Count in sample (migration 107): false = an imported game (created before 2026-05-01) set aside from the player''s own sample and grades; the league models still use its plays.';

-- ── WR: prospect_route_stats ──
CREATE OR REPLACE VIEW public.prospect_route_stats
WITH (security_invoker = on) AS
WITH
  per_game AS (
    SELECT
      sg.id AS game_id,
      sg.prospect_id,
      sg.count_in_sample AS counts,
      CASE WHEN sg.summary_targets IS NOT NULL THEN sg.summary_targets
           ELSE COUNT(rp.id) FILTER (WHERE rp.no_route_run = false AND rp.targeted)::int END AS tgt,
      CASE WHEN sg.summary_targets IS NOT NULL THEN COALESCE(sg.summary_catches, 0)
           ELSE COUNT(rp.id) FILTER (WHERE rp.no_route_run = false AND rp.targeted AND rp.success = true)::int END AS ctch,
      CASE WHEN sg.summary_targets IS NOT NULL THEN COALESCE(sg.summary_drops, 0)
           ELSE COUNT(rp.id) FILTER (WHERE rp.no_route_run = false AND rp.targeted AND rp.success = false)::int END AS drops,
      CASE WHEN sg.summary_targets IS NOT NULL THEN COALESCE(sg.summary_contested, 0)
           ELSE COUNT(rp.id) FILTER (WHERE rp.no_route_run = false AND rp.contested)::int END AS contested,
      CASE WHEN sg.summary_targets IS NOT NULL THEN COALESCE(sg.summary_contested_catches, 0)
           ELSE COUNT(rp.id) FILTER (WHERE rp.no_route_run = false AND rp.contested AND rp.success = true)::int END AS contested_catches
    FROM public.scouting_games sg
    LEFT JOIN public.route_plays rp ON rp.game_id = sg.id
    GROUP BY sg.id, sg.prospect_id, sg.count_in_sample, sg.summary_targets, sg.summary_catches, sg.summary_drops,
             sg.summary_contested, sg.summary_contested_catches
  ),
  summary_agg AS (
    -- Every logged game counts in total_games; only the games in his sample
    -- add targets, catches, drops and contested.
    SELECT
      per_game.prospect_id,
      COALESCE(SUM(per_game.tgt) FILTER (WHERE per_game.counts), 0)::int               AS targets,
      COALESCE(SUM(per_game.ctch) FILTER (WHERE per_game.counts), 0)::int              AS catches,
      COALESCE(SUM(per_game.drops) FILTER (WHERE per_game.counts), 0)::int             AS drops,
      COALESCE(SUM(per_game.contested) FILTER (WHERE per_game.counts), 0)::int         AS contested,
      COALESCE(SUM(per_game.contested_catches) FILTER (WHERE per_game.counts), 0)::int AS contested_catches,
      COUNT(*)::int AS total_games
    FROM per_game
    GROUP BY per_game.prospect_id
  ),
  play_agg AS (
    SELECT
      sg.prospect_id,
      COUNT(rp.id)::int                                                     AS total_snaps,
      COUNT(rp.id) FILTER (WHERE NOT rp.no_route_run)::int                  AS total_routes,
      COALESCE(SUM(rp.yards) FILTER (WHERE NOT rp.no_route_run), 0)::int    AS total_yards,
      COUNT(rp.id) FILTER (WHERE rp.alignment = 'left')::int                AS n_left,
      COUNT(rp.id) FILTER (WHERE rp.alignment = 'right')::int               AS n_right,
      COUNT(rp.id) FILTER (WHERE rp.alignment = 'slot')::int                AS n_slot,
      COUNT(rp.id) FILTER (WHERE rp.alignment = 'backfield')::int           AS n_backfield,
      COUNT(rp.id) FILTER (WHERE rp.on_line)::int                           AS n_on_line,
      COUNT(rp.id) FILTER (WHERE NOT rp.no_route_run AND rp.was_open)::int  AS open_routes,
      COUNT(rp.id) FILTER (WHERE NOT rp.no_route_run AND NOT rp.on_line)::int AS depth_behind_los,
      COUNT(rp.id) FILTER (WHERE NOT rp.no_route_run AND rp.on_line)::int   AS depth_on_los,
      COALESCE(bool_or(NOT rp.no_route_run AND rp.was_open), false)
        OR COALESCE(bool_or(NOT rp.no_route_run AND rp.targeted AND rp.success IS NOT NULL), false) AS has_charted_open_data
    FROM public.scouting_games sg
    LEFT JOIN public.route_plays rp ON rp.game_id = sg.id AND sg.count_in_sample
    GROUP BY sg.prospect_id
  ),
  route_type_agg AS (
    SELECT
      sg.prospect_id,
      rp.route_type,
      COUNT(*)::int                                                AS cnt,
      COUNT(*) FILTER (WHERE rp.was_open)::int                     AS open_cnt,
      COUNT(*) FILTER (WHERE rp.targeted)::int                     AS tgt_cnt,
      COUNT(*) FILTER (WHERE rp.targeted AND rp.success = true)::int AS ctch_cnt
    FROM public.scouting_games sg
    JOIN public.route_plays rp ON rp.game_id = sg.id
    WHERE rp.no_route_run = false
      AND sg.count_in_sample
    GROUP BY sg.prospect_id, rp.route_type
  ),
  route_stats_jsonb AS (
    SELECT
      route_type_agg.prospect_id,
      jsonb_object_agg(route_type_agg.route_type, jsonb_build_object(
        'count', route_type_agg.cnt, 'open', route_type_agg.open_cnt,
        'targets', route_type_agg.tgt_cnt, 'catches', route_type_agg.ctch_cnt)) AS route_stats_raw,
      jsonb_object_agg(route_type_agg.route_type, route_type_agg.cnt) AS route_type_counts
    FROM route_type_agg
    GROUP BY route_type_agg.prospect_id
  ),
  coverage_agg AS (
    SELECT
      sg.prospect_id,
      rp.coverage,
      COUNT(*)::int                                                AS cnt,
      COUNT(*) FILTER (WHERE rp.was_open)::int                     AS open_cnt,
      COUNT(*) FILTER (WHERE rp.targeted AND rp.success = true)::int AS ctch_cnt
    FROM public.scouting_games sg
    JOIN public.route_plays rp ON rp.game_id = sg.id
    WHERE rp.no_route_run = false
      AND rp.coverage IN ('man', 'zone', 'double', 'press')
      AND sg.count_in_sample
    GROUP BY sg.prospect_id, rp.coverage
  ),
  coverage_jsonb AS (
    SELECT
      coverage_agg.prospect_id,
      jsonb_object_agg(coverage_agg.coverage, jsonb_build_object(
        'count', coverage_agg.cnt, 'open', coverage_agg.open_cnt, 'catches', coverage_agg.ctch_cnt)) AS coverage_stats_raw,
      jsonb_object_agg(coverage_agg.coverage, coverage_agg.cnt) AS coverage_counts
    FROM coverage_agg
    GROUP BY coverage_agg.prospect_id
  ),
  align_charted AS (
    SELECT sg.prospect_id, rp.alignment, rp.on_line, rp.was_open
    FROM public.scouting_games sg
    JOIN public.route_plays rp ON rp.game_id = sg.id
    WHERE sg.summary_targets IS NULL
      AND rp.no_route_run = false
      AND sg.count_in_sample
  ),
  align_agg AS (
    SELECT
      a.prospect_id,
      COUNT(*) FILTER (WHERE a.alignment = 'slot')::int                          AS align_n_slot,
      COUNT(*) FILTER (WHERE a.alignment = 'slot' AND a.on_line)::int            AS align_n_slot_on_line,
      COUNT(*) FILTER (WHERE a.alignment = 'slot' AND NOT a.on_line)::int        AS align_n_slot_off_line,
      COUNT(*) FILTER (WHERE a.alignment = 'right')::int                         AS align_n_right,
      COUNT(*) FILTER (WHERE a.alignment = 'right' AND a.on_line)::int           AS align_n_right_on_line,
      COUNT(*) FILTER (WHERE a.alignment = 'right' AND NOT a.on_line)::int       AS align_n_right_off_line,
      COUNT(*) FILTER (WHERE a.alignment = 'left')::int                          AS align_n_left,
      COUNT(*) FILTER (WHERE a.alignment = 'left' AND a.on_line)::int            AS align_n_left_on_line,
      COUNT(*) FILTER (WHERE a.alignment = 'left' AND NOT a.on_line)::int        AS align_n_left_off_line,
      COUNT(*) FILTER (WHERE a.alignment = 'backfield')::int                     AS align_n_backfield,
      CASE WHEN COUNT(*) FILTER (WHERE a.alignment = 'slot') > 0
        THEN round(100.0 * COUNT(*) FILTER (WHERE a.alignment = 'slot' AND a.was_open)::numeric
                   / COUNT(*) FILTER (WHERE a.alignment = 'slot')::numeric, 1) END AS open_pct_slot,
      CASE WHEN COUNT(*) FILTER (WHERE a.alignment = 'slot' AND a.on_line) > 0
        THEN round(100.0 * COUNT(*) FILTER (WHERE a.alignment = 'slot' AND a.on_line AND a.was_open)::numeric
                   / COUNT(*) FILTER (WHERE a.alignment = 'slot' AND a.on_line)::numeric, 1) END AS open_pct_slot_on_line,
      CASE WHEN COUNT(*) FILTER (WHERE a.alignment = 'slot' AND NOT a.on_line) > 0
        THEN round(100.0 * COUNT(*) FILTER (WHERE a.alignment = 'slot' AND NOT a.on_line AND a.was_open)::numeric
                   / COUNT(*) FILTER (WHERE a.alignment = 'slot' AND NOT a.on_line)::numeric, 1) END AS open_pct_slot_off_line,
      CASE WHEN COUNT(*) FILTER (WHERE a.alignment = 'right') > 0
        THEN round(100.0 * COUNT(*) FILTER (WHERE a.alignment = 'right' AND a.was_open)::numeric
                   / COUNT(*) FILTER (WHERE a.alignment = 'right')::numeric, 1) END AS open_pct_right,
      CASE WHEN COUNT(*) FILTER (WHERE a.alignment = 'right' AND a.on_line) > 0
        THEN round(100.0 * COUNT(*) FILTER (WHERE a.alignment = 'right' AND a.on_line AND a.was_open)::numeric
                   / COUNT(*) FILTER (WHERE a.alignment = 'right' AND a.on_line)::numeric, 1) END AS open_pct_right_on_line,
      CASE WHEN COUNT(*) FILTER (WHERE a.alignment = 'right' AND NOT a.on_line) > 0
        THEN round(100.0 * COUNT(*) FILTER (WHERE a.alignment = 'right' AND NOT a.on_line AND a.was_open)::numeric
                   / COUNT(*) FILTER (WHERE a.alignment = 'right' AND NOT a.on_line)::numeric, 1) END AS open_pct_right_off_line,
      CASE WHEN COUNT(*) FILTER (WHERE a.alignment = 'left') > 0
        THEN round(100.0 * COUNT(*) FILTER (WHERE a.alignment = 'left' AND a.was_open)::numeric
                   / COUNT(*) FILTER (WHERE a.alignment = 'left')::numeric, 1) END AS open_pct_left,
      CASE WHEN COUNT(*) FILTER (WHERE a.alignment = 'left' AND a.on_line) > 0
        THEN round(100.0 * COUNT(*) FILTER (WHERE a.alignment = 'left' AND a.on_line AND a.was_open)::numeric
                   / COUNT(*) FILTER (WHERE a.alignment = 'left' AND a.on_line)::numeric, 1) END AS open_pct_left_on_line,
      CASE WHEN COUNT(*) FILTER (WHERE a.alignment = 'left' AND NOT a.on_line) > 0
        THEN round(100.0 * COUNT(*) FILTER (WHERE a.alignment = 'left' AND NOT a.on_line AND a.was_open)::numeric
                   / COUNT(*) FILTER (WHERE a.alignment = 'left' AND NOT a.on_line)::numeric, 1) END AS open_pct_left_off_line,
      CASE WHEN COUNT(*) FILTER (WHERE a.alignment = 'backfield') > 0
        THEN round(100.0 * COUNT(*) FILTER (WHERE a.alignment = 'backfield' AND a.was_open)::numeric
                   / COUNT(*) FILTER (WHERE a.alignment = 'backfield')::numeric, 1) END AS open_pct_backfield
    FROM align_charted a
    GROUP BY a.prospect_id
  )
SELECT
  sa.prospect_id,
  sa.total_games,
  COALESCE(pa.total_snaps, 0)  AS total_snaps,
  COALESCE(pa.total_routes, 0) AS total_routes,
  COALESCE(pa.total_yards, 0)  AS total_yards,
  COALESCE(pa.open_routes, 0)  AS open_routes,
  sa.targets,
  sa.catches,
  sa.drops,
  sa.contested,
  sa.contested_catches,
  CASE WHEN COALESCE(pa.has_charted_open_data, false) AND COALESCE(pa.total_routes, 0) > 0
    THEN round(100.0 * pa.open_routes::numeric / pa.total_routes::numeric, 1) END AS success_rate,
  CASE WHEN COALESCE(pa.total_routes, 0) > 0
    THEN round(100.0 * sa.targets::numeric / pa.total_routes::numeric, 1) END AS target_rate,
  CASE WHEN sa.catches > 0
    THEN round(pa.total_yards::numeric / sa.catches::numeric, 1) END AS avg_ypc,
  CASE WHEN COALESCE(pa.total_snaps, 0) > 0 THEN round(100.0 * pa.n_left::numeric / pa.total_snaps::numeric, 1) END      AS pct_left,
  CASE WHEN COALESCE(pa.total_snaps, 0) > 0 THEN round(100.0 * pa.n_right::numeric / pa.total_snaps::numeric, 1) END     AS pct_right,
  CASE WHEN COALESCE(pa.total_snaps, 0) > 0 THEN round(100.0 * pa.n_slot::numeric / pa.total_snaps::numeric, 1) END      AS pct_slot,
  CASE WHEN COALESCE(pa.total_snaps, 0) > 0 THEN round(100.0 * pa.n_backfield::numeric / pa.total_snaps::numeric, 1) END AS pct_backfield,
  CASE WHEN COALESCE(pa.total_snaps, 0) > 0 THEN round(100.0 * pa.n_on_line::numeric / pa.total_snaps::numeric, 1) END   AS pct_on_line,
  COALESCE(pa.depth_behind_los, 0) AS depth_behind_los,
  COALESCE(pa.depth_on_los, 0)     AS depth_on_los,
  COALESCE(pa.has_charted_open_data, false) AS has_charted_open_data,
  COALESCE(rs.route_stats_raw, '{}'::jsonb)    AS route_stats_raw,
  COALESCE(rs.route_type_counts, '{}'::jsonb)  AS route_type_counts,
  COALESCE(cv.coverage_stats_raw, '{}'::jsonb) AS coverage_stats_raw,
  COALESCE(cv.coverage_counts, '{}'::jsonb)    AS coverage_counts,
  COALESCE(ag.align_n_slot, 0)           AS align_n_slot,
  COALESCE(ag.align_n_slot_on_line, 0)   AS align_n_slot_on_line,
  COALESCE(ag.align_n_slot_off_line, 0)  AS align_n_slot_off_line,
  COALESCE(ag.align_n_right, 0)          AS align_n_right,
  COALESCE(ag.align_n_right_on_line, 0)  AS align_n_right_on_line,
  COALESCE(ag.align_n_right_off_line, 0) AS align_n_right_off_line,
  COALESCE(ag.align_n_left, 0)           AS align_n_left,
  COALESCE(ag.align_n_left_on_line, 0)   AS align_n_left_on_line,
  COALESCE(ag.align_n_left_off_line, 0)  AS align_n_left_off_line,
  COALESCE(ag.align_n_backfield, 0)      AS align_n_backfield,
  ag.open_pct_slot,
  ag.open_pct_slot_on_line,
  ag.open_pct_slot_off_line,
  ag.open_pct_right,
  ag.open_pct_right_on_line,
  ag.open_pct_right_off_line,
  ag.open_pct_left,
  ag.open_pct_left_on_line,
  ag.open_pct_left_off_line,
  ag.open_pct_backfield
FROM summary_agg sa
LEFT JOIN play_agg pa          ON pa.prospect_id = sa.prospect_id
LEFT JOIN route_stats_jsonb rs ON rs.prospect_id = sa.prospect_id
LEFT JOIN coverage_jsonb cv    ON cv.prospect_id = sa.prospect_id
LEFT JOIN align_agg ag         ON ag.prospect_id = sa.prospect_id;

-- ── WR: prospect_route_cells (057; the app reads the per-game 058 cells now) ──
CREATE OR REPLACE VIEW public.prospect_route_cells
WITH (security_invoker = on) AS
WITH
  tagged AS (
    SELECT
      sg.prospect_id,
      rp.route_type || '|' || rp.coverage || '|' || rp.alignment || '|' || CASE WHEN rp.on_line THEN 'on' ELSE 'off' END AS cell,
      rp.was_open
    FROM public.scouting_games sg
    JOIN public.route_plays rp ON rp.game_id = sg.id
    WHERE rp.no_route_run = false
      AND sg.count_in_sample
  ),
  cell_counts AS (
    SELECT tagged.prospect_id, tagged.cell, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE tagged.was_open)::int AS open_n
    FROM tagged
    GROUP BY tagged.prospect_id, tagged.cell
  )
SELECT prospect_id, jsonb_object_agg(cell, jsonb_build_array(n, open_n)) AS cells
FROM cell_counts
GROUP BY prospect_id;

-- ── RB: prospect_rb_stats ──
CREATE OR REPLACE VIEW public.prospect_rb_stats
WITH (security_invoker = on) AS
WITH
  run_type_agg AS (
    SELECT
      sg_1.prospect_id,
      rp_1.run_type,
      COUNT(*)::int AS cnt,
      COUNT(*) FILTER (WHERE rp_1.success = true)::int AS success_cnt
    FROM public.scouting_games sg_1
    JOIN public.rb_plays rp_1 ON rp_1.game_id = sg_1.id
    WHERE rp_1.run_type IN ('outside_zone', 'inside_zone', 'outside_man_gap', 'inside_man_gap')
      AND sg_1.count_in_sample
    GROUP BY sg_1.prospect_id, rp_1.run_type
  ),
  run_type_jsonb AS (
    SELECT
      run_type_agg.prospect_id,
      jsonb_object_agg(run_type_agg.run_type, jsonb_build_object('count', run_type_agg.cnt, 'success', run_type_agg.success_cnt)) AS run_type_stats_raw
    FROM run_type_agg
    GROUP BY run_type_agg.prospect_id
  )
SELECT
  sg.prospect_id,
  COUNT(rp.id)::int          AS total_snaps,
  COUNT(DISTINCT sg.id)::int AS total_games,
  COALESCE(rt.run_type_stats_raw, '{}'::jsonb) AS run_type_stats_raw
FROM public.scouting_games sg
LEFT JOIN public.rb_plays rp   ON rp.game_id = sg.id AND sg.count_in_sample
LEFT JOIN run_type_jsonb rt    ON rt.prospect_id = sg.prospect_id
GROUP BY sg.prospect_id, rt.run_type_stats_raw;

-- ── QB: prospect_qb_stats ──
CREATE OR REPLACE VIEW public.prospect_qb_stats
WITH (security_invoker = on) AS
WITH
  thrown AS (
    SELECT sg_1.prospect_id, qp_1.depth_zone, qp_1.accuracy
    FROM public.scouting_games sg_1
    JOIN public.qb_plays qp_1 ON qp_1.game_id = sg_1.id
    WHERE qp_1.play_type <> 'run'
      AND (qp_1.timing IS NULL OR qp_1.timing NOT IN ('scramble', 'sack', 'throw_away'))
      AND qp_1.depth_zone IS NOT NULL
      AND sg_1.count_in_sample
  ),
  depth_zone_agg AS (
    SELECT
      thrown.prospect_id,
      split_part(thrown.depth_zone, '_', 1) AS zone,
      COUNT(*)::int AS cnt,
      COUNT(*) FILTER (WHERE thrown.accuracy = 'on_target')::int AS on_target_cnt
    FROM thrown
    GROUP BY thrown.prospect_id, split_part(thrown.depth_zone, '_', 1)
  ),
  depth_zone_jsonb AS (
    SELECT
      depth_zone_agg.prospect_id,
      jsonb_object_agg(depth_zone_agg.zone, jsonb_build_object('count', depth_zone_agg.cnt, 'onTarget', depth_zone_agg.on_target_cnt)) AS depth_zone_stats_raw
    FROM depth_zone_agg
    GROUP BY depth_zone_agg.prospect_id
  )
SELECT
  sg.prospect_id,
  COUNT(qp.id)::int          AS total_snaps,
  COUNT(DISTINCT sg.id)::int AS total_games,
  COUNT(qp.id) FILTER (WHERE qp.play_type IN ('rpo', 'pass') AND qp.timing IN ('first_option', 'second_option', 'checkdown'))::int AS total_throws,
  COALESCE(dz.depth_zone_stats_raw, '{}'::jsonb) AS depth_zone_stats_raw
FROM public.scouting_games sg
LEFT JOIN public.qb_plays qp    ON qp.game_id = sg.id AND sg.count_in_sample
LEFT JOIN depth_zone_jsonb dz   ON dz.prospect_id = sg.prospect_id
GROUP BY sg.prospect_id, dz.depth_zone_stats_raw;

-- ── TE: prospect_te_stats ──
CREATE OR REPLACE VIEW public.prospect_te_stats
WITH (security_invoker = on) AS
WITH
  coverage_agg AS (
    SELECT
      sg_1.prospect_id,
      tp_1.coverage,
      COUNT(*)::int AS cnt,
      COUNT(*) FILTER (WHERE tp_1.was_open)::int AS open_cnt,
      COUNT(*) FILTER (WHERE tp_1.targeted AND tp_1.caught = true)::int AS ctch_cnt
    FROM public.scouting_games sg_1
    JOIN public.te_plays tp_1 ON tp_1.game_id = sg_1.id
    WHERE tp_1.play_type = 'route_run'
      AND tp_1.coverage IN ('man', 'zone', 'press', 'double')
      AND sg_1.count_in_sample
    GROUP BY sg_1.prospect_id, tp_1.coverage
  ),
  coverage_jsonb AS (
    SELECT
      coverage_agg.prospect_id,
      jsonb_object_agg(coverage_agg.coverage, jsonb_build_object('count', coverage_agg.cnt, 'open', coverage_agg.open_cnt, 'catches', coverage_agg.ctch_cnt)) AS coverage_stats_raw
    FROM coverage_agg
    GROUP BY coverage_agg.prospect_id
  ),
  block_agg AS (
    SELECT
      sg_1.prospect_id,
      tp_1.block_type,
      COUNT(*)::int AS cnt,
      COUNT(*) FILTER (WHERE tp_1.block_success = true)::int AS success_cnt
    FROM public.scouting_games sg_1
    JOIN public.te_plays tp_1 ON tp_1.game_id = sg_1.id
    WHERE tp_1.play_type IN ('run_block', 'pass_block')
      AND tp_1.block_type IS NOT NULL
      AND sg_1.count_in_sample
    GROUP BY sg_1.prospect_id, tp_1.block_type
  ),
  block_jsonb AS (
    SELECT
      block_agg.prospect_id,
      jsonb_object_agg(block_agg.block_type, jsonb_build_object('count', block_agg.cnt, 'success', block_agg.success_cnt)) AS block_stats_raw
    FROM block_agg
    GROUP BY block_agg.prospect_id
  )
SELECT
  sg.prospect_id,
  COUNT(tp.id)::int          AS total_snaps,
  COUNT(DISTINCT sg.id)::int AS total_games,
  COUNT(tp.id) FILTER (WHERE tp.play_type = 'route_run')::int AS total_routes,
  COALESCE(cv.coverage_stats_raw, '{}'::jsonb) AS coverage_stats_raw,
  COALESCE(bl.block_stats_raw, '{}'::jsonb)    AS block_stats_raw
FROM public.scouting_games sg
LEFT JOIN public.te_plays tp  ON tp.game_id = sg.id AND sg.count_in_sample
LEFT JOIN coverage_jsonb cv   ON cv.prospect_id = sg.prospect_id
LEFT JOIN block_jsonb bl      ON bl.prospect_id = sg.prospect_id
GROUP BY sg.prospect_id, cv.coverage_stats_raw, bl.block_stats_raw;

-- ── The Big Board dot / Fully Charted count: prospect_sample_counts (102) ──
-- Filters unchanged (aboveExpected.ts isQBGradedThrow / isKnownRun /
-- isRatedTERoute); a set-aside game's plays are left out.
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
      AND sg.count_in_sample
    GROUP BY sg.prospect_id
  ),
  rb AS (
    SELECT sg.prospect_id, COUNT(*)::int AS n
    FROM public.scouting_games sg
    JOIN public.rb_plays rp ON rp.game_id = sg.id
    WHERE rp.run_type IN ('outside_zone', 'inside_zone', 'outside_man_gap', 'inside_man_gap')
      AND rp.success IS NOT NULL
      AND sg.count_in_sample
    GROUP BY sg.prospect_id
  ),
  te AS (
    SELECT sg.prospect_id, COUNT(*)::int AS n
    FROM public.scouting_games sg
    JOIN public.te_plays tp ON tp.game_id = sg.id
    WHERE tp.play_type = 'route_run'
      AND tp.was_open IS NOT NULL
      AND sg.count_in_sample
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

-- PostgREST picks up the new column.
NOTIFY pgrst, 'reload schema';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('107_scouting_game_count_in_sample', 'scouting_games.count_in_sample: imported games set aside from a player''s own sample; per-player views skip them')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
