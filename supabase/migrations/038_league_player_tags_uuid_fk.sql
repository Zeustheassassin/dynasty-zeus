-- ============================================================
-- DynastyZeus — Migration 038
-- Run in the Supabase SQL editor after migration 037.
-- ⚠️  TAKE A BACKUP FIRST (scripts/backup-supabase.bat).
-- ============================================================
-- Audit batch B8 (STRONGER version — user opted in): bring the LIVE
-- public.league_player_tags.user_id to the canonical uuid + FK design
-- (the "align-files-only" pass left the live column whatever it was).
--
-- Self-checking, idempotent, and transaction-safe:
--   • The RLS policy is DROPPED FIRST: Postgres refuses to ALTER the
--     type of a column a policy depends on, so it must be dropped before
--     the conversion and recreated after. It is all one transaction, so
--     other sessions never see RLS disabled.
--   • If user_id is ALREADY uuid, no type change happens — only the FK
--     and the (uuid-safe) policy are ensured.
--   • If user_id is text, EVERY value is validated as a uuid first; if
--     any row is not a uuid the migration RAISES and rolls back with
--     zero changes (no data loss), then you inspect those rows.
--   • The FK to auth.users(id) ON DELETE CASCADE is added only if absent.
--     If orphan rows exist (a user_id with no auth.users match) the FK
--     add fails and the whole migration rolls back — nothing is deleted.
-- The entire file runs as one transaction: all-or-nothing.
-- ============================================================

-- ── 1. Drop the RLS policy so the column is not policy-locked ──
-- (recreated uuid-safe in step 4; the type change below cannot run while
--  a policy references user_id).
DROP POLICY IF EXISTS "league_player_tags_self" ON public.league_player_tags;

-- ── 2. Convert user_id text → uuid (only if needed, validated first) ──
DO $$
DECLARE
  col_type  text;
  bad_count bigint;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'league_player_tags'
    AND column_name  = 'user_id';

  IF col_type IS NULL THEN
    RAISE EXCEPTION 'public.league_player_tags.user_id not found — aborting.';
  END IF;

  IF col_type = 'text' THEN
    SELECT count(*) INTO bad_count
    FROM public.league_player_tags
    WHERE user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

    IF bad_count > 0 THEN
      RAISE EXCEPTION
        'Cannot convert league_player_tags.user_id to uuid: % row(s) have a non-uuid value. Inspect/fix them, then re-run.',
        bad_count;
    END IF;

    ALTER TABLE public.league_player_tags
      ALTER COLUMN user_id TYPE uuid USING user_id::uuid;
  END IF;
END $$;

-- ── 3. Add the FK to auth.users ON DELETE CASCADE (if not already there) ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.league_player_tags'::regclass
      AND contype  = 'f'
  ) THEN
    ALTER TABLE public.league_player_tags
      ADD CONSTRAINT league_player_tags_user_fk
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 4. Recreate the RLS policy in uuid-safe form ──
CREATE POLICY "league_player_tags_self" ON public.league_player_tags
  FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- ── 5. Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('038_league_player_tags_uuid_fk', 'uuid + FK to auth.users (stronger reconcile)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
