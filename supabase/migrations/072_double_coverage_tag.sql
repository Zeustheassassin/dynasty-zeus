-- ============================================================
-- DynastyZeus — Migration 072
-- Run in the Supabase SQL editor after migration 071, BEFORE the code that
-- uses it deploys: the WR and TE charting boards write double_coverage on
-- every new play, so without this column every new WR / TE play save fails.
-- ============================================================
-- Double coverage becomes a per-play tag (the user, 2026-10-21) instead of a
-- coverage choice. A doubled route is still charted as man, zone or press,
-- and the Double tag goes on top: elite WRs are doubled more often than a
-- one-pick coverage button let him chart (21 of 12,570 WR routes were
-- "double" on that date).
--
-- 1. route_plays.double_coverage and te_plays.double_coverage: boolean,
--    nullable, no default. Like the other per-play tags (migration 062):
--    NULL = charted before the tag existed; a new route writes true / false.
--    Routes charted with coverage = 'double' before this keep it (their real
--    man / zone / press call is unknown) and are judged exactly as before.
--
-- 2. prospect_game_route_tag_cells (064) gets an 11th key part, the tag:
--      route|coverage|alignment|on_line|rz|34|sy|gt|press|bt|dbl
--    ('1' / '0'; a tagged route from before this column reads '0'). The app
--    reads both the 10- and 11-part keys (lib/scouting/aggregateMerge.ts).
--    Same columns, so CREATE OR REPLACE VIEW keeps the view and its grants.
--
-- Purely additive: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE VIEW, ledger
-- row. The existing grants and owner-only RLS on route_plays / te_plays
-- cover the new columns; the view stays security_invoker. No DROP, DELETE
-- or TRUNCATE.
-- ============================================================

ALTER TABLE public.route_plays ADD COLUMN IF NOT EXISTS double_coverage boolean;
ALTER TABLE public.te_plays    ADD COLUMN IF NOT EXISTS double_coverage boolean;

COMMENT ON COLUMN public.route_plays.double_coverage IS 'Tag (exception): doubled on this route, on top of its coverage. NULL = charted before the tag existed (migration 072).';
COMMENT ON COLUMN public.te_plays.double_coverage    IS 'Tag (exception): doubled on this route, on top of its coverage. NULL = charted before the tag existed (migration 072).';

-- ── Tagged route cells, with the Double tag ──────────────────
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
        CASE WHEN rp.double_coverage THEN '1' ELSE '0' END AS cell,
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
  'Per-prospect, per-game counts (n, open_n) of TAGGED WR routes by route|coverage|alignment|on_line|rz|34|sy|gt|press_release|bt_after_catch|double_coverage — the tag correction, garbage-time and era checks, and the WR tag-only stats (migrations 064, 072).';

NOTIFY pgrst, 'reload schema';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('072_double_coverage_tag', 'Adds route_plays.double_coverage and te_plays.double_coverage (Double coverage as a per-play tag on top of man / zone / press) and the |dbl part of prospect_game_route_tag_cells'' key')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
