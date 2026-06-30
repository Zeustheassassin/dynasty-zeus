-- ============================================================
-- DynastyZeus — Migration 041
-- Run in the Supabase SQL editor after migration 040.
-- ⚠️  TAKE A BACKUP FIRST (scripts/backup-supabase.ps1).
-- ============================================================
-- DROP player_dispositions — the manual Sell/Buy disposition table.
--
-- ⚠️  DESTRUCTIVE MIGRATION (the only one in this project). This
--     DROP is deliberate and was explicitly approved by the owner
--     on 2026-06-30. It permanently deletes every user's manual
--     buy/sell tags. Normal policy is zero DROP/DELETE/TRUNCATE in
--     migrations — this is the documented exception.
--
-- Why it's safe to drop:
--   The manual disposition dropdowns were removed in Phase 3 of the
--   personal-rankings work. Nothing in the app reads or writes this
--   table anymore — the Trade Finder's buy/sell signal now comes
--   entirely from personal_rankings (migration 040) vs. the market
--   consensus. The table had been orphaned (inert) since that phase.
--
-- Rollback: none. Restore from the pre-migration backup if needed.
-- ============================================================

DROP TABLE IF EXISTS public.player_dispositions;

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('041_drop_player_dispositions', 'drop orphaned manual buy/sell disposition table (replaced by personal_rankings)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
