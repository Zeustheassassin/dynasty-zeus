-- ============================================================
-- DynastyZeus — Migration 077
-- Run in the Supabase SQL editor after migration 076, BEFORE the code that
-- uses it deploys: a new RB play writes route_detail and route_variant, so
-- without them every new RB play save fails.
-- ============================================================
-- The user, 2026-10-23, on the RB board:
--
-- 1. An RB route is charted off the WR / TE route tree with its sub-route,
--    not as one of three buckets: in the backfield Screen / Flat / Curl /
--    Other, split out wide all 11 routes (lib/scouting/rbRouteTree.ts).
--    rb_plays.route_detail (one of the 11 routes) and rb_plays.route_variant
--    (its sub-route), text, nullable, no default. NULL = charted before the
--    tree (the bucket only), or not a route.
--    - route_detail: one of the 11 routes, and only on a route play.
--    - (route_detail, route_variant) → public.route_variant_options, the same
--      list WR / TE / QB use (074); a sub-route needs a route.
--    route_type (the bucket, 014) is untouched: new routes still save one
--    (the user's mapping, rbBucketFor), so everything that reads it — the
--    Receiving role, the board's breakdown — keeps working as charted.
--    Data collection only for now (the user's call).
--
-- 2. aligned_as_wr is asked on every play now, not only routes. No schema
--    change (it's NOT NULL DEFAULT false already); its comment says so.
--    Plays charted before read false off routes.
--
-- Additive only: no DROP, DELETE, TRUNCATE or UPDATE. No row is changed.
-- Re-runnable.
-- ============================================================

-- ── 1. The route off the tree, and its sub-route ─────────────
ALTER TABLE public.rb_plays ADD COLUMN IF NOT EXISTS route_detail  text;
ALTER TABLE public.rb_plays ADD COLUMN IF NOT EXISTS route_variant text;

COMMENT ON COLUMN public.rb_plays.route_detail IS
  'The route off the WR / TE tree (backfield: screen / flat / curl / other; split out: any of the 11). NULL = charted before the tree (route_type only) or not a route. route_type is saved from it (lib/scouting/rbRouteTree.ts, migration 077).';
COMMENT ON COLUMN public.rb_plays.route_variant IS
  'Sub-route of route_detail (data collection only, lib/scouting/routeVariants.ts). NULL = charted before the tree or not a route (migration 077).';
COMMENT ON COLUMN public.rb_plays.aligned_as_wr IS
  'Split out wide at the snap. Asked on every play from migration 077 on; before that only on routes (other plays read false).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rb_plays_route_detail_check' AND conrelid = 'public.rb_plays'::regclass
  ) THEN
    ALTER TABLE public.rb_plays ADD CONSTRAINT rb_plays_route_detail_check
      CHECK (route_detail IS NULL OR route_detail IN ('nine', 'post', 'dig', 'curl', 'slant', 'screen', 'flat', 'comeback', 'out', 'corner', 'other'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rb_plays_route_detail_on_route' AND conrelid = 'public.rb_plays'::regclass
  ) THEN
    ALTER TABLE public.rb_plays ADD CONSTRAINT rb_plays_route_detail_on_route
      CHECK (route_detail IS NULL OR run_type = 'route');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rb_plays_route_variant_fkey' AND conrelid = 'public.rb_plays'::regclass
  ) THEN
    ALTER TABLE public.rb_plays ADD CONSTRAINT rb_plays_route_variant_fkey
      FOREIGN KEY (route_detail, route_variant) REFERENCES public.route_variant_options (route_type, route_variant);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rb_plays_route_variant_needs_route' AND conrelid = 'public.rb_plays'::regclass
  ) THEN
    ALTER TABLE public.rb_plays ADD CONSTRAINT rb_plays_route_variant_needs_route
      CHECK (route_variant IS NULL OR route_detail IS NOT NULL);
  END IF;
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
    VALUES ('077_rb_route_tree', 'rb_plays.route_detail + route_variant (RB routes off the WR / TE tree, sub-routes checked against route_variant_options); route_type bucket kept; aligned_as_wr asked on every play')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
