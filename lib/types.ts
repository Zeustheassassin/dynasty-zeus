// ============================================================
// Shared TypeScript interfaces for DynastyZeus
// ============================================================
// These types replace `any` throughout the codebase and give the
// compiler enough information to catch bugs before they reach prod.
// All interfaces mirror the real shape returned by Sleeper's API.
// ============================================================

// ── Sleeper data shapes ──────────────────────────────────────

export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  metadata?: Record<string, string>;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  season_type: string;
  status: string;
  sport: string;
  total_rosters: number;
  roster_positions: string[];
  settings: SleeperLeagueSettings;
  scoring_settings: Record<string, number>;
  avatar: string | null;
  draft_id: string | null;
  previous_league_id: string | null;
  metadata?: Record<string, string>;
}

export interface SleeperLeagueSettings {
  playoff_week_start: number;
  playoff_teams: number;
  num_teams: number;
  max_keepers?: number;
  type?: number; // 0 = redraft, 2 = dynasty
  waiver_type?: number;
  waiver_budget?: number;
  waiver_day_of_week?: number;
  taxi_slots?: number;
  taxi_years?: number;
  reserve_slots?: number;
  reserve_allow_out?: number;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  league_id: string;
  players: string[];
  starters: string[];
  reserve: string[] | null;
  taxi: string[] | null;
  co_owners: string[] | null;
  settings: SleeperRosterSettings;
  metadata?: Record<string, string>;
}

export interface SleeperRosterSettings {
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  fpts_decimal: number;
  fpts_against: number;
  fpts_against_decimal: number;
  fpts_max?: number;
  fpts_max_decimal?: number;
  total_moves?: number;
  waiver_position?: number;
  waiver_budget_used?: number;
}

export interface SleeperPlayer {
  player_id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  position: string;
  team: string | null;
  age: number | null;
  years_exp: number | null;
  status: string;
  injury_status: string | null;
  number: number | null;
  depth_chart_position: number | null;
  search_rank: number | null;
  fantasy_positions: string[];
  college: string | null;
  height: string | null;
  weight: string | null;
}

export interface SleeperMatchup {
  matchup_id: number;
  roster_id: number;
  points: number;
  custom_points: number | null;
  starters: string[];
  players: string[];
  starters_points: number[];
  players_points: Record<string, number>;
}

export interface SleeperTransaction {
  transaction_id: string;
  type: "trade" | "free_agent" | "waiver" | "waiver_failed";
  status: "complete" | "failed";
  leg: number;
  week: number;
  created: number;
  updated: number;
  roster_ids: number[];
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  draft_picks: SleeperTradedPick[];
  waiver_budget: Array<{ amount: number; receiver: number; sender: number }>;
  settings: Record<string, number> | null;
  metadata: Record<string, string> | null;
  consenter_ids: number[];
}

export interface SleeperDraft {
  draft_id: string;
  league_id: string;
  season: string;
  season_type: string;
  status: string;
  type: string;
  sport: string;
  created: number;
  updated: number;
  start_time: number;
  last_picked: number;
  last_message_id: string | null;
  slot_to_roster_id: Record<string, number>;
  draft_order: Record<string, number> | null;
  metadata: {
    name?: string;
    description?: string;
    scoring_type?: string;
    draft_type?: string;
  };
  settings: {
    slots_qb: number;
    slots_rb: number;
    slots_wr: number;
    slots_te: number;
    slots_flex: number;
    slots_super_flex?: number;
    slots_k: number;
    slots_def: number;
    slots_bn: number;
    rounds: number;
    pick_timer: number;
    teams: number;
    reversal_round: number;
    alpha_sort: number;
    cpu_autopick: number;
    player_type: number;
    enforce_position_limits?: number;
    nomination_timer?: number;
  };
}

export interface SleeperDraftPick {
  pick_id: string;
  draft_id: string;
  player_id: string;
  picked_by: string;
  roster_id: number;
  round: number;
  draft_slot: number;
  pick_no: number;
  is_keeper: boolean | null;
  metadata: {
    first_name?: string;
    last_name?: string;
    position?: string;
    team?: string;
    years_exp?: string;
    slot?: string;
  };
}

export interface SleeperTradedPick {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
  slot?: string;
}

export interface SleeperNFLState {
  week: number;
  season_type: string;
  season_start_date: string;
  season: string;
  previous_season: string;
  leg: number;
  league_create_season: string;
  display_week: number;
}

// ── Projection / analytics shapes ───────────────────────────

export interface ProjectionEntry {
  name: string;
  position: string;
  fpts: number;
  playerId?: string;
  kickoffAt?: number | null;
  source?: string;
}

export interface ProjectionSourceWeightedEntry {
  playerId: string;
  name: string;
  position: string;
  fpts: number;
  sourceCount: number;
}

export interface FantasyCalcPlayerValue {
  playerId: string;   // Sleeper player_id
  value: number;
}

export interface FantasyCalcPickValue {
  key: string;        // e.g. "2026-1" or "2026-1.06"
  value: number;
}

// ── Alert / watchlist shapes ─────────────────────────────────

export type AlertsCenterCategory = "market" | "status" | "league" | "watchlist" | "news";
export type AlertsCenterSource = "internal" | "watchlist" | "external";
export type AlertsCenterSeverity = "high" | "medium" | "low";

export interface AlertsCenterItem {
  id: string;
  category: AlertsCenterCategory;
  source: AlertsCenterSource;
  severity: AlertsCenterSeverity;
  title: string;
  detail: string;
  actionable: boolean;
  timestamp: number;
  playerId?: string | null;
  leagueId?: string | null;
  teamLabel?: string | null;
  link?: string | null;
  payload?: Record<string, unknown>;
  dismissed?: boolean;
}

