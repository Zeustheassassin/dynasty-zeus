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
