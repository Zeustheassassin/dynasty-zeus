-- ============================================================
-- DynastyZeus — Migration 055
-- Run in the Supabase SQL editor after migration 054.
-- ============================================================
-- Replaces the Draft History hit/neutral/bust grade with a
-- six-tier outcome scale:
--
--   star > starter > flex > bench > clogger > cut
--
-- Stored the same way as the old scale: one jsonb blob per user,
-- keyed by "{year}_{player_id}".
--
-- The old three-way grades are being retired from the UI at the
-- user's request ("toss out the current Hit Neutral Bust
-- listing") -- they are re-graded by hand on the new scale. This
-- migration therefore writes the new scale to a SEPARATE column
-- and **does not touch `grades`**: the ~400 existing H/N/B marks
-- stay on disk, unread, and are recoverable if the old scale is
-- ever wanted back. Retiring a scale is not a reason to destroy
-- the data behind it.
--
-- Purely additive (ADD COLUMN IF NOT EXISTS) -- no
-- DROP/ALTER...DROP/DELETE/TRUNCATE. consensus_player_grades
-- already carries RLS (migration 006) and GRANTs (migration 050)
-- covering the whole table, so a new column needs no new policy
-- or GRANT.
-- ============================================================

ALTER TABLE public.consensus_player_grades
  ADD COLUMN IF NOT EXISTS tier_grades jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.consensus_player_grades.tier_grades IS
  'Six-tier outcome grade per drafted player, keyed "{year}_{player_id}" -> star|starter|flex|bench|clogger|cut.';

COMMENT ON COLUMN public.consensus_player_grades.grades IS
  'RETIRED (2026-09-24): the old hit/neutral/bust scale, superseded by tier_grades. Kept for recovery only; nothing reads it.';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('055_consensus_player_tiers', 'Adds consensus_player_grades.tier_grades (star/starter/flex/bench/clogger/cut), replacing the retired hit/neutral/bust grades column')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
