-- ============================================================
-- DynastyZeus — Migration 088
-- Run in the Supabase SQL editor after migration 087, before charting any
-- more WR games. The code reads the view with or without this change; in
-- between, a WR catch charted after the deploy doesn't count toward his
-- tagged Double coverage catches (the Big Board's Dbl catches column).
-- ============================================================
-- The user, 2026-11-10: the WR board stops charting Broken tackle after
-- catch (PFF's missed tackles per catch score it instead). That tag also
-- quietly marked a caught route in prospect_game_route_tag_cells: a tagged
-- catch carried '1' or '0' in the bt part, every other route '-', and the
-- app counted tagged Double coverage catches from it
-- (lib/scouting/aggregateMerge.ts taggedDoubleByProspect). New catches now
-- leave the tag NULL, so the view gets its own caught flag.
--
-- prospect_game_route_tag_cells (064, 072) gets a 12th key part:
--   route|coverage|alignment|on_line|rz|34|sy|gt|press|bt|dbl|caught
-- caught = '1' when the route was targeted and caught (success = true),
-- else '0'. The other eleven parts are unchanged (bt stays for old plays).
-- The app reads 10-, 11- and 12-part keys.
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
        CASE WHEN rp.targeted AND rp.success IS TRUE THEN '1' ELSE '0' END AS cell,
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
  'Per-prospect, per-game counts (n, open_n) of TAGGED WR routes by route|coverage|alignment|on_line|rz|34|sy|gt|press_release|bt_after_catch|double_coverage|caught — the tag correction, garbage-time and era checks, the WR tag-only stats and tagged Double coverage catches (migrations 064, 072, 088).';

NOTIFY pgrst, 'reload schema';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('088_route_tag_cells_caught', 'prospect_game_route_tag_cells key gets a 12th part, caught (targeted and caught), replacing the dropped WR Broken tackle after catch tag as the catch marker')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
