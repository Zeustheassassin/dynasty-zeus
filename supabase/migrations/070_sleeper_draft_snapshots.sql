-- ============================================================
-- DynastyZeus — Migration 070
-- Run in the Supabase SQL editor after migration 069. Safe before or after
-- the code deploys: until these tables exist, every read fails and is treated
-- as "nothing saved" and every write is logged and skipped
-- (lib/server/draftSnapshots.ts), so Draft History and the consensus compile
-- just fetch from Sleeper as they did before.
-- ============================================================
-- Draft History snapshots (Sleeper call-budget follow-up). A completed rookie
-- draft never changes, so it is saved once and read from here afterwards
-- instead of asking Sleeper for it on every Draft History visit and every
-- compile.
--
-- 1. sleeper_draft_snapshots: one row per COMPLETED rookie-length draft
--    (6 rounds or fewer), holding its picks trimmed to the fields the app
--    reads (pick_no, round, draft_slot, player_id, picked_by and the name /
--    position / team / years_exp metadata). Written only once a draft's
--    status is "complete", and never overwritten (ON CONFLICT DO NOTHING).
--    Shared by every user: a draft's picks are the same whoever asks, so a
--    league two users share is saved once. Both Draft History
--    (/api/draft-history) and the consensus compile write it.
--
-- 2. sleeper_league_seasons: one row per Sleeper league-season Draft History
--    has looked at, with that season's previous_league_id (the chain History
--    walks back through) and its completed rookie-length draft ids. `final`
--    means the list can't change any more: a past season, or this season once
--    the NFL regular season is under way and no rookie draft is still open.
--    A final row is never re-checked, which is what keeps History at zero
--    Sleeper calls in season once a league's drafts are saved. Rows that
--    aren't final yet are re-checked on the next visit and updated in place.
--
-- Server-only: both tables are read and written through the service role by
-- the server, which only stores what it fetched from Sleeper itself.
-- anon / authenticated get no access, so a browser can't read them or plant
-- fake picks that every other user would then see.
--
-- Purely additive: CREATE TABLE IF NOT EXISTS, policies created only when
-- missing, explicit grants / revokes, ledger row. No DROP, DELETE or TRUNCATE.
--
-- Quick look:
--   SELECT season, count(*), pg_size_pretty(sum(pg_column_size(picks)))
--   FROM public.sleeper_draft_snapshots GROUP BY season ORDER BY season;
--   SELECT final, count(*) FROM public.sleeper_league_seasons GROUP BY final;
-- ============================================================

-- ── 1. Completed drafts' picks ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.sleeper_draft_snapshots (
  draft_id    text        PRIMARY KEY,
  league_id   text,
  season      text        NOT NULL CHECK (season ~ '^[0-9]{4}$'),
  rounds      smallint,
  pick_count  integer     NOT NULL CHECK (pick_count > 0),
  picks       jsonb       NOT NULL,
  saved_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sleeper_draft_snapshots IS
  'Picks of completed rookie-length Sleeper drafts, saved once and never overwritten. Server-only (service role) — lib/server/draftSnapshots.ts.';
COMMENT ON COLUMN public.sleeper_draft_snapshots.picks IS
  'Sleeper picks trimmed to pick_no, round, draft_slot, player_id, picked_by and metadata {first_name, last_name, position, team, years_exp}.';

-- ── 2. League-seasons and their completed rookie drafts ──────
CREATE TABLE IF NOT EXISTS public.sleeper_league_seasons (
  league_id          text        PRIMARY KEY,
  season             text        NOT NULL CHECK (season ~ '^[0-9]{4}$'),
  previous_league_id text,
  rookie_draft_ids   text[]      NOT NULL DEFAULT '{}',
  final              boolean     NOT NULL DEFAULT false,
  checked_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sleeper_league_seasons IS
  'Draft History''s view of a Sleeper league-season: previous_league_id + completed rookie-length draft ids. final = never re-checked. Server-only — lib/server/draftSnapshots.ts.';

-- ── 3. Access: service role only ─────────────────────────────
ALTER TABLE public.sleeper_draft_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sleeper_league_seasons  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sleeper_draft_snapshots' AND policyname = 'sleeper_draft_snapshots_service'
  ) THEN
    CREATE POLICY "sleeper_draft_snapshots_service" ON public.sleeper_draft_snapshots
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sleeper_league_seasons' AND policyname = 'sleeper_league_seasons_service'
  ) THEN
    CREATE POLICY "sleeper_league_seasons_service" ON public.sleeper_league_seasons
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Explicit grants (Supabase removes implicit default grants, Oct 30 2026). The
-- revokes undo any default privileges the project still hands new objects.
REVOKE ALL ON public.sleeper_draft_snapshots FROM anon, authenticated;
REVOKE ALL ON public.sleeper_league_seasons  FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sleeper_draft_snapshots TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.sleeper_league_seasons  TO service_role;

-- PostgREST picks up the new tables.
NOTIFY pgrst, 'reload schema';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('070_sleeper_draft_snapshots', 'sleeper_draft_snapshots + sleeper_league_seasons (saved completed rookie drafts for Draft History and the consensus compile)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