export interface WatchlistEntry {
  player_id: string;
  label: string;
  threshold_up: number;
  threshold_down: number;
  league_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

// ── Roster direction / analysis shapes ──────────────────────

export type StrategicBucket =
  | "Elite"
  | "True Contender"
  | "Almost There"
  | "Rebuilder"
  | "Fading Contender"
  | "Purgatory"
  | "Blow Up"
  | "Hopeless"
  | "Mixed Identity";

export interface RosterDirectionProfile {
  bucket: StrategicBucket;
  bucketColor: string;
  dynRank: number;
  redRank: number;
  standRank: number;
  maxPfRank: number;
  n: number;
  summary: string;
  actions: string[];
  shortAction: string;
  strengths: string[];
  concerns: string[];
  positionRanks: Array<{ pos: string; total: number; rank: number }>;
  coreAge: number;
  youngCoreCount: number;
  oldCoreCount: number;
  pickTotal: number;
  firstRounders: number;
  premiumCurrentFirsts: number;
  futureFirsts: number;
}

export interface LeagueMateProfile {
  rosterId: number;
  ownerId: string;
  bucket: StrategicBucket;
  bucketColor: string;
  dynRank: number;
  redRank: number;
  standRank: number;
  positionRanks: Array<{ pos: string; total: number; rank: number }>;
  coreAge: number;
  youngCoreCount: number;
  oldCoreCount: number;
  pickTotal: number;
  futureFirsts: number;
  firstRounders: number;
}

export interface TradePartnerFit {
  fitScore: number;
  fitLabel: string;
  fitReasons: string[];
}

export interface CrossLeagueIntel {
  totalDynastyLeagues: number;
  preferredPositions: string[];
  youngQbWrRate: number;
  veteranRbRate: number;
  crossLeagueTradeCount30d: number;
  tradePreferredPositions: string[];
  youngQbWrBuyRate: number;
  veteranRbBuyRate: number;
}

// ── League hub ───────────────────────────────────────────────

export type LeagueHubTab =
  | "OVERVIEW"
  | "SIMULATOR"
  | "ROSTERS"
  | "LEAGUE_MATES"
  | "OPP_ROSTERS"
  | "STANDINGS"
  | "STARTERS"
  | "NOTES"
  | "POWER_RANKINGS"
  | "ACTIVITY"
  | "DRAFT_BOARD";

// ── Simulator shapes ─────────────────────────────────────────

export interface SimRow {
  rosterId: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  playoffOdds: number;
  playoffSeed?: number;
  simWins?: number;
}

export interface CommittedSimsByLeague {
  [leagueId: string]: Record<number, SimRow>;
}

// ── Draft hub ────────────────────────────────────────────────

export interface RookiePlayer {
  player_id: string;
  full_name: string;
  position: string;
  team?: string | null;
  age?: number | null;
  rank?: number;
  adp?: number | null;
  adp_dynasty_2qb?: number | null;
  source?: string;
}

// ── Gameday hub ──────────────────────────────────────────────

export interface GamedayLineupRow {
  slot: string;
  player: SleeperPlayer | null;
  score: number;
  kickoffAt: number | null;
}

export interface GamedayMatchup {
  matchupId: number;
  teamA: {
    rosterId: number;
    ownerId: string;
    displayName: string;
    totalProjected: number;
    totalActual: number;
    lineup: GamedayLineupRow[];
  };
  teamB: {
    rosterId: number;
    ownerId: string;
    displayName: string;
    totalProjected: number;
    totalActual: number;
    lineup: GamedayLineupRow[];
  };
}

// ── Management hub ───────────────────────────────────────────

export interface LeagueMgmtRow {
  paid_2026: boolean;
  paid_2027: boolean;
  paid_2028: boolean;
  paid_2029: boolean;
  commissioner: boolean;
  year_in_advance: boolean;
  picks_traded: boolean;
}

export type LeagueMgmtData = Record<string, LeagueMgmtRow>;

export type CommPaymentsData = Record<
  string, // league_id
  Record<
    string, // owner_id
    { paid_2026: boolean; paid_2027: boolean; paid_2028: boolean; paid_2029: boolean }
  >
>;

// ── Projection source ────────────────────────────────────────

export type ProjSourceId = "fantasypros" | "numberfire" | "sleeper";

export interface ProjSource {
  id: ProjSourceId;
  label: string;
  tier: 1 | 2;
  weight: number;
}

// ── Trade attempts ────────────────────────────────────────────

export type TradeAttemptStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "COUNTERED" | "NO_RESPONSE";
export type TradeAttemptSource = "FINDER" | "CALCULATOR" | "RECOMMENDATIONS";
export type TradeAttemptDirection = "ME" | "THEM";

export interface TradeAttemptAsset {
  player_id: string;
  name: string;
  position: string;
  value: number;
}

export interface TradeAttemptPick {
  key: string;
  label: string;
  value: number;
}

export interface TradeAttempt {
  id: string;
  user_id: string;
  league_id: string;
  partner_roster_id: number;
  partner_name: string;
  give_players: TradeAttemptAsset[];
  give_picks: TradeAttemptPick[];
  receive_players: TradeAttemptAsset[];
  receive_picks: TradeAttemptPick[];
  source: TradeAttemptSource;
  initiated_by: TradeAttemptDirection;
  status: TradeAttemptStatus;
  counter_details: string | null;
  attempted_at: string;
  resolved_at: string | null;
}
