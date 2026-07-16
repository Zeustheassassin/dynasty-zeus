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
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

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
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

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
  amount text not null default '',
  updated_at timestamptz not null default now(),
  unique(user_id, league_id)
);
alter table league_management enable row level security;
drop policy if exists "league_management_self" on league_management;
create policy "league_management_self" on league_management for all
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

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
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

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
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

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
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

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
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

-- ── consensus_draft_cache (per-player aggregated picks per user/year) ────────
create table if not exists consensus_draft_cache (
  user_id uuid references auth.users(id) on delete cascade not null,
  year integer not null,
  player_id text not null,
  player_name text not null default '',
  position text not null default '',
  team text not null default '',
  avg_pick_no real not null,
  draft_count integer not null,
  primary key (user_id, year, player_id)
);
alter table consensus_draft_cache enable row level security;
drop policy if exists "consensus_cache_self" on consensus_draft_cache;
create policy "consensus_cache_self" on consensus_draft_cache for all
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

-- ── consensus_draft_meta (compilation run metadata per user/year) ─────────────
create table if not exists consensus_draft_meta (
  user_id uuid references auth.users(id) on delete cascade not null,
  year integer not null,
  total_drafts integer not null default 0,
  total_leagues integer not null default 0,
  connected_user_count integer not null default 0,
  compiled_at timestamptz not null default now(),
  primary key (user_id, year)
);
alter table consensus_draft_meta enable row level security;
drop policy if exists "consensus_meta_self" on consensus_draft_meta;
create policy "consensus_meta_self" on consensus_draft_meta for all
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

-- ============================================================
-- Tables added after initial schema (previously created manually in Supabase)
-- These already exist in the live DB — this block documents them for reproducibility.
-- Safe to re-run: all statements use CREATE TABLE IF NOT EXISTS.
-- ============================================================

-- ── player_notes (per-player free-text scouting notes) ───────
create table if not exists player_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  player_id text not null,
  note text not null default '',
  updated_at timestamptz not null default now(),
  unique(user_id, player_id)
);
alter table player_notes enable row level security;
drop policy if exists "player_notes_self" on player_notes;
create policy "player_notes_self" on player_notes for all
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

-- (player_dispositions table removed in migration 041 — the manual Sell/Buy
--  disposition feature was replaced by personal_rankings in Phases 2–3.)

-- ── personal_rankings (the user's own ordered player board) ───
-- One row per user — the ordered jsonb array of Sleeper player_ids
-- (array index = rank) drives the Trade Finder buy/sell signal.
-- Live grants are in migration 040 (snapshot omits grants like its siblings).
create table if not exists personal_rankings (
  user_id uuid references auth.users(id) on delete cascade not null primary key,
  ordering jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table personal_rankings enable row level security;
drop policy if exists "personal_rankings_self" on personal_rankings;
create policy "personal_rankings_self" on personal_rankings for all
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

-- ── player_value_snapshots (dynasty value baseline for alerts) ─
-- One row per user — the entire player map snapshot lives in the jsonb column.
create table if not exists player_value_snapshots (
  user_id uuid references auth.users(id) on delete cascade not null primary key,
  snapshot jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now()
);
alter table player_value_snapshots enable row level security;
drop policy if exists "player_value_snapshots_self" on player_value_snapshots;
create policy "player_value_snapshots_self" on player_value_snapshots for all
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

-- ── trade_attempts (trade log / CRM for trade hub) ────────────
create table if not exists trade_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  league_id text not null,
  partner_roster_id integer not null,
  partner_name text not null default '',
  give_players jsonb not null default '[]'::jsonb,
  give_picks jsonb not null default '[]'::jsonb,
  receive_players jsonb not null default '[]'::jsonb,
  receive_picks jsonb not null default '[]'::jsonb,
  source text not null default 'CALCULATOR',
  initiated_by text not null default 'ME',
  status text not null default 'PENDING',
  counter_details text,
  attempted_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table trade_attempts enable row level security;
drop policy if exists "trade_attempts_self" on trade_attempts;
create policy "trade_attempts_self" on trade_attempts for all
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);
-- Index for the common filter: all attempts for a user's specific league
create index if not exists trade_attempts_user_league on trade_attempts(user_id, league_id);

-- ── leaguemate_profiles (cached per-league cross-league intel) ─
create table if not exists leaguemate_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  league_id text not null,
  profiles jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique(user_id, league_id)
);
alter table leaguemate_profiles enable row level security;
drop policy if exists "leaguemate_profiles_self" on leaguemate_profiles;
create policy "leaguemate_profiles_self" on leaguemate_profiles for all
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

