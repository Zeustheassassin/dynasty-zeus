-- ============================================================
-- DynastyZeus — Migration 081
-- Run in the Supabase SQL editor after migration 080, BEFORE the code that
-- uses it deploys: until this table exists the Management Hub's LeagueSafe
-- tab loads empty and every link save fails ("LeagueSafe link didn't save").
-- ============================================================
-- The user, 2026-10-24: keep every league's LeagueSafe link for each season,
-- and on Commissioner Tools show which seasons have no LeagueSafe created
-- yet. The window is the same four calendar years as the Paid columns
-- (getPaymentYears: this year + 3, so 2026–2029 in 2026, 2028–2031 in 2028).
--
-- One row per (user, league, season) instead of a url_<year> column per
-- year, so there is no column ceiling to extend the way migrations 002 and
-- 036 extend paid_<year>. Per-user like league_bylaws (046): each app
-- account keeps its own copy of a Sleeper league's links.
--
-- league_id is the Sleeper league_id the link was saved under. Sleeper gives
-- a renewed dynasty league a new league_id every season, so the app reads a
-- league's links through previous_league_id and copies them onto the renewed
-- league (lib/helpers/leagueSafe.ts). url = '' means the user cleared that
-- season; the check keeps anything but an http(s) link out.
--
-- Additive: no DELETE, TRUNCATE, ALTER on an existing table, or DROP of a
-- table, column or row. The one DROP is DROP POLICY IF EXISTS on this new
-- table's own policy, recreated identically on the next line so the file can
-- re-run; on a first run it drops nothing. The SQL editor flags it as
-- "destructive" anyway.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.leaguesafe_links (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  league_id  text        NOT NULL,
  season     integer     NOT NULL CHECK (season BETWEEN 2000 AND 2100),
  url        text        NOT NULL DEFAULT ''
                         CHECK (url = '' OR (url ~* '^https?://' AND char_length(url) <= 2000)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, league_id, season)
);

ALTER TABLE public.leaguesafe_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leaguesafe_links_self" ON public.leaguesafe_links;
CREATE POLICY "leaguesafe_links_self" ON public.leaguesafe_links FOR ALL
  USING      (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- Explicit grants: Supabase removes implicit default grants on new objects
-- (Oct 30 2026). The Management Hub writes as the signed-in user's own
-- authenticated client (RLS-scoped), never the service role.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leaguesafe_links TO authenticated;
GRANT ALL                            ON public.leaguesafe_links TO service_role;

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('081_leaguesafe_links', 'per-user LeagueSafe link per league per season for Management Hub')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
