-- ============================================================
-- DynastyZeus — Migration 067
-- Run in the Supabase SQL editor after migration 066, and only once the
-- commit that makes the QB board force play action on RPOs is live
-- (isTaggedPlay must already read the situation tags only; see below).
-- ============================================================
-- Data only: an RPO always has a play-action element (the user's rule,
-- 2026-10-06), so every charted RPO gets qb_plays.play_action = true.
-- The QB board now writes it on every new or edited RPO and locks the
-- button on; this fills in the plays charted before that.
--
-- As of 2026-10-06 this is 182 of the 194 RPO plays (12 were already
-- marked):
--   3   tagged plays charted with play action off
--   179 plays charted before the per-play tags existed (play_action NULL)
--
-- The 179 old plays stay OLD plays: the app now decides "tagged" from the
-- four situation tags only (lib/scouting/playEra.ts isTaggedPlay), and those
-- stay NULL. Under the earlier rule (any tag column non-null) this update
-- would have turned them into tagged plays, so the code must ship first.
--
-- Re-runnable: it only touches RPO rows not already true. No DDL, no DROP,
-- DELETE or TRUNCATE.
-- ============================================================

UPDATE public.qb_plays
SET play_action = true
WHERE play_type = 'rpo'
  AND play_action IS DISTINCT FROM true;

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('067_qb_rpo_play_action', 'Data only: play_action = true on every RPO in qb_plays (an RPO always has a play-action element)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
