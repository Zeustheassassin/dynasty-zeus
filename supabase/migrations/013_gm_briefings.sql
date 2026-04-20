-- GM Briefings: stores AI-generated per-team briefings keyed by user + league + roster.
-- One row per team per user. Upserted on each manual refresh.
create table if not exists gm_briefings (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null,
  league_id    text        not null,
  roster_id    integer     not null,
  briefing     jsonb       not null,
  generated_at timestamptz not null default now(),
  constraint gm_briefings_unique unique (user_id, league_id, roster_id)
);

create index if not exists gm_briefings_user_idx on gm_briefings (user_id);
