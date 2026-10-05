-- ============================================================
-- DynastyZeus — Migration 062
-- Run in the Supabase SQL editor after migration 061.
-- ============================================================
-- Stage 1 (Foundation) of the tape-grading expansion. Two parts, both
-- columns only; nothing reads them for grades yet.
--
-- 1. Per-play tag columns on qb_plays, rb_plays, route_plays (WR) and
--    te_plays, for the approved tags the charting boards will gain in
--    Stage 3. Every tag column is NULLABLE with NO DEFAULT on purpose:
--      NULL     = the play was charted before the tags existed (untagged)
--      non-NULL = the play was tagged (new plays save every tag, defaults
--                 included; editing an old play leaves its tags NULL)
--    lib/scouting/playEra.ts reads this. Existing NOT NULL DEFAULT false
--    columns are NOT reused (rb_plays.broken_tackle is forced false on
--    routes, so old rows would read "no" instead of "unknown").
--    The four situation tags go on all four tables:
--      red_zone · third_fourth_down · short_yardage (incl. goal line) ·
--      garbage_time
--
-- 2. PFF links: prospects.pff_player_id and scouting_games.pff_game_id, each
--    with a match status and a short note. Written by /api/pff/match (as the
--    signed-in user, under the tables' owner-only RLS) and confirmed or
--    overridden in Scouting → PFF Links. Per user, like every scouting row;
--    no shared view reads them.
--
-- Purely additive: ADD COLUMN IF NOT EXISTS (nullable, no default, so no
-- table rewrite) and CHECK constraints added only when missing. No DROP,
-- DELETE or TRUNCATE.
-- ============================================================

-- ── 1. Tag columns ───────────────────────────────────────────

ALTER TABLE public.qb_plays
  ADD COLUMN IF NOT EXISTS red_zone             boolean,
  ADD COLUMN IF NOT EXISTS third_fourth_down    boolean,
  ADD COLUMN IF NOT EXISTS short_yardage        boolean,
  ADD COLUMN IF NOT EXISTS garbage_time         boolean,
  ADD COLUMN IF NOT EXISTS play_action          boolean,
  ADD COLUMN IF NOT EXISTS tight_window         boolean,
  ADD COLUMN IF NOT EXISTS release_timing       text,
  ADD COLUMN IF NOT EXISTS better_option_missed boolean,
  ADD COLUMN IF NOT EXISTS sack_fault           text,
  ADD COLUMN IF NOT EXISTS run_success          boolean,
  ADD COLUMN IF NOT EXISTS run_broken_tackle    boolean,
  ADD COLUMN IF NOT EXISTS run_explosive        boolean;

ALTER TABLE public.rb_plays
  ADD COLUMN IF NOT EXISTS red_zone                  boolean,
  ADD COLUMN IF NOT EXISTS third_fourth_down         boolean,
  ADD COLUMN IF NOT EXISTS short_yardage             boolean,
  ADD COLUMN IF NOT EXISTS garbage_time              boolean,
  ADD COLUMN IF NOT EXISTS hit_behind_line           boolean,
  ADD COLUMN IF NOT EXISTS missed_read               boolean,
  ADD COLUMN IF NOT EXISTS pass_pro_loss             text,
  ADD COLUMN IF NOT EXISTS broken_tackle_after_catch boolean,
  ADD COLUMN IF NOT EXISTS caught_from_behind        boolean;

ALTER TABLE public.route_plays
  ADD COLUMN IF NOT EXISTS red_zone                  boolean,
  ADD COLUMN IF NOT EXISTS third_fourth_down         boolean,
  ADD COLUMN IF NOT EXISTS short_yardage             boolean,
  ADD COLUMN IF NOT EXISTS garbage_time              boolean,
  ADD COLUMN IF NOT EXISTS press_release             text,
  ADD COLUMN IF NOT EXISTS broken_tackle_after_catch boolean;

ALTER TABLE public.te_plays
  ADD COLUMN IF NOT EXISTS red_zone             boolean,
  ADD COLUMN IF NOT EXISTS third_fourth_down    boolean,
  ADD COLUMN IF NOT EXISTS short_yardage        boolean,
  ADD COLUMN IF NOT EXISTS garbage_time         boolean,
  ADD COLUMN IF NOT EXISTS blocked_defender     text,
  ADD COLUMN IF NOT EXISTS press_release        text,
  ADD COLUMN IF NOT EXISTS chipped_before_route boolean;

-- ── 2. PFF link columns ──────────────────────────────────────

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS pff_player_id    integer,
  ADD COLUMN IF NOT EXISTS pff_match_status text,
  ADD COLUMN IF NOT EXISTS pff_match_note   text;

ALTER TABLE public.scouting_games
  ADD COLUMN IF NOT EXISTS pff_game_id      integer,
  ADD COLUMN IF NOT EXISTS pff_match_status text,
  ADD COLUMN IF NOT EXISTS pff_match_note   text;

-- ── CHECK constraints (added only when missing; existing rows are all
--    NULL in the new columns, so each validates instantly) ──
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('qb_plays',       'qb_plays_release_timing_check',
       'release_timing IS NULL OR release_timing IN (''early'', ''on_time'', ''late'')'),
    ('qb_plays',       'qb_plays_sack_fault_check',
       'sack_fault IS NULL OR sack_fault IN (''qb'', ''line'', ''coverage'')'),
    ('rb_plays',       'rb_plays_pass_pro_loss_check',
       'pass_pro_loss IS NULL OR pass_pro_loss IN (''wrong_man'', ''beaten'')'),
    ('route_plays',    'route_plays_press_release_check',
       'press_release IS NULL OR press_release IN (''won'', ''lost'')'),
    ('te_plays',       'te_plays_press_release_check',
       'press_release IS NULL OR press_release IN (''won'', ''lost'')'),
    ('te_plays',       'te_plays_blocked_defender_check',
       'blocked_defender IS NULL OR blocked_defender IN (''dl'', ''lb'', ''db'')'),
    -- auto / confirmed carry a player; not_found / none never do; review may
    -- carry a best guess. No status = never matched = no player. (CASE, not
    -- ORs: an OR chain over a NULL status evaluates to NULL, which a CHECK
    -- lets through.)
    ('prospects',      'prospects_pff_match_status_check',
       'pff_match_status IS NULL OR pff_match_status IN (''auto'', ''confirmed'', ''review'', ''not_found'', ''none'')'),
    ('prospects',      'prospects_pff_link_consistent',
       'CASE
          WHEN pff_match_status IS NULL                     THEN pff_player_id IS NULL
          WHEN pff_match_status IN (''auto'', ''confirmed'') THEN pff_player_id IS NOT NULL
          WHEN pff_match_status IN (''not_found'', ''none'') THEN pff_player_id IS NULL
          ELSE true
        END'),
    -- not_charted may keep the PFF game id (the game exists in PFF but has
    -- no row for him); no_match / no_player / none never carry one.
    ('scouting_games', 'scouting_games_pff_match_status_check',
       'pff_match_status IS NULL OR pff_match_status IN (''auto'', ''confirmed'', ''review'', ''not_charted'', ''no_match'', ''no_player'', ''none'')'),
    ('scouting_games', 'scouting_games_pff_link_consistent',
       'CASE
          WHEN pff_match_status IS NULL                                  THEN pff_game_id IS NULL
          WHEN pff_match_status IN (''auto'', ''confirmed'')              THEN pff_game_id IS NOT NULL
          WHEN pff_match_status IN (''no_match'', ''no_player'', ''none'') THEN pff_game_id IS NULL
          ELSE true
        END')
  ) AS t(tbl, name, expr)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = c.name AND conrelid = ('public.' || c.tbl)::regclass
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s)', c.tbl, c.name, c.expr);
    END IF;
  END LOOP;
END $$;

-- ── Column docs ──────────────────────────────────────────────
COMMENT ON COLUMN public.qb_plays.red_zone             IS 'Tag (sticky). NULL = charted before tags existed.';
COMMENT ON COLUMN public.qb_plays.third_fourth_down    IS 'Tag (exception): 3rd or 4th down. NULL = untagged play.';
COMMENT ON COLUMN public.qb_plays.short_yardage        IS 'Tag (exception): short yardage or goal line. NULL = untagged play.';
COMMENT ON COLUMN public.qb_plays.garbage_time         IS 'Tag (sticky). NULL = untagged play.';
COMMENT ON COLUMN public.qb_plays.play_action          IS 'Tag (exception). NULL = untagged play.';
COMMENT ON COLUMN public.qb_plays.tight_window         IS 'Tag (exception). NULL = untagged play.';
COMMENT ON COLUMN public.qb_plays.release_timing       IS 'Tag (pre-selected on_time): early / on_time / late. NULL = untagged play.';
COMMENT ON COLUMN public.qb_plays.better_option_missed IS 'Tag (exception). NULL = untagged play.';
COMMENT ON COLUMN public.qb_plays.sack_fault           IS 'Tag (sacks only, pre-selected line): qb / line / coverage.';
COMMENT ON COLUMN public.qb_plays.run_success          IS 'Tag (runs and scrambles only): run result, no yards.';
COMMENT ON COLUMN public.qb_plays.run_broken_tackle    IS 'Tag (runs and scrambles only).';
COMMENT ON COLUMN public.qb_plays.run_explosive        IS 'Tag (runs and scrambles only).';

COMMENT ON COLUMN public.rb_plays.red_zone                  IS 'Tag (sticky). NULL = charted before tags existed.';
COMMENT ON COLUMN public.rb_plays.third_fourth_down         IS 'Tag (exception): 3rd or 4th down. NULL = untagged play.';
COMMENT ON COLUMN public.rb_plays.short_yardage             IS 'Tag (exception): short yardage or goal line. NULL = untagged play.';
COMMENT ON COLUMN public.rb_plays.garbage_time              IS 'Tag (sticky). NULL = untagged play.';
COMMENT ON COLUMN public.rb_plays.hit_behind_line           IS 'Tag (exception). NULL = untagged play.';
COMMENT ON COLUMN public.rb_plays.missed_read               IS 'Tag (exception). NULL = untagged play.';
COMMENT ON COLUMN public.rb_plays.pass_pro_loss             IS 'Tag (pass-pro losses only): wrong_man / beaten.';
COMMENT ON COLUMN public.rb_plays.broken_tackle_after_catch IS 'Tag (catches only). Separate from broken_tackle, which is NOT NULL DEFAULT false.';
COMMENT ON COLUMN public.rb_plays.caught_from_behind        IS 'Tag (explosive runs only).';

COMMENT ON COLUMN public.route_plays.red_zone                  IS 'Tag (sticky). NULL = charted before tags existed.';
COMMENT ON COLUMN public.route_plays.third_fourth_down         IS 'Tag (exception): 3rd or 4th down. NULL = untagged play.';
COMMENT ON COLUMN public.route_plays.short_yardage             IS 'Tag (exception): short yardage or goal line. NULL = untagged play.';
COMMENT ON COLUMN public.route_plays.garbage_time              IS 'Tag (sticky). NULL = untagged play.';
COMMENT ON COLUMN public.route_plays.press_release             IS 'Tag (press snaps only, one required click): won / lost.';
COMMENT ON COLUMN public.route_plays.broken_tackle_after_catch IS 'Tag (catches only).';

COMMENT ON COLUMN public.te_plays.red_zone             IS 'Tag (sticky). NULL = charted before tags existed.';
COMMENT ON COLUMN public.te_plays.third_fourth_down    IS 'Tag (exception): 3rd or 4th down. NULL = untagged play.';
COMMENT ON COLUMN public.te_plays.short_yardage        IS 'Tag (exception): short yardage or goal line. NULL = untagged play.';
COMMENT ON COLUMN public.te_plays.garbage_time         IS 'Tag (sticky). NULL = untagged play.';
COMMENT ON COLUMN public.te_plays.blocked_defender     IS 'Tag (block reps only, pre-selected dl): dl / lb / db.';
COMMENT ON COLUMN public.te_plays.press_release        IS 'Tag (press snaps only): won / lost.';
COMMENT ON COLUMN public.te_plays.chipped_before_route IS 'Tag (exception). NULL = untagged play.';

COMMENT ON COLUMN public.prospects.pff_player_id    IS 'PFF NCAA player id (/v1/players). Per user; never in shared views.';
COMMENT ON COLUMN public.prospects.pff_match_status IS 'auto / confirmed / review / not_found / none. NULL = never matched.';
COMMENT ON COLUMN public.prospects.pff_match_note   IS 'Why the matcher decided what it did, for the review panel.';
COMMENT ON COLUMN public.scouting_games.pff_game_id      IS 'PFF game id of this charted game, matched against the player''s own PFF game log.';
COMMENT ON COLUMN public.scouting_games.pff_match_status IS 'auto / confirmed / review / not_charted / no_match / no_player / none. NULL = never matched.';
COMMENT ON COLUMN public.scouting_games.pff_match_note   IS 'Why the matcher decided what it did, for the review panel.';

-- ── Record in the migration ledger (no-op if 037 not yet applied) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'applied_migrations'
  ) THEN
    INSERT INTO public.applied_migrations (migration, note)
    VALUES ('062_play_tags_and_pff_links', 'Nullable per-play tag columns (4 situation tags on all play tables + position tags) and PFF player/game link columns on prospects / scouting_games')
    ON CONFLICT (migration) DO NOTHING;
  END IF;
END $$;
