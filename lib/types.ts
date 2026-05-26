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
  best_ball?: number; // 1 = best ball league
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
  injury_body_part: string | null;
  injury_notes: string | null;
  practice_description: string | null;
  practice_participation: string | null;
  active: boolean;
  bye_week: number | null;
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

export type AnnotatedTransaction = SleeperTransaction & {
  leagueName: string;
  leagueId: string;
  rosterOwnerMap: Record<number, string>;
};

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

/** A single player's market movement entry extracted from the FC /values/current response. */
export interface FcTrendEntry {
  sleeperId: string;
  name: string;
  position: string;
  team: string;
  value: number;          // dynasty value
  redraftValue: number;
  trend30Day: number;     // raw value point change over 30 days
  tradeFrequency: number; // fraction of trades this player appears in
}

// ── Alert / watchlist shapes ─────────────────────────────────

export type AlertsCenterCategory = "market" | "status" | "league" | "watchlist";
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
  | "ROSTER_OVERVIEW"
  | "LEAGUE_MATES"
  | "OPP_ROSTERS"
  | "STANDINGS"
  | "STARTERS"
  | "NOTES"
  | "POWER_RANKINGS"
  | "ACTIVITY";

// ── Simulator shapes ─────────────────────────────────────────

export interface StandingRow {
  roster_id: number;
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  max_pf: number;
  owner_id: string;
}

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

// Pool-rank lookups used to flag REACH/VALUE on already-completed picks
// (the same ordering that drives predictedDraftPicks for unfilled slots).
export interface DraftPoolRanks {
  byPlayerId: Record<string, number>;
  byName:     Record<string, number>;
}

// Frozen snapshot of a completed Live Draft Board. Stored as a single row in
// league_draft_snapshots (snapshot_data jsonb). Captures pool ranks at save
// time so REACH/VALUE flags don't drift as consensus updates.
export interface LeagueDraftSnapshotPick {
  slot:           string;
  pickNo:         number;
  round:          number;
  slotInRound:    number;
  playerId:       string | null;
  name:           string;
  position:       string;
  team:           string;
  drafterUserId:  string | null;
  drafterName:    string;
  poolRank:       number;
}

export interface LeagueDraftSnapshotData {
  leagueName: string;
  leagueId:   string | null;
  season:     string;
  numTeams:   number;
  numRounds:  number;
  headers:    Array<{ slot: number; userId: string | null; username: string }>;
  picks:      LeagueDraftSnapshotPick[];
}

export interface LeagueDraftSnapshot {
  id:            string;
  name:          string;
  saved_at:      string;
  snapshot_data: LeagueDraftSnapshotData;
}

// ── Management hub ───────────────────────────────────────────
//
// Payment year columns (paid_2026, paid_2027, …) are stored as
// individual boolean columns in Supabase. The column list grows
// via migration 002 and beyond. To avoid updating this type each
// year, LeagueMgmtRow uses an index signature for `paid_*` keys.

