-- ============================================================
-- DynastyZeus — Migration 106
-- Run in the Supabase SQL editor after migration 105. The code that uses it
-- can deploy first: until this runs, Analysis → Grading checks → Due now
-- lists every check as usual, but its Mark done buttons stay off ("needs
-- migration 106"), and Chart Next keeps hiding the slow-tape conferences.
-- ============================================================
-- scouting_due_marks: the user's "done" marks on the Due now list (stage 2 of
-- the 2026-11-26 scouting plan), so a check marked on one device is done on
-- every device.
--
--   item_key  which check, e.g. 'catapult', 'fill_40s', 'consensus_upload'
--   cycle     which round of it: a class year ('2027'), a year and a stage
--             ('2027-combine'), a model and a tag ('wr:red_zone'), or '' for
--             one that repeats (consensus_upload keeps its latest mark)
--   value     a choice made with it, e.g. the Catapult call ('access' /
--             'no_access'); null for a plain done
--   done_at   when it was marked
--
-- One row per user per check per cycle. Marking again moves done_at; un-marking
-- deletes the row (the app does that through the owner-only policy).
--
-- Purely additive: CREATE TABLE IF NOT EXISTS, explicit grants, RLS + policy
-- created only when missing, ledger row. No DROP, DELETE or TRUNCATE.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.scouting_due_marks (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  item_key  text        NOT NULL CHECK (item_key ~ '^[a-z0-9_]{1,64}$'),
  cycle     text        NOT NULL DEFAULT '' CHECK (char_length(cycle) <= 64),
  value     text        CHECK (value IS NULL OR char_length(value) BETWEEN 1 AND 64),
  done_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_key, cycle)
);

COMMENT ON TABLE public.scouting_due_marks IS
  'Done marks on Scouting → Analysis → Grading checks → Due now (migration 106): one row per user, check (item_key) and cycle; value = a choice made with it.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scouting_due_marks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scouting_due_marks TO service_role;

ALTER TABLE public.scouting_due_marks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'scouting_due_marks' AND policyname = 'Users manage their own due marks'
  ) THEN
    CREATE POLICY "Users manage their own due marks"
      ON public.scouting_due_marks
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- PostgREST picks up the new table.
NOTIFY pgrst, 'reload schema';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('106_scouting_due_marks', 'scouting_due_marks: Due now list done marks (Analysis → Grading checks), per user, check and cycle')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
