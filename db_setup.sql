-- 1) table
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  title text not null,
  body text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) enable RLS
alter table public.notes enable row level security;

-- 3) drop prior policies
 drop policy if exists "users can select own notes" on public.notes;
 drop policy if exists "users can insert own notes" on public.notes;
 drop policy if exists "users can update own notes" on public.notes;
 drop policy if exists "users can delete own notes" on public.notes;

-- 4) policy: select own
create policy "users can select own notes"
  on public.notes
  for select
  using (auth.uid() = user_id);

-- 5) policy: insert own
create policy "users can insert own notes"
  on public.notes
  for insert
  with check (auth.uid() = user_id);

-- 6) policy: update own
create policy "users can update own notes"
  on public.notes
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 7) policy: delete own
create policy "users can delete own notes"
  on public.notes
  for delete
  using (auth.uid() = user_id);

-- 8) updated_at trigger
create or replace function public.notes_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.notes_updated_at();

-- Optional league-mate intelligence cache
create table if not exists public.leaguemate_profiles (
  user_id uuid not null references auth.users(id),
  league_id text not null,
  profiles jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, league_id)
);

alter table public.leaguemate_profiles enable row level security;

drop policy if exists "users can select own leaguemate profiles" on public.leaguemate_profiles;
drop policy if exists "users can insert own leaguemate profiles" on public.leaguemate_profiles;
drop policy if exists "users can update own leaguemate profiles" on public.leaguemate_profiles;
drop policy if exists "users can delete own leaguemate profiles" on public.leaguemate_profiles;

create policy "users can select own leaguemate profiles"
  on public.leaguemate_profiles
  for select
  using (auth.uid() = user_id);

create policy "users can insert own leaguemate profiles"
  on public.leaguemate_profiles
  for insert
  with check (auth.uid() = user_id);

create policy "users can update own leaguemate profiles"
  on public.leaguemate_profiles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users can delete own leaguemate profiles"
  on public.leaguemate_profiles
  for delete
  using (auth.uid() = user_id);

drop trigger if exists leaguemate_profiles_set_updated_at on public.leaguemate_profiles;
create trigger leaguemate_profiles_set_updated_at
  before update on public.leaguemate_profiles
  for each row execute function public.notes_updated_at();

-- Optional alerts center watchlists
create table if not exists public.watchlists (
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id text not null,
  label text not null default '',
  threshold_up integer not null default 250,
  threshold_down integer not null default 250,
  league_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, player_id)
);

alter table public.watchlists enable row level security;

drop policy if exists "users can select own watchlists" on public.watchlists;
drop policy if exists "users can insert own watchlists" on public.watchlists;
drop policy if exists "users can update own watchlists" on public.watchlists;
drop policy if exists "users can delete own watchlists" on public.watchlists;

create policy "users can select own watchlists"
  on public.watchlists
  for select
  using (auth.uid() = user_id);

create policy "users can insert own watchlists"
  on public.watchlists
  for insert
  with check (auth.uid() = user_id);

create policy "users can update own watchlists"
  on public.watchlists
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users can delete own watchlists"
  on public.watchlists
  for delete
  using (auth.uid() = user_id);

drop trigger if exists watchlists_set_updated_at on public.watchlists;
create trigger watchlists_set_updated_at
  before update on public.watchlists
  for each row execute function public.notes_updated_at();

-- Optional alerts center cache / dismiss state
create table if not exists public.alerts (
  user_id uuid not null references auth.users(id) on delete cascade,
  alert_id text not null,
  category text not null default 'watchlist',
  source text not null default 'internal',
  severity text not null default 'low',
  title text not null default '',
  detail text not null default '',
  actionable boolean not null default true,
  dismissed boolean not null default false,
  league_id text,
  player_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, alert_id)
);

alter table public.alerts enable row level security;

drop policy if exists "users can select own alerts" on public.alerts;
drop policy if exists "users can insert own alerts" on public.alerts;
drop policy if exists "users can update own alerts" on public.alerts;
drop policy if exists "users can delete own alerts" on public.alerts;

create policy "users can select own alerts"
  on public.alerts
  for select
  using (auth.uid() = user_id);

create policy "users can insert own alerts"
  on public.alerts
  for insert
  with check (auth.uid() = user_id);

create policy "users can update own alerts"
  on public.alerts
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users can delete own alerts"
  on public.alerts
  for delete
  using (auth.uid() = user_id);

drop trigger if exists alerts_set_updated_at on public.alerts;
create trigger alerts_set_updated_at
  before update on public.alerts
  for each row execute function public.notes_updated_at();
