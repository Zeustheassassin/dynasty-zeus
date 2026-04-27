-- ============================================================
-- Migration 022 — Per-game snap counts across all four play tables
-- ============================================================
-- The Games Charted log shows one row per scouting_games and needs a
-- per-game total snap count. Each scouting_games row belongs to exactly
-- one prospect (and thus one position), so its snaps live in only one of
-- route_plays / rb_plays / qb_plays / te_plays. Summing all four with
-- LEFT JOINs is correct because at most one branch is non-zero per game.
--
-- Distinct from prospect_game_route_stats (migration 021), which is WR-only
-- and counts route_plays where no_route_run = false. This view counts
-- every charted snap regardless of position or no_route_run flag.

CREATE VIEW prospect_game_snap_stats
WITH (security_invoker = on) AS
SELECT
  sg.id           AS game_id,
  sg.prospect_id,
  COALESCE(rp.n, 0) + COALESCE(rb.n, 0) + COALESCE(qb.n, 0) + COALESCE(te.n, 0) AS snaps_charted
FROM scouting_games sg
LEFT JOIN (SELECT game_id, COUNT(*)::int AS n FROM route_plays GROUP BY game_id) rp ON rp.game_id = sg.id
LEFT JOIN (SELECT game_id, COUNT(*)::int AS n FROM rb_plays    GROUP BY game_id) rb ON rb.game_id = sg.id
LEFT JOIN (SELECT game_id, COUNT(*)::int AS n FROM qb_plays    GROUP BY game_id) qb ON qb.game_id = sg.id
LEFT JOIN (SELECT game_id, COUNT(*)::int AS n FROM te_plays    GROUP BY game_id) te ON te.game_id = sg.id;

GRANT SELECT ON prospect_game_snap_stats TO authenticated;

-- After running: NOTIFY pgrst, 'reload schema';
