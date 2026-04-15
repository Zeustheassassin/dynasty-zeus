-- ============================================================
-- Migration 004 — Indexes + consensus cache TTL
-- ============================================================
-- Rollback strategy:
--   To revert: drop the indexes and column added below.
--   Indexes are always safe to drop — they have no data impact.
--   The computed_at column has a NOT NULL default, so backfilling
--   is not required; dropping it only removes the column metadata.
--
--   Rollback statements (run in order):
--     DROP INDEX IF EXISTS notes_user_id;
--     DROP INDEX IF EXISTS owner_tendencies_owner_user_id;
--     ALTER TABLE consensus_draft_cache DROP COLUMN IF EXISTS computed_at;
-- ============================================================

-- ── notes: add user_id index so "SELECT * FROM notes WHERE user_id = $1"
--    does an index scan rather than a sequential scan.
--    (Other tables already have composite UNIQUE constraints that serve
--    as an implicit index on user_id via prefix scan.)
create index if not exists notes_user_id on notes(user_id);

-- ── owner_tendencies: add index on owner_user_id for lookups like
--    "SELECT * FROM owner_tendencies WHERE owner_user_id = $1 AND season = $2".
--    The primary key is on (id), so this lookup was a sequential scan.
create index if not exists owner_tendencies_owner_user_id
  on owner_tendencies(owner_user_id, season);

-- ── consensus_draft_cache: add computed_at so old entries can be evicted.
--    Backfill with the epoch (1970-01-01) so any existing rows are
--    immediately eligible for eviction on the next compile run.
alter table consensus_draft_cache
  add column if not exists computed_at timestamptz not null default '1970-01-01T00:00:00Z';

-- Update the column default to now() so new rows get a real timestamp.
-- (The backfill default above is only applied to rows inserted without a value;
--  rows inserted going forward use the trigger default set by the application.)
alter table consensus_draft_cache
  alter column computed_at set default now();

-- ── Eviction helper: delete consensus cache rows older than 90 days.
--    Call this periodically (e.g. from a Supabase cron job or the
--    compile-consensus API route after a successful compile run).
--
--    Example usage (run in Supabase SQL editor or pg_cron):
--      SELECT evict_old_consensus_cache(90);
create or replace function evict_old_consensus_cache(max_age_days integer default 90)
returns integer
language plpgsql
security definer
as $$
declare
  deleted_count integer;
begin
  delete from consensus_draft_cache
  where computed_at < now() - (max_age_days || ' days')::interval;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
