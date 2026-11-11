-- ============================================================
-- DynastyZeus — Migration 095
-- Run in the Supabase SQL editor right before the code that uses it deploys,
-- and don't log an Out and Up between the two: once this runs, the old
-- board's Other · Out and Up no longer saves, and until it runs, the new
-- board's Nine · Out and Up doesn't save. Every other play saves as before.
-- ============================================================
-- The user, 2026-11-11: Out and Up moves, whole, from the Other umbrella to
-- Nine (lib/scouting/routeVariants.ts), on every board. The sub-route keeps
-- its key, out_and_up; only the route above it changes. On the RB board it
-- now shows only when the back is split out wide (Nine isn't on the
-- backfield list), the user's call.
--
-- 1. Nine · Out and Up joins route_variant_options (074).
-- 2. Every Out and Up charted under Other moves to Nine: route_plays,
--    te_plays and qb_plays.route_type, rb_plays.route_detail. The RB bucket
--    (rb_plays.route_type) stays big_boy_route, the bucket both map to
--    (lib/scouting/rbRouteTree.ts). 3 WR plays on 2026-11-11, none on the
--    other boards. Nothing else on a play changes.
-- 3. Other · Out and Up leaves the list: the ONE delete here, one list row,
--    no play data, approved by the user 2026-11-11 ("move the entire Out and
--    Up sub route ... to the Nine umbrella"). It only runs once no play on
--    any table still uses the pair (the foreign keys would refuse it anyway).
--
-- No DROP or TRUNCATE. Re-runnable: ON CONFLICT, and the UPDATEs and the
-- DELETE match nothing a second time.
-- ============================================================

-- ── 1. The new pair ──────────────────────────────────────────
INSERT INTO public.route_variant_options (route_type, route_variant) VALUES
  ('nine', 'out_and_up')
ON CONFLICT (route_type, route_variant) DO NOTHING;

-- ── 2. The charted Out and Ups move to Nine ──────────────────
UPDATE public.route_plays SET route_type   = 'nine' WHERE route_type   = 'other' AND route_variant = 'out_and_up';
UPDATE public.te_plays    SET route_type   = 'nine' WHERE route_type   = 'other' AND route_variant = 'out_and_up';
UPDATE public.qb_plays    SET route_type   = 'nine' WHERE route_type   = 'other' AND route_variant = 'out_and_up';
UPDATE public.rb_plays    SET route_detail = 'nine' WHERE route_detail = 'other' AND route_variant = 'out_and_up';

-- ── 3. The old pair leaves the list, once nothing uses it ────
DELETE FROM public.route_variant_options
WHERE route_type = 'other' AND route_variant = 'out_and_up'
  AND NOT EXISTS (SELECT 1 FROM public.route_plays p WHERE p.route_type   = 'other' AND p.route_variant = 'out_and_up')
  AND NOT EXISTS (SELECT 1 FROM public.te_plays    p WHERE p.route_type   = 'other' AND p.route_variant = 'out_and_up')
  AND NOT EXISTS (SELECT 1 FROM public.qb_plays    p WHERE p.route_type   = 'other' AND p.route_variant = 'out_and_up')
  AND NOT EXISTS (SELECT 1 FROM public.rb_plays    p WHERE p.route_detail = 'other' AND p.route_variant = 'out_and_up');

NOTIFY pgrst, 'reload schema';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('095_out_and_up_to_nine', 'Out and Up moves from Other to Nine: Nine · Out and Up added to route_variant_options, charted Other · Out and Up plays moved to Nine (route_plays / te_plays / qb_plays route_type, rb_plays route_detail), Other · Out and Up removed from the list (user-approved)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
