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
  team_name?: string;
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
  role?: string;
  number: number | null;
  depth_chart_position: number | null;
  depth_chart_order?: number | null;
  search_rank: number | null;
  fantasy_positions: string[];
  college: string | null;
  height: string | null;
  weight: string | null;
  value?: number;
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
  /** Top-level rounds field returned by some Sleeper endpoints (also in settings.rounds). */
  rounds?: number;
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
    /** Draft type override returned by some Sleeper endpoints (e.g. "snake", "linear"). */
    type?: string;
    /** Alias for type, found in Sleeper metadata and some settings objects. */
    draft_type?: string;
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
  pick_no?: number;
  resolvedSlot?: string;
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

/** Consensus projection row as returned by useProjections.projectionData */
export interface ProjectionRow {
  sleeperId: string;
  full_name: string;
  position: string;
  team: string | null;
  fpts: number;
  sources: string[];
  kickoffAt: number | null;
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
  | "Fading Contender"
  | "Window Closing"
  | "Purgatory"
  | "Rebuilder"
  | "Stranded"
  | "Fading Out"
  | "Hopeless";

export interface RosterDirectionProfile {
  bucket: StrategicBucket;
  rawBucket?: StrategicBucket;
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
  playoffOdds?: number;
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

export interface CrossLeagueIntelPlayer {
  playerId: string;
  count: number;
  name: string;
  position: string;
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
  // Extended fields populated by the cross-league intel loader
  ownedPositionCounts?: Record<string, number>;
  repeatedPlayers?: (CrossLeagueIntelPlayer | null)[];
  acquiredPlayers?: (CrossLeagueIntelPlayer | null)[];
  averageAgeAllLeagues?: number;
  crossLeaguePickBuys30d?: number;
  crossLeaguePickSells30d?: number;
  preferenceLabel?: string;
  tradePreferenceLabel?: string;
  crossLeagueSummary?: string;
  crossLeagueTradeSummary?: string;
}

// ── League overview ──────────────────────────────────────────

/** A pick with an optional slot label and current owner override (set by loadLeagueOverview) */
export type AugmentedPick = SleeperTradedPick & { slot?: string; owner_id?: number };

export interface LeagueOverviewEntry {
  league: SleeperLeague;
  rosters: SleeperRoster[];
  picks: AugmentedPick[];
  userMap: Record<string, string>;
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

/** Supabase-persisted sim row (snake_case columns from league_simulations table) */
export interface CachedSimRow {
  league_id: string;
  roster_id: number;
  playoff_odds: number;
  title_odds: number;
  expected_wins: number;
  avg_finish: number;
  finish_range: string | null;
  computed_at: string | null;
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

/** A player row on the custom rookie big board (useRookieBoardState) */
export interface RookieBoardPlayer {
  player_id: string | null;
  name: string;
  position: string;
  team: string;
  adp: number;
  fcValue: number;
  boardRank?: number;
}

// ── Gameday hub ──────────────────────────────────────────────

/** Row shape used by the LeagueHub lineup-coach optimizer (score-based). */
export interface LineupCoachRow {
  slot: string;
  player: SleeperPlayer | null;
  /** Projection/redraft score used for optimizer ranking. */
  score: number;
  kickoffAt: number | null;
}

export interface GamedayLineupRow {
  slot: string;
  playerId: string;
  player: SleeperPlayer | null;
  actualPoints: number;
  remainingProjection: number;
  kickoffAt: number | null;
  kickoffLabel: string;
  gameState: string;
}

export interface GamedayReserveRow {
  playerId: string;
  player: SleeperPlayer | null;
  actualPoints: number;
  remainingProjection: number;
  kickoffAt: number | null;
  kickoffLabel: string;
  gameState: string;
}

export interface GamedayTeamView {
  rosterId: number;
  ownerId: string;
  ownerName: string;
  actualPoints: number;
  remainingProjection: number;
  projectedFinal: number;
  finishedStarters: number;
  liveStarters: number;
  upcomingStarters: number;
  totalStarters: number;
  starterRows: GamedayLineupRow[];
  benchRows: GamedayReserveRow[];
  taxiRows: GamedayReserveRow[];
}

export interface GamedayMatchup {
  matchupId: number;
  teams: GamedayTeamView[];
  sortKickoff: number;
}

// ── Data hub ─────────────────────────────────────────────────

export interface LeagueMateStatEntry {
  userId: string;
  displayName: string;
  totalLeagues: number;
  bestBallLeagues: number;
  sharedLeagues: number;
}

// ── Trade hub ────────────────────────────────────────────────

export interface DynamicPickValue {
  bucket: string;
  label: string;
  expectedValue: number;
  expectedSlot: number;
  floorValue: number;
  ceilingValue: number;
  finishRange?: string;
  issuerName?: string;
  issuerPlayoffOdds?: number;
  bandValues?: Record<string, number>;
  probabilities: { early: number; mid: number; late: number };
  likelySlots: Array<{ slot: number; probability: number }>;
}

export interface SimulationUpcomingGame {
  week: number;
  opponentRosterId: number;
  opponentName: string;
  winProb: number;
  projectedPoints: number;
  source: string;
}

export interface SimulationTeamRow {
  rosterId: number;
  ownerId: string;
  ownerName: string;
  actualWins: number;
  actualLosses: number;
  pointsFor: number;
  maxPf: number;
  lineupScore: number;
  benchDepth: number;
  projectedMaxPf: number;
  powerScore: number;
  weeklyStdDev: number;
  expectedWins: number;
  avgFinish: number;
  projectedFinish: number;
  finishRange: string;
  playoffOdds: number;
  byeOdds: number;
  titleOdds: number;
  oneOhOneOdds: number;
  luckScore: number;
  allPlayWins: number;
  allPlayLosses?: number;
  allPlayExpectedWins: number;
  avgWinProb?: number;
  finishProbabilities: number[];
  slotProbabilities: number[];
  upcomingSchedule: SimulationUpcomingGame[];
  currentOpponent?: string;
  currentWeekWinProb?: number;
}

export interface SimulationWeekMatchup {
  week: number;
  source: string;
  aRosterId: number;
  aName: string;
  aWinProb: number;
  aProjected: number;
  bRosterId: number;
  bName: string;
  bWinProb: number;
  bProjected: number;
}

export interface SimulationDisplayWeek {
  week: number;
  source: string;
  matchups: SimulationWeekMatchup[];
}

export interface LeagueSimulation {
  currentWeek: number;
  simulationMode: "in_season" | "offseason";
  regularSeasonWeeks: number;
  playoffTeams: number;
  byeTeams: number;
  weeksPlayed: number;
  simCount: number;
  rows: SimulationTeamRow[];
  weeklyMatchups: SimulationDisplayWeek[];
  rowByRosterId: Map<number, SimulationTeamRow>;
}

export interface PlayerValueSnapshotEntry {
  full_name: string;
  status: string;
  team: string;
  value: number;
  active: boolean;
  shareCount: number;
}

export interface HistoricalSnapshot {
  players: Record<string, PlayerValueSnapshotEntry>;
  recorded_at: string;
}

/** Enriched league mate profile with trade intelligence and fit scores. */
export interface LeagueMateView {
  rosterId: number;
  ownerId: string;
  ownerName: string;
  directionProfile: RosterDirectionProfile;
  tradeCount30d: number;
  picksIn30d: number;
  picksOut30d: number;
  lastTradeAt: string | null;
  recentBuyLabel: string;
  buildBiasLabel: string;
  strongestPos: string;
  secondPos: string;
  motivation: string;
  fitScore: number;
  fitLabel: string;
  fitReasons: string[];
  baseFitReasons: string[];
  crossLeagueFitReasons: string[];
  crossLeagueSummary: string;
  crossLeagueTradeSummary: string;
  preferenceLabel: string;
  tradePreferenceLabel: string;
  preferredPositions: string[];
  tradePreferredPositions: string[];
  repeatedPlayers: CrossLeagueIntelPlayer[];
  acquiredPlayers: CrossLeagueIntelPlayer[];
  totalDynastyLeagues: number;
  averageAgeAllLeagues: number;
  crossLeagueTradeCount30d: number;
}

/** LeagueMateView extended with simulation-based ranking fields. */
export interface TradePartnerRanking extends LeagueMateView {
  playoffOdds: number;
  titleOdds: number;
  finishRange: string;
  oneOhOneOdds: number;
  bestApproach: string;
  rankScore: number;
  negotiationNotes: string[];
  isSeller: boolean;
  isBuyer: boolean;
}

// ── Draft hub — predicted pick shape ─────────────────────────

/** A predicted pick entry used by the draft board grid (page.tsx → DraftHub). */
export interface PredictedPick {
  name: string;
  position: string;
  team: string;
  adp: number;
  player_id: string | null | undefined;
  boardRank: number;
  poolRank: number;
}

// ── Management hub ───────────────────────────────────────────
//
// Payment year columns (paid_2026, paid_2027, …) are stored as
// individual boolean columns in Supabase. The column list grows
// via migration 002 and beyond. To avoid updating this type each
// year, LeagueMgmtRow uses an index signature for `paid_*` keys.

export interface LeagueMgmtRow {
  /** Dynamic payment year keys: paid_2026, paid_2027, … */
  [paidYear: `paid_${number}`]: boolean | undefined;
  commissioner: boolean;
  year_in_advance: boolean;
  picks_traded: boolean;
  amount?: string;
}

export type LeagueMgmtData = Record<string, LeagueMgmtRow>;

export type CommPaymentsData = Record<
  string, // league_id
  Record<
    string, // owner_id
    Record<string, boolean> // { paid_2026: true, paid_2027: false, … }
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
