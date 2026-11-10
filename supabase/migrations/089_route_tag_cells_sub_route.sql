-- ============================================================
-- DynastyZeus — Migration 089
-- Run in the Supabase SQL editor after migration 088. The code reads the
-- view with or without this change: until it's applied, WR routes carry no
-- sub-route in the grading, so the Love of the Game adjustment reaches TEs
-- only (te_plays are read raw) and the WR sub-route checks read empty.
-- ============================================================
-- The user, 2026-11-10: sub-routes start counting in the grading one at a
-- time as each has the numbers, Love of the Game first (a clear-out nine
-- nobody wins: 0 open on 16 WR routes). The WR grading reads tagged routes
-- from prospect_game_route_tag_cells, which has no sub-route, so its key gets
-- a 13th part:
--   route|coverage|alignment|on_line|rz|34|sy|gt|press|bt|dbl|caught|sub
-- sub = route_plays.route_variant, '-' when unsplit (charted before
-- sub-routes, 2026-10-23). Sub-route keys are lowercase letters and
-- underscores (route_variant_options, migration 074), never '|'. The other
-- twelve parts are unchanged. The app reads 10- to 13-part keys
-- (lib/scouting/aggregateMerge.ts parseTagCells).
--
-- Purely additive: CREATE OR REPLACE VIEW with the same columns, so it keeps
-- the view and its grants; the view stays security_invoker over the
-- owner-only RLS on route_plays. No table change. No DROP, DELETE or
-- TRUNCATE.
-- ============================================================

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
        END || '|' ||
        CASE WHEN rp.double_coverage THEN '1' ELSE '0' END || '|' ||
        CASE WHEN rp.targeted AND rp.success IS TRUE THEN '1' ELSE '0' END || '|' ||
        COALESCE(rp.route_variant, '-') AS cell,
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
  'Per-prospect, per-game counts (n, open_n) of TAGGED WR routes by route|coverage|alignment|on_line|rz|34|sy|gt|press_release|bt_after_catch|double_coverage|caught|route_variant — the tag correction and sub-route correction, garbage-time and era checks, the WR tag-only stats and tagged Double coverage catches (migrations 064, 072, 088, 089).';

NOTIFY pgrst, 'reload schema';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('089_route_tag_cells_sub_route', 'prospect_game_route_tag_cells key gets a 13th part, the route''s sub-route (route_variant, ''-'' when unsplit), for the sub-route correction (Love of the Game first)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
