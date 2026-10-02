-- ============================================================
-- DynastyZeus — Migration 060
-- Run in the Supabase SQL editor after migration 059.
-- ============================================================
-- Adds prospect_game_alignment: where a WR lined up, counted over EVERY
-- charted play (routes and run plays alike), per game. One row per
-- (prospect, game):
--
--   snaps, slot_on, slot_off, left_on, left_off, right_on, right_off, backfield
--
-- The WR Analysis / Compare "Lined Up" columns show each spot's share of a
-- receiver's snaps, X (outside, on the line) vs Z (outside, off it) vs slot.
-- Run plays count too (the user's call): where a receiver lines up on runs is
-- part of his role. The app keeps only games charted in the app; the
-- 2026-04-30 import entered whole games rather than plays, so its alignment
-- isn't a per-play record. prospect_game_route_cells (058) can't serve here:
-- it holds routes only. Until this view is applied the Lined Up columns show
-- "—"; nothing else changes.
--
-- Purely additive — CREATE OR REPLACE VIEW, no DROP/ALTER...DROP/
-- DELETE/TRUNCATE. security_invoker = on, so route_plays' and
-- scouting_games' RLS (owner-only) applies exactly as it does for 058;
-- SELECT granted to authenticated like it.
-- ============================================================

CREATE OR REPLACE VIEW prospect_game_alignment
WITH (security_invoker = on) AS
SELECT
  sg.prospect_id,
  sg.id                                                              AS game_id,
  COUNT(*)::int                                                      AS snaps,
  COUNT(*) FILTER (WHERE rp.alignment = 'slot'  AND rp.on_line)::int     AS slot_on,
  COUNT(*) FILTER (WHERE rp.alignment = 'slot'  AND NOT rp.on_line)::int AS slot_off,
  COUNT(*) FILTER (WHERE rp.alignment = 'left'  AND rp.on_line)::int     AS left_on,
  COUNT(*) FILTER (WHERE rp.alignment = 'left'  AND NOT rp.on_line)::int AS left_off,
  COUNT(*) FILTER (WHERE rp.alignment = 'right' AND rp.on_line)::int     AS right_on,
  COUNT(*) FILTER (WHERE rp.alignment = 'right' AND NOT rp.on_line)::int AS right_off,
  COUNT(*) FILTER (WHERE rp.alignment = 'backfield')::int                AS backfield
FROM scouting_games sg
JOIN route_plays rp ON rp.game_id = sg.id
GROUP BY sg.prospect_id, sg.id;

GRANT SELECT ON prospect_game_alignment TO authenticated;

COMMENT ON VIEW prospect_game_alignment IS
  'Per-prospect, per-game WR snap counts (routes and run plays) by alignment and on/off the line — feeds the Lined Up columns.';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('060_prospect_game_alignment', 'Adds prospect_game_alignment (WR snaps by alignment and on/off line, per game, run plays included) for the Lined Up columns')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
