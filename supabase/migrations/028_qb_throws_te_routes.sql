-- ============================================================
-- Migration 028 — QB total_throws + TE total_routes
-- ============================================================
-- Adds count columns the Scouting Hub needs to drive the
-- "Fully Charted" auto-promote thresholds for QB (≥150 throws)
-- and TE (≥120 routes). Existing columns are unchanged so
-- CREATE OR REPLACE keeps the views in place without dropping.
--
-- A "throw" mirrors the charting board: play_type IN ('rpo','pass')
-- with timing IN ('first_option','second_option','checkdown') —
-- scrambles, sacks, and throwaways are excluded since they don't
-- record accuracy/completion.
--
-- A "route" for TE is play_type = 'route_run' (te_plays distinguishes
-- routes from run/pass blocks via play_type, unlike route_plays which
-- uses no_route_run).

CREATE OR REPLACE VIEW prospect_qb_stats
WITH (security_invoker = on) AS
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
GROUP BY sg.prospect_id;

GRANT SELECT ON prospect_qb_stats TO authenticated;

CREATE OR REPLACE VIEW prospect_te_stats
WITH (security_invoker = on) AS
SELECT
  sg.prospect_id,
  COUNT(tp.id)::int AS total_snaps,
  COUNT(DISTINCT sg.id)::int AS total_games,
  COUNT(tp.id) FILTER (WHERE tp.play_type = 'route_run')::int AS total_routes
FROM scouting_games sg
LEFT JOIN te_plays tp ON tp.game_id = sg.id
GROUP BY sg.prospect_id;

GRANT SELECT ON prospect_te_stats TO authenticated;