-- ── league_simulations (season simulator results per roster) ──
create table if not exists league_simulations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  league_id text not null,
  roster_id integer not null,
  playoff_odds real not null default 0,
  title_odds real not null default 0,
  expected_wins real not null default 0,
  avg_finish real not null default 0,
  finish_range text not null default '',
  computed_at timestamptz not null default now(),
  unique(user_id, league_id, roster_id)
);
alter table league_simulations enable row level security;
drop policy if exists "league_simulations_self" on league_simulations;
create policy "league_simulations_self" on league_simulations for all
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);
-- Index for bulk load of all sims for a user on login
create index if not exists league_simulations_user on league_simulations(user_id);

-- ── draft_board_picks (user's manual pick-slot → player assignments) ─
create table if not exists draft_board_picks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  league_id text not null,
  season text not null,
  pick_slot text not null,
  player_id text not null,
  updated_at timestamptz not null default now(),
  unique(user_id, league_id, season, pick_slot)
);
alter table draft_board_picks enable row level security;
drop policy if exists "draft_board_picks_self" on draft_board_picks;
create policy "draft_board_picks_self" on draft_board_picks for all
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

-- ── owner_tendencies (cached per-owner positional draft rates) ─
-- Keyed by Sleeper owner_user_id (text), not auth.users uuid.
-- Not tied to auth so owner data can be shared across users who league together.
-- INTENTIONAL DESIGN: open read + write for all authenticated users because
-- tendencies are non-PII aggregate stats computed from public Sleeper data and
-- shared cross-league. DELETE is explicitly blocked to prevent data vandalism.
create table if not exists owner_tendencies (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null,
  season text not null,
  rates jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(owner_user_id, season)
);
alter table owner_tendencies enable row level security;
drop policy if exists "owner_tendencies_open_read" on owner_tendencies;
drop policy if exists "owner_tendencies_open_write" on owner_tendencies;
drop policy if exists "owner_tendencies_open_update" on owner_tendencies;
drop policy if exists "owner_tendencies_no_delete" on owner_tendencies;
-- Readable by all authenticated users (tendencies are not PII)
create policy "owner_tendencies_open_read" on owner_tendencies for select
  using (auth.role() = 'authenticated');
-- Any authenticated user may insert or update tendency rows (shared aggregate data)
create policy "owner_tendencies_open_write" on owner_tendencies for insert
  with check (auth.role() = 'authenticated');
create policy "owner_tendencies_open_update" on owner_tendencies for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
-- DELETE is explicitly blocked — no authenticated user may delete tendency rows
create policy "owner_tendencies_no_delete" on owner_tendencies for delete
  using (false);

-- ── consensus_player_grades (hit/neutral/bust grades per player) ─
-- Stored in a single jsonb blob keyed by "{year}_{player_id}"
create table if not exists consensus_player_grades (
  user_id uuid references auth.users(id) on delete cascade not null primary key,
  grades jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table consensus_player_grades enable row level security;
drop policy if exists "consensus_player_grades_self" on consensus_player_grades;
create policy "consensus_player_grades_self" on consensus_player_grades for all
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

-- ── rookie_board_tiers (tier-bracket assignments for the draft board) ─
-- tier labels stored as jsonb: { [player_id]: tierNumber }
create table if not exists rookie_board_tiers (
  user_id uuid references auth.users(id) on delete cascade not null,
  year text not null,
  tiers jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, year)
);
alter table rookie_board_tiers enable row level security;
drop policy if exists "rookie_board_tiers_self" on rookie_board_tiers;
create policy "rookie_board_tiers_self" on rookie_board_tiers for all
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

-- ── league_player_tags (CORE / WANT_TO_TRADE tags per league per player) ─
create table if not exists league_player_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  league_id text not null,
  player_id text not null,
  tag text not null,
  updated_at timestamptz not null default now(),
  unique(user_id, league_id, player_id)
);
alter table league_player_tags enable row level security;
drop policy if exists "league_player_tags_self" on league_player_tags;
create policy "league_player_tags_self" on league_player_tags for all
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);
-- Fast lookup by user + league (most common query pattern); mirrors migration 003.
create index if not exists idx_league_player_tags_user_league
  on league_player_tags (user_id, league_id);

-- (gm_briefings table removed in migration 042 — the AI-generated GM
--  briefing feature was removed for cost reasons; there is no LLM call
--  anywhere in the app today.)