export interface LeagueMgmtRow {
  /** Covers paid_2026, paid_2027, … and all other dynamic keys */
  [key: string]: boolean | string | undefined;
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


// ── Scouting Hub ──────────────────────────────────────────────

export type ChartingDecision = "fully_charted" | "partial_chart" | "charting" | "pending" | "not_charting";
export type RouteType =
  | "nine" | "post" | "dig" | "curl" | "slant" | "screen"
  | "flat" | "comeback" | "out" | "corner" | "other";
export type Alignment = "left" | "right" | "slot" | "backfield";
export type CoverageType = "man" | "zone" | "double" | "press" | "";

export interface Prospect {
  id: string;
  user_id: string;
  name: string;
  school: string;
  conference: string;
  position: string;
  draft_class_year: number;
  height: string;
  weight: number | null;
  birthday: string | null;
  personal_rank: number | null;
  overall_rank: number | null;
  pff_rank: number | null;
  mock_draft_rank: number | null;
  drafttek_rank: number | null;
  pfn_rank: number | null;
  should_play: string;
  will_play_pre: string;
  will_play_post: string;
  charting_decision: ChartingDecision;
  charting_notes: string;
  draft_round: number | null;
  draft_pick: number | null;
  draft_team: string | null;
  synopsis: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScoutingGame {
  id: string;
  user_id: string;
  prospect_id: string;
  season_year: number;
  opponent: string;
  game_slot: number;
  game_type: string;
  watch_date: string | null;
  notes: string;
  created_at: string;
  summary_targets: number | null;
  summary_catches: number | null;
  summary_drops: number | null;
  summary_contested: number | null;
  summary_contested_catches: number | null;
}

export interface RoutePlay {
  id: string;
  user_id: string;
  game_id: string;
  route_type: RouteType;
  alignment: Alignment;
  on_line: boolean;
  coverage: CoverageType;
  was_open: boolean;
  targeted: boolean;
  success: boolean | null;
  contested: boolean;
  yards: number | null;
  play_notes: string;
  no_route_run: boolean;
  created_at: string;
}

export interface RouteStat { count: number; open: number; targets: number; catches: number }
export interface CoverageStat { count: number; open: number; catches: number }

// ── RB Scouting ─────────────────────────────────────────────
export type RBFormation  = "gun" | "pistol" | "under_center";
export type RBRunType    = "outside_man_gap" | "inside_man_gap" | "outside_zone" | "inside_zone" | "pass_block" | "run_block" | "decoy" | "route";
export type RBRouteType  = "mid_curl" | "flats" | "big_boy_route";

export interface RBPlay {
  id: string;
  user_id: string;
  game_id: string;
  formation: RBFormation;
  run_type: RBRunType;
  success: boolean | null;
  loaded_box: boolean;
  unblocked_defender: boolean;
  broken_tackle: boolean;
  explosive_play: boolean;
  run_stuff: boolean;
  play_notes: string | null;
  aligned_as_wr: boolean;
  targeted: boolean;
  route_type: RBRouteType | null;
  was_open: boolean | null;
  created_at: string;
}

// ── QB Scouting ─────────────────────────────────────────────
export type QBSnapPosition = "shotgun" | "pistol" | "under_center";
export type QBPlayType     = "run" | "rpo" | "pass";
export type QBTiming       = "first_option" | "second_option" | "checkdown" | "scramble" | "sack" | "throw_away" | "extended_play";
export type QBAccuracy     = "high" | "low" | "on_target" | "in_front" | "behind" | "tipped_ball";
export type QBDepthZone    =
  | "deep_left"  | "deep_center"  | "deep_right"
  | "mid_left"   | "mid_center"   | "mid_right"
  | "short_left" | "short_center" | "short_right";

export type QBCompletion = "caught" | "incomplete" | "interception";
export type QBIntType    = "bad_throw" | "bad_decision" | "fifty_fifty" | "tipped";
export type QBTargetPos  = "rb" | "wr" | "te";
export type QBPlatform   = "on_platform" | "off_platform" | "on_the_run";
export type QBPlatformSide = "strong_side" | "cross_body";
export type QBPressure   = "clean" | "mid" | "backside" | "front_side";
export type QBPressureHandling = "step_up" | "bail_front_side" | "bail_backside";
export type QBTouch      = "correct" | "incorrect";

export interface QBPlay {
  id: string;
  user_id: string;
  game_id: string;
  snap_position: QBSnapPosition;
  play_type: QBPlayType;
  timing: QBTiming | null;
  accuracy: QBAccuracy | null;
  completion: QBCompletion | null;
  int_type: QBIntType | null;
  target_pos: QBTargetPos | null;
  depth_zone: QBDepthZone | null;
  route_type: RouteType | null;
  coverage: "man" | "zone" | null;
  platform: QBPlatform | null;
  platform_side: QBPlatformSide | null;
  pressure: QBPressure | null;
  pressure_handling: QBPressureHandling | null;
  touch: QBTouch | null;
  play_notes: string | null;
  created_at: string;
}

// ── TE Scouting ─────────────────────────────────────────────
export type TELocation    = "left" | "right" | "backfield";
export type TEPositioning = "wide" | "slot" | "inline" | "full_back" | "running_back" | "wing_back";
export type TEPlayType    = "run_block" | "pass_block" | "route_run" | "decoy";
export type TEBlockType   = "movement" | "inline";
export type TECoverage    = "man" | "zone" | "press" | "double";

export interface TEPlay {
  id: string;
  user_id: string;
  game_id: string;
  location: TELocation;
  positioning: TEPositioning;
  play_type: TEPlayType;
  block_type: TEBlockType | null;
  block_success: boolean | null;
  coverage: TECoverage | null;
  route_type: RouteType | null;
  was_open: boolean | null;
  targeted: boolean | null;
  caught: boolean | null;
  dropped: boolean | null;
  contested_target: boolean | null;
  contested_catch: boolean | null;
  broken_tackle: boolean;
  play_notes: string | null;
  created_at: string;
}

export interface ProspectWithStats extends Prospect {
  total_snaps: number;
  total_routes: number;
  total_games: number;
  targets: number;
  catches: number;
  drops: number;
  contested: number;
  contested_catches: number;
  total_yards: number;
  success_rate: number | null;
  target_rate: number | null;
  avg_ypc: number | null;
  pct_left: number | null;
  pct_right: number | null;
  pct_slot: number | null;
  pct_backfield: number | null;
  pct_on_line: number | null;
  adj_success_above_exp: number | null;
  avg_external_rank: number | null;
  depth_behind_los: number;
  depth_on_los: number;
  route_stats: Partial<Record<RouteType, RouteStat>>;
  coverage_stats: Record<"man" | "zone" | "double" | "press", CoverageStat>;
  open_pct_slot: number | null;
  open_pct_slot_on_line: number | null;
  open_pct_slot_off_line: number | null;
  open_pct_right: number | null;
  open_pct_right_on_line: number | null;
  open_pct_right_off_line: number | null;
  open_pct_left: number | null;
  open_pct_left_on_line: number | null;
  open_pct_left_off_line: number | null;
  open_pct_backfield: number | null;
  // Counts (denominators) for the open-rate splits above. Used for weighted league totals
  // so the footer row is a true global rate, not a mean of per-player rates.
  align_n_slot: number;
  align_n_slot_on_line: number;
  align_n_slot_off_line: number;
  align_n_right: number;
  align_n_right_on_line: number;
  align_n_right_off_line: number;
  align_n_left: number;
  align_n_left_on_line: number;
  align_n_left_off_line: number;
  align_n_backfield: number;
  has_charted_open_data: boolean;
}
