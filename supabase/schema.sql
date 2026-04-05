-- ============================================================
-- DynastyZeus Supabase Schema
-- Run this in your Supabase project: SQL Editor > New Query
-- ============================================================

-- ── notes (title/body note cards) ────────────────────────────
create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null default '',
  body text not null default '',
  updated_at timestamptz not null default now()
);
alter table notes enable row level security;
drop policy if exists "notes_self" on notes;
create policy "notes_self" on notes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── league_notes (per-league free-text notes) ─────────────────
create table if not exists league_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  league_id text not null,
  content text not null default '',
  updated_at timestamptz not null default now(),
  unique(user_id, league_id)
);
alter table league_notes enable row level security;
drop policy if exists "league_notes_self" on league_notes;
create policy "league_notes_self" on league_notes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── league_management (per-league checkbox flags) ────────────
create table if not exists league_management (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  league_id text not null,
  paid_2026 boolean not null default false,
  paid_2027 boolean not null default false,
  paid_2028 boolean not null default false,
  paid_2029 boolean not null default false,
  commissioner boolean not null default false,
  year_in_advance boolean not null default false,
  picks_traded boolean not null default false,
  updated_at timestamptz not null default now(),
  unique(user_id, league_id)
);
alter table league_management enable row level security;
drop policy if exists "league_management_self" on league_management;
create policy "league_management_self" on league_management for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── commissioner_payments (per-league per-owner paid years) ───
create table if not exists commissioner_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  league_id text not null,
  owner_id text not null,
  paid_2026 boolean not null default false,
  paid_2027 boolean not null default false,
  paid_2028 boolean not null default false,
  paid_2029 boolean not null default false,
  updated_at timestamptz not null default now(),
  unique(user_id, league_id, owner_id)
);
alter table commissioner_payments enable row level security;
drop policy if exists "commissioner_payments_self" on commissioner_payments;
create policy "commissioner_payments_self" on commissioner_payments for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── rookie_board (custom player rankings order) ───────────────
create table if not exists rookie_board (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  year text not null,
  players jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  unique(user_id, year)
);
alter table rookie_board enable row level security;
drop policy if exists "rookie_board_self" on rookie_board;
create policy "rookie_board_self" on rookie_board for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── watchlists (alerts center tracked players) ─────────────────
create table if not exists watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  player_id text not null,
  label text not null default '',
  threshold_up integer not null default 250,
  threshold_down integer not null default 250,
  league_id text,
  updated_at timestamptz not null default now(),
  unique(user_id, player_id)
);
alter table watchlists enable row level security;
drop policy if exists "watchlists_self" on watchlists;
create policy "watchlists_self" on watchlists for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── alerts (alerts center cache + dismiss state) ───────────────
create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
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
  updated_at timestamptz not null default now(),
  unique(user_id, alert_id)
);
alter table alerts enable row level security;
drop policy if exists "alerts_self" on alerts;
create policy "alerts_self" on alerts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
