-- ============================================================
-- DynastyZeus — Migration 039
-- Run in the Supabase SQL editor after migration 038.
-- ⚠️  TAKE A BACKUP FIRST (scripts/backup-supabase.bat).
-- ============================================================
-- Audit batch B8 (STRONGER version — user opted in): add the FK that
-- migration 013 omitted, from public.gm_briefings.user_id to
-- auth.users(id) ON DELETE CASCADE, so deleting a user cleans up their
-- briefings instead of leaving orphan rows.
--
-- NON-DESTRUCTIVE: this only ADDS a constraint — it deletes nothing.
-- If orphan rows exist (a briefing whose user_id has no auth.users
-- match), the ADD CONSTRAINT fails and the whole migration rolls back.
-- That is intentional: nothing is deleted automatically. If it fails,
-- inspect the orphans:
--   SELECT b.* FROM public.gm_briefings b
--   LEFT JOIN auth.users u ON u.id = b.user_id
--   WHERE u.id IS NULL;
-- …decide whether to delete them, then re-run. (gm_briefings is not
-- queried by the app yet, so it is most likely empty / orphan-free.)
-- Idempotent: re-running after success is a no-op.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.gm_briefings'::regclass
      AND contype  = 'f'
  ) THEN
    ALTER TABLE public.gm_briefings
      ADD CONSTRAINT gm_briefings_user_fk
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Record in the migration ledger (no-op if 037 not yet applied).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('039_gm_briefings_fk', 'FK gm_briefings.user_id -> auth.users ON DELETE CASCADE')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
