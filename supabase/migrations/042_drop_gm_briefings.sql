-- ============================================================
-- DynastyZeus — Migration 042
-- Run in the Supabase SQL editor after migration 041.
-- ⚠️  TAKE A BACKUP FIRST (scripts/backup-supabase.ps1).
-- ============================================================
-- DROP gm_briefings — the AI-generated GM briefing table.
--
-- ⚠️  DESTRUCTIVE MIGRATION. This DROP is deliberate and was
--     explicitly approved by the owner during the 2026-07-15
--     platform-audit planning session (item S6, in-scope cleanup
--     under Phase A). Normal policy is zero DROP/DELETE/TRUNCATE
--     in migrations — this is a documented exception, same weight
--     as migration 041's approval.
--
-- Why it's safe to drop:
--   The Claude-powered auto-summarize/GM-briefing feature that
--   populated this table was removed for cost reasons well before
--   this migration (see HANDOFF.md — "AI integration removed...
--   There is no LLM call anywhere in the app today"). A repo-wide
--   grep for gm_briefing/anthropic/openai hits only migrations and
--   schema docs, never app/, components/, or lib/. The table has
--   held 34 stale rows with zero readers or writers since removal.
--
-- Rollback: none. Restore from the pre-migration backup if needed.
-- ============================================================

DROP TABLE IF EXISTS public.gm_briefings;

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('042_drop_gm_briefings', 'drop orphaned AI GM-briefing table (feature removed, zero LLM calls in app)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
