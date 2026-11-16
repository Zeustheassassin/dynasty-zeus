-- ============================================================
-- DynastyZeus — Migration 101
-- Run in the Supabase SQL editor after migration 100. The code that uses it
-- can deploy first: until this runs, the Unwatched tab lists the games as
-- usual, and saving a tape source fails with a message.
-- ============================================================
-- scouting_games.tape_source: where the user's tape of a logged game is, e.g.
-- 'Dynasty Nerds', or a link. Set on Scouting → Unwatched, for the games not
-- charted yet; it stays on the game once it's charted.
--
--   tape_source  text, up to 300 characters (room for a link); null = not set
--
-- Per user under the existing owner-only RLS on scouting_games
-- ("scouting_games_self", migration 007; grants in 050).
--
-- Purely additive: ADD COLUMN IF NOT EXISTS (nullable, no default), CHECK
-- added only when missing, ledger row. No DROP, DELETE or TRUNCATE.
-- ============================================================

ALTER TABLE public.scouting_games ADD COLUMN IF NOT EXISTS tape_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scouting_games_tape_source_length'
      AND conrelid = 'public.scouting_games'::regclass
  ) THEN
    ALTER TABLE public.scouting_games
      ADD CONSTRAINT scouting_games_tape_source_length
      CHECK (tape_source IS NULL OR char_length(tape_source) BETWEEN 1 AND 300);
  END IF;
END $$;

COMMENT ON COLUMN public.scouting_games.tape_source IS
  'Where the tape of this game is, e.g. Dynasty Nerds or a link (migration 101; Scouting → Unwatched). Null = not set.';

-- PostgREST picks up the new column.
NOTIFY pgrst, 'reload schema';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('101_scouting_game_tape_source', 'scouting_games.tape_source: where the tape of a logged game is (Unwatched tab)')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
