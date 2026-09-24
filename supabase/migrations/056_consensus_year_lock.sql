-- ============================================================
-- DynastyZeus — Migration 056
-- Run in the Supabase SQL editor after migration 055.
-- ============================================================
-- Adds a per-year lock to the consensus draft metadata, so a
-- year whose compiled board the user is happy with cannot be
-- recompiled or cleared by accident. A compile is an expensive,
-- rate-limited crawl whose results shift as the underlying
-- Sleeper network changes, so "I like this one, freeze it" needs
-- to be expressible.
--
-- Enforced in two places (both required — neither alone is
-- enough): app/api/compile-consensus rejects locked years
-- server-side even if a stale client asks for them, and the
-- compile panel disables the checkbox + Clear button client-side.
--
-- Purely additive (ADD COLUMN IF NOT EXISTS) -- no
-- DROP/ALTER...DROP/DELETE/TRUNCATE. consensus_draft_meta already
-- carries RLS (migration 006) and GRANTs (migration 050) covering
-- the whole table, so a new column needs no new policy or GRANT.
-- ============================================================

ALTER TABLE public.consensus_draft_meta
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.consensus_draft_meta.locked IS
  'When true, this year is frozen: compile-consensus refuses to recompile it and the UI blocks Clear. User-toggled.';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('056_consensus_year_lock', 'Adds consensus_draft_meta.locked so a satisfactory compiled year can be frozen against accidental recompile/clear')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
