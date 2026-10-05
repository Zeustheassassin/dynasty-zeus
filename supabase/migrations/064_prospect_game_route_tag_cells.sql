-- ============================================================
-- DynastyZeus — Migration 064
-- Run in the Supabase SQL editor after migration 063.
-- ============================================================
-- Stage 4 of the tape-grading expansion (grading). Two views.
--
-- 1. prospect_game_route_counts: a WR's charted targets, catches, drops and
--    contested targets / catches PER GAME, counted exactly as
--    prospect_route_stats counts them for the season (a game entered by Paste
--    Summary reads its summary_* columns; any other game its route plays), plus
--    the game's routes. Feeds the AE Score's charted hands and contested-catch
--    components (lib/scouting/chartedComponents.ts), which need each game's
--    counts for season weighting, opponent strength and the noise estimate.
--
-- 2. prospect_game_route_tag_cells: the WR routes charted WITH the per-play tags
-- (migration 062, Stage 3), counted per game by situation and tag. One row per
-- (prospect, game) that has a tagged route:
--
--   { "curl|man|left|on|1|0|0|0|-|-": [n, open_n], ... }
--
-- Key = route_type | coverage | alignment | on/off line (the same four parts
-- as prospect_game_route_cells, 058) then the tags:
--   red zone | 3rd/4th down | short yardage | garbage time   ('1' / '0')
--   release vs press   ('won' / 'lost' / '-' = not a press route)
--   broken tackle after catch   ('1' / '0' / '-' = not a catch)
--
-- WR SAE / cSAE come from 058's cells, which carry no tags. This view is the
-- tagged slice of the same routes, so the app can (lib/scouting/aggregateMerge.ts):
--   - fit the tag correction on top of the WR model and judge tagged routes
--     with it (tagCorrection.ts; every tag switched off until it passes a
--     held-out test);
--   - weight garbage-time routes, and run the garbage-time and era scale
--     checks;
--   - show the WR tag-only stats: release vs press win rate, broken tackles
--     after the catch.
-- Untagged routes (red_zone IS NULL: charted before the tags existed, or a
-- Paste import) never appear here, so nothing here can change how an old route
-- is judged. Until it's applied, the WR tag stats show "—" and WR has no tag
-- correction; nothing else changes.
--
-- Purely additive — CREATE OR REPLACE VIEW, no DROP/ALTER...DROP/
-- DELETE/TRUNCATE. security_invoker = on, so route_plays' and
-- scouting_games' RLS (owner-only) applies exactly as it does for 058;
-- SELECT granted to authenticated like it.
-- ============================================================

-- ── 1. Per-game charted receiving counts ─────────────────────
CREATE OR REPLACE VIEW prospect_game_route_counts
WITH (security_invoker = on) AS
SELECT
  sg.id          AS game_id,
  sg.prospect_id,
  COUNT(rp.id) FILTER (WHERE rp.no_route_run = false)::int AS routes,
  CASE
    WHEN sg.summary_targets IS NOT NULL THEN sg.summary_targets
    ELSE COUNT(rp.id) FILTER (WHERE rp.no_route_run = false AND rp.targeted)::int
  END AS targets,
  CASE
    WHEN sg.summary_targets IS NOT NULL THEN COALESCE(sg.summary_catches, 0)
    ELSE COUNT(rp.id) FILTER (WHERE rp.no_route_run = false AND rp.targeted AND rp.success = true)::int
  END AS catches,
  CASE
    WHEN sg.summary_targets IS NOT NULL THEN COALESCE(sg.summary_drops, 0)
    ELSE COUNT(rp.id) FILTER (WHERE rp.no_route_run = false AND rp.targeted AND rp.success = false)::int
  END AS drops,
  CASE
    WHEN sg.summary_targets IS NOT NULL THEN COALESCE(sg.summary_contested, 0)
    ELSE COUNT(rp.id) FILTER (WHERE rp.no_route_run = false AND rp.contested)::int
  END AS contested,
  CASE
    WHEN sg.summary_targets IS NOT NULL THEN COALESCE(sg.summary_contested_catches, 0)
    ELSE COUNT(rp.id) FILTER (WHERE rp.no_route_run = false AND rp.contested AND rp.success = true)::int
  END AS contested_catches
FROM scouting_games sg
JOIN route_plays rp ON rp.game_id = sg.id
GROUP BY sg.id, sg.prospect_id, sg.summary_targets, sg.summary_catches, sg.summary_drops,
         sg.summary_contested, sg.summary_contested_catches;

GRANT SELECT ON prospect_game_route_counts TO authenticated;

COMMENT ON VIEW prospect_game_route_counts IS
  'Per-prospect, per-game WR routes, targets, catches, drops and contested targets / catches, counted as prospect_route_stats counts them — the AE Score''s charted hands and contested-catch components (migration 064).';

-- ── 2. Tagged route cells ────────────────────────────────────
CREATE OR REPLACE VIEW prospect_game_route_tag_cells
WITH (security_invoker = on) AS
WITH
  tagged AS (
    SELECT
      sg.prospect_id,
      sg.id AS game_id,
      rp.route_type || '|' || rp.coverage || '|' || rp.alignment || '|' ||
        CASE WHEN rp.on_line THEN 'on' ELSE 'off' END || '|' ||
        CASE WHEN rp.red_zone THEN '1' ELSE '0' END || '|' ||
        CASE WHEN rp.third_fourth_down THEN '1' ELSE '0' END || '|' ||
        CASE WHEN rp.short_yardage THEN '1' ELSE '0' END || '|' ||
        CASE WHEN rp.garbage_time THEN '1' ELSE '0' END || '|' ||
        COALESCE(rp.press_release, '-') || '|' ||
        CASE
          WHEN rp.broken_tackle_after_catch IS NULL THEN '-'
          WHEN rp.broken_tackle_after_catch THEN '1'
          ELSE '0'
        END AS cell,
      rp.was_open
    FROM scouting_games sg
    JOIN route_plays rp ON rp.game_id = sg.id
    WHERE rp.no_route_run = false
      AND rp.red_zone IS NOT NULL
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

GRANT SELECT ON prospect_game_route_tag_cells TO authenticated;

COMMENT ON VIEW prospect_game_route_tag_cells IS
  'Per-prospect, per-game counts (n, open_n) of TAGGED WR routes by route|coverage|alignment|on_line|rz|34|sy|gt|press_release|bt_after_catch — the tag correction, garbage-time and era checks, and the WR tag-only stats (migration 064).';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('064_prospect_game_route_tag_cells', 'Adds prospect_game_route_counts (WR charted targets / catches / drops / contested per game) and prospect_game_route_tag_cells (tagged WR routes per game by situation and tag) for the Stage 4 AE Score components, WR tag correction, garbage-time / era checks and tag-only stats')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
