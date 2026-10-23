-- ============================================================
-- DynastyZeus — Migration 075
-- Run in the Supabase SQL editor after migration 074, BEFORE the code that
-- uses it deploys: until this row is in, a QB throw charted as Other ·
-- Called Scramble Drill fails to save (every other play saves as before).
-- ============================================================
-- The user, 2026-10-22: Called Scramble Drill under Other, on the QB board
-- only (lib/scouting/routeVariants.ts, `boards: ["QB"]`). The list
-- route_variant_options (074) is shared by all three play tables, so the
-- database would also take it on a WR or TE play; only the QB board offers
-- the button.
--
-- Purely additive: one INSERT (ON CONFLICT DO NOTHING) and a ledger row. No
-- DROP, DELETE, TRUNCATE or UPDATE.
-- ============================================================

INSERT INTO public.route_variant_options (route_type, route_variant) VALUES
  ('other', 'called_scramble_drill')
ON CONFLICT (route_type, route_variant) DO NOTHING;

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('075_called_scramble_drill', 'Adds Other · Called Scramble Drill to route_variant_options (offered on the QB board only)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
