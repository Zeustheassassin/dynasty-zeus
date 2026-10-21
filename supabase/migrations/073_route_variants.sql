-- ============================================================
-- DynastyZeus — Migration 073
-- Run in the Supabase SQL editor after migration 072, BEFORE the code that
-- uses it deploys: the WR and TE charting boards write route_variant on
-- every new route, so without this column every new WR / TE play save fails.
-- ============================================================
-- Sub-routes (the user, 2026-10-21): each of the 11 route buckets breaks
-- down into the kind of route it was (a 3-yard hitch vs a 12-yard curl).
-- route_type stays the data driver; route_variant is DATA COLLECTION ONLY
-- for now, so no view, grade or model reads it (lib/scouting/routeVariants.ts).
--
-- 1. route_plays.route_variant and te_plays.route_variant: text, nullable,
--    no default. NULL = charted before sub-routes, a paste import, or a play
--    with no route (WR "No Route Run", TE block / decoy).
--
-- 2. A CHECK per table that the sub-route belongs to the play's route
--    (keys are per route: 'short' is a Curl, Comeback, Dig, Corner or Post
--    depth). Depths are PFF's bands, by the user's call: short 0–9,
--    intermediate 10–19, deep 20+ yards. The pairs must match
--    ROUTE_VARIANTS in lib/scouting/routeVariants.ts
--    (__tests__/lib/scouting/routeVariants.test.ts reads this file).
--
-- Purely additive: ADD COLUMN IF NOT EXISTS (nullable, no default, so no
-- table rewrite), CHECKs added only when missing (every existing row is
-- NULL, so each validates instantly), ledger row. The existing grants and
-- owner-only RLS on route_plays / te_plays cover the new columns. No DROP,
-- DELETE or TRUNCATE.
-- ============================================================

ALTER TABLE public.route_plays ADD COLUMN IF NOT EXISTS route_variant text;
ALTER TABLE public.te_plays    ADD COLUMN IF NOT EXISTS route_variant text;

COMMENT ON COLUMN public.route_plays.route_variant IS 'Sub-route of route_type (data collection only, lib/scouting/routeVariants.ts). NULL = charted before sub-routes, a paste import, or no route run (migration 073).';
COMMENT ON COLUMN public.te_plays.route_variant    IS 'Sub-route of route_type (data collection only, lib/scouting/routeVariants.ts). NULL = not a route, or charted before sub-routes (migration 073).';

-- ── The sub-route must belong to the route ───────────────────
-- (CASE, not ORs: ELSE false also rejects a sub-route on a play with no
-- route_type, which an OR chain over a NULL would let through.)
DO $$
DECLARE
  tbl text;
  pairs constant text :=
    'route_variant IS NULL OR CASE route_type
       WHEN ''screen''   THEN route_variant IN (''wr_screen'', ''bubble'', ''interior'')
       WHEN ''flat''     THEN route_variant IN (''true_flat'', ''quick_out'')
       WHEN ''slant''    THEN route_variant IN (''drag'', ''slant_stop'', ''true_slant'', ''deep_slant'')
       WHEN ''comeback'' THEN route_variant IN (''short'', ''intermediate'', ''deep'')
       WHEN ''curl''     THEN route_variant IN (''short'', ''intermediate'', ''deep'')
       WHEN ''out''      THEN route_variant IN (''intermediate'', ''deep'')
       WHEN ''dig''      THEN route_variant IN (''short'', ''intermediate'', ''deep'', ''post_dig'')
       WHEN ''corner''   THEN route_variant IN (''short'', ''intermediate'', ''deep'')
       WHEN ''post''     THEN route_variant IN (''short'', ''intermediate'', ''deep'', ''post_sit'')
       WHEN ''nine''     THEN route_variant IN (''nine'', ''back_shoulder_fade'', ''seam'', ''love_of_the_game'', ''sluggo'', ''stop_and_go'')
       WHEN ''other''    THEN route_variant IN (''option'', ''texas'', ''wheel'', ''block_release'', ''out_and_up'')
       ELSE false
     END';
BEGIN
  FOREACH tbl IN ARRAY ARRAY['route_plays', 'te_plays'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = tbl || '_route_variant_check'
        AND conrelid = ('public.' || tbl)::regclass
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s)', tbl, tbl || '_route_variant_check', pairs);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('073_route_variants', 'Adds route_plays.route_variant and te_plays.route_variant (sub-routes of the 11 route buckets, data collection only) with a CHECK that each sub-route belongs to its route')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
