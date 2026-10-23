-- ============================================================
-- DynastyZeus — Migration 074
-- Run in the Supabase SQL editor after migration 073, BEFORE the code that
-- uses it deploys: the QB board writes qb_plays.route_variant on every new
-- throw (without this column every new QB play save fails), and a Zig saves
-- only once the list below has it.
-- ============================================================
-- The user, 2026-10-22: sub-routes on the QB board too (the same breakdown
-- of the 11 routes as WR and TE), and Zig under Other on all three boards.
--
-- 073 checked each sub-route against its route with a CHECK per table. A
-- CHECK can't be edited, so a new sub-route meant dropping it. By the user's
-- call (2026-10-22, asked first per the no-DROP rule) it's swapped, once,
-- for a list table: a sub-route is valid when (route_type, route_variant) is
-- a row of route_variant_options. From now on a new sub-route is an INSERT.
--
-- 1. public.route_variant_options, PK (route_type, route_variant): every
--    pair in ROUTE_VARIANTS (lib/scouting/routeVariants.ts), Zig included.
--    __tests__/lib/scouting/routeVariants.test.ts reads the INSERTs here and
--    in any later migration and compares them pair for pair. Read-only to
--    the app: rows come from migrations.
-- 2. qb_plays.route_variant: text, nullable, no default. NULL = charted
--    before sub-routes, a paste import, or not a throw.
-- 3. route_plays, te_plays and qb_plays each get a foreign key
--    (route_type, route_variant) → the list, plus a CHECK that a sub-route
--    has a route (a foreign key skips any row with a NULL in it). Existing
--    rows are checked as the keys go on; every sub-route charted so far
--    passed 073's CHECK, which allowed exactly these pairs minus Zig.
-- 4. Only once a table's key is on, its 073 CHECK is dropped
--    (route_plays_route_variant_check, te_plays_route_variant_check): the
--    ONE drop in this file, approved by the user 2026-10-22. It removes a
--    rule, not data: no row is changed or deleted.
--
-- No DELETE, TRUNCATE or UPDATE, and no other DROP. Grants + RLS on the new
-- table. Re-runnable: IF NOT EXISTS / ON CONFLICT / constraint checks.
-- ============================================================

-- ── 1. The list ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.route_variant_options (
  route_type    text NOT NULL,
  route_variant text NOT NULL,
  PRIMARY KEY (route_type, route_variant)
);

COMMENT ON TABLE public.route_variant_options IS
  'Every valid sub-route of each route bucket (lib/scouting/routeVariants.ts ROUTE_VARIANTS). route_plays / te_plays / qb_plays reference it. Add a sub-route with an INSERT in a new migration (migration 074).';

INSERT INTO public.route_variant_options (route_type, route_variant) VALUES
  ('screen',   'wr_screen'), ('screen', 'bubble'), ('screen', 'interior'),
  ('flat',     'true_flat'), ('flat', 'quick_out'),
  ('slant',    'drag'), ('slant', 'slant_stop'), ('slant', 'true_slant'), ('slant', 'deep_slant'),
  ('comeback', 'short'), ('comeback', 'intermediate'), ('comeback', 'deep'),
  ('curl',     'short'), ('curl', 'intermediate'), ('curl', 'deep'),
  ('out',      'intermediate'), ('out', 'deep'),
  ('dig',      'short'), ('dig', 'intermediate'), ('dig', 'deep'), ('dig', 'post_dig'),
  ('corner',   'short'), ('corner', 'intermediate'), ('corner', 'deep'),
  ('post',     'short'), ('post', 'intermediate'), ('post', 'deep'), ('post', 'post_sit'),
  ('nine',     'nine'), ('nine', 'back_shoulder_fade'), ('nine', 'seam'), ('nine', 'love_of_the_game'), ('nine', 'sluggo'), ('nine', 'stop_and_go'),
  ('other',    'option'), ('other', 'texas'), ('other', 'wheel'), ('other', 'block_release'), ('other', 'out_and_up'), ('other', 'zig')
ON CONFLICT (route_type, route_variant) DO NOTHING;

-- Explicit grants (Supabase removes implicit default grants, Oct 30 2026).
-- Signed-in users read it; nobody but the service role writes it.
GRANT SELECT ON public.route_variant_options TO authenticated;
GRANT ALL    ON public.route_variant_options TO service_role;

ALTER TABLE public.route_variant_options ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'route_variant_options' AND policyname = 'route_variant_options_select'
  ) THEN
    CREATE POLICY route_variant_options_select ON public.route_variant_options
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ── 2. QB sub-routes ─────────────────────────────────────────
ALTER TABLE public.qb_plays ADD COLUMN IF NOT EXISTS route_variant text;

COMMENT ON COLUMN public.qb_plays.route_variant IS
  'Sub-route of route_type (data collection only, lib/scouting/routeVariants.ts). NULL = charted before sub-routes, a paste import, or not a throw (migration 074).';

-- ── 3. Each play table checks its sub-routes against the list ─
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['route_plays', 'te_plays', 'qb_plays'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = tbl || '_route_variant_fkey' AND conrelid = ('public.' || tbl)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (route_type, route_variant) REFERENCES public.route_variant_options (route_type, route_variant)',
        tbl, tbl || '_route_variant_fkey');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = tbl || '_route_variant_needs_route' AND conrelid = ('public.' || tbl)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (route_variant IS NULL OR route_type IS NOT NULL)',
        tbl, tbl || '_route_variant_needs_route');
    END IF;
  END LOOP;
END $$;

-- ── 4. The one approved drop: 073's CHECKs, once each key is on ─
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['route_plays', 'te_plays'] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = tbl || '_route_variant_fkey' AND conrelid = ('public.' || tbl)::regclass
    ) THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', tbl, tbl || '_route_variant_check');
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
    VALUES ('074_route_variant_options', 'Sub-route list table (route_variant_options, Zig added under Other); qb_plays.route_variant; route_plays / te_plays / qb_plays check sub-routes by foreign key; 073''s two CHECKs dropped (user-approved)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
