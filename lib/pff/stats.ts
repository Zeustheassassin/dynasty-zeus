// ============================================================
// PFF stats for charted games: what is stored and where it comes from.
// ============================================================
// Pure and client-safe (no key, no fetch). The import route (runImport.ts)
// turns PFF's rows into these columns; the app reads the columns from
// prospect_game_pff / prospect_season_pff (migration 063) and never the raw
// JSON. Column names here ARE the database column names.
//
// Per game: the player reports with a week list return one row per game
// (`weeks`), so every count is per game, and a sum over charted games equals
// PFF's own total for them. Per season: the same call also returns PFF's
// aggregate over exactly those weeks (`week_totals`), which is the only right
// source for grades (they aren't additive: Carnell Tate's 7 charted 2025 games
// average 76.4 by snaps, PFF grades the 7 together 88.9) and exact aDOT. The
// play-action, blitz and 20+ yard splits only exist as aggregates, and man /
// zone and team dropbacks come from team facets over the same weeks.
// Column meanings checked against real responses on 2026-10-05.
// ============================================================

export type PffPos = "QB" | "RB" | "WR" | "TE";

/** Report keys in the stored raw JSON (PFF's own response keys). */
export type PffReportKey =
  | "offense_summary" | "passing_summary" | "rushing_summary" | "receiving_summary" | "blocking_summary"
  | "passing_concept" | "passing_pressure" | "receiving_depth" | "receiving_scheme" | "team_passing";

export type PffRow = Record<string, unknown>;

// ── Per-game columns ─────────────────────────────────────────

export const GAME_STAT_KEYS = [
  "snaps",
  "grade_offense", "grade_pass", "grade_run", "grade_pass_route", "grade_run_block", "grade_pass_block", "grade_hands_drop",
  "dropbacks", "all_dropbacks", "attempts", "all_attempts", "aimed_passes", "completions", "pass_yards", "pass_td",
  "interceptions", "btt", "twp", "sacks", "throwaways", "rec_drops", "pressures_faced", "ttt_total", "pass_adot",
  "rush_att", "rush_yards", "designed_yards", "scrambles", "scramble_yards", "yco", "rush_mtf", "rush_15plus",
  "rush_15plus_yards", "rush_10plus", "gap_att", "zone_att", "rush_td", "fumbles",
  "routes", "pass_plays", "targets", "receptions", "rec_yards", "yac", "rec_mtf", "drops", "contested_targets",
  "contested_receptions", "rec_td", "rec_adot", "slot_snaps", "wide_snaps", "inline_snaps",
  "block_snaps", "run_block_snaps", "pass_block_snaps", "pressures_allowed", "sacks_allowed",
] as const;
export type GameStatKey = (typeof GAME_STAT_KEYS)[number];
export type PffGameStats = Record<GameStatKey, number | null>;

/** Averages and grades: one game's value, never summed across games. */
export const GAME_AVERAGE_KEYS: ReadonlySet<GameStatKey> = new Set([
  "grade_offense", "grade_pass", "grade_run", "grade_pass_route", "grade_run_block", "grade_pass_block",
  "grade_hands_drop", "pass_adot", "rec_adot",
]);

/** One stored game row as the app reads it (no raw). */
export interface PffGameRow extends PffGameStats {
  game_id: string;
  prospect_id: string;
  pff_player_id: number;
  pff_game_id: number;
  season: number;
  week: number;
  franchise_id: number | null;
  pff_position: string | null;
  fetched_at: string;
}

type Src = readonly [PffReportKey, string];
/** First source with a number wins, in order. `sum` adds every source present. */
type Rule = { from: readonly Src[]; sum?: true };

const one = (report: PffReportKey, col: string): Rule => ({ from: [[report, col]] });

const GAME_RULES: Record<GameStatKey, Rule> = {
  snaps: { from: [["offense_summary", "snap_counts_total"], ["blocking_summary", "snap_counts_offense"]] },
  grade_offense: { from: [["offense_summary", "grades_offense"], ["passing_summary", "grades_offense"], ["rushing_summary", "grades_offense"], ["receiving_summary", "grades_offense"], ["blocking_summary", "grades_offense"]] },
  grade_pass: { from: [["passing_summary", "grades_pass"], ["offense_summary", "grades_pass"]] },
  grade_run: { from: [["rushing_summary", "grades_run"], ["passing_summary", "grades_run"], ["offense_summary", "grades_run"]] },
  grade_pass_route: { from: [["receiving_summary", "grades_pass_route"], ["offense_summary", "grades_pass_route"]] },
  grade_run_block: { from: [["blocking_summary", "grades_run_block"], ["offense_summary", "grades_run_block"]] },
  grade_pass_block: { from: [["blocking_summary", "grades_pass_block"], ["receiving_summary", "grades_pass_block"], ["offense_summary", "grades_pass_block"]] },
  grade_hands_drop: one("receiving_summary", "grades_hands_drop"),

  dropbacks: one("passing_summary", "dropbacks"),
  all_dropbacks: one("passing_summary", "all_dropbacks"),
  attempts: one("passing_summary", "attempts"),
  all_attempts: one("passing_summary", "all_attempts"),
  aimed_passes: one("passing_summary", "aimed_passes"),
  completions: one("passing_summary", "completions"),
  pass_yards: one("passing_summary", "yards"),
  pass_td: one("passing_summary", "touchdowns"),
  interceptions: one("passing_summary", "interceptions"),
  btt: one("passing_summary", "big_time_throws"),
  twp: one("passing_summary", "turnover_worthy_plays"),
  sacks: one("passing_summary", "sacks"),
  throwaways: one("passing_summary", "thrown_aways"),
  rec_drops: one("passing_summary", "drops"),
  pressures_faced: one("passing_summary", "def_gen_pressures"),
  ttt_total: one("passing_summary", "ttt_total_time"),
  pass_adot: one("passing_summary", "avg_depth_of_target"),

  rush_att: one("rushing_summary", "attempts"),
  rush_yards: one("rushing_summary", "yards"),
  designed_yards: one("rushing_summary", "designed_yards"),
  scrambles: one("rushing_summary", "scrambles"),
  scramble_yards: one("rushing_summary", "scramble_yards"),
  yco: one("rushing_summary", "yards_after_contact"),
  rush_mtf: one("rushing_summary", "avoided_tackles"),
  rush_15plus: one("rushing_summary", "breakaway_attempts"),
  rush_15plus_yards: one("rushing_summary", "breakaway_yards"),
  rush_10plus: one("rushing_summary", "explosive"),
  gap_att: one("rushing_summary", "gap_attempts"),
  zone_att: one("rushing_summary", "zone_attempts"),
  rush_td: one("rushing_summary", "touchdowns"),
  // Fumbles as a runner plus as a receiver.
  fumbles: { from: [["rushing_summary", "fumbles"], ["receiving_summary", "fumbles"]], sum: true },

  routes: one("receiving_summary", "routes"),
  pass_plays: one("receiving_summary", "pass_plays"),
  targets: one("receiving_summary", "targets"),
  receptions: one("receiving_summary", "receptions"),
  rec_yards: one("receiving_summary", "yards"),
  yac: one("receiving_summary", "yards_after_catch"),
  rec_mtf: one("receiving_summary", "avoided_tackles"),
  drops: one("receiving_summary", "drops"),
  contested_targets: one("receiving_summary", "contested_targets"),
  contested_receptions: one("receiving_summary", "contested_receptions"),
  rec_td: one("receiving_summary", "touchdowns"),
  rec_adot: one("receiving_summary", "avg_depth_of_target"),
  slot_snaps: one("receiving_summary", "slot_snaps"),
  wide_snaps: one("receiving_summary", "wide_snaps"),
  inline_snaps: one("receiving_summary", "inline_snaps"),

  block_snaps: one("blocking_summary", "snap_counts_block"),
  run_block_snaps: one("blocking_summary", "snap_counts_run_block"),
  pass_block_snaps: one("blocking_summary", "snap_counts_pass_block"),
  pressures_allowed: one("blocking_summary", "pressures_allowed"),
  sacks_allowed: one("blocking_summary", "sacks_allowed"),
};

// ── Per-season columns (PFF's aggregate over the charted weeks) ──

const SPLIT_PREFIXES = ["pa", "npa", "blitz", "no_blitz"] as const;
const SPLIT_STATS = ["dropbacks", "attempts", "aimed", "completions", "drops", "yards", "btt", "twp", "sacks"] as const;
type SplitKey = `${(typeof SPLIT_PREFIXES)[number]}_${(typeof SPLIT_STATS)[number]}`;

export const SEASON_STAT_KEYS = [
  "grade_offense", "grade_pass", "grade_run", "grade_pass_route", "grade_run_block", "grade_pass_block", "grade_hands_drop",
  "pass_adot", "rec_adot",
  ...SPLIT_PREFIXES.flatMap((p) => SPLIT_STATS.map((s) => `${p}_${s}` as SplitKey)),
  "deep_targets", "deep_receptions", "deep_yards",
  "man_routes", "man_targets", "man_receptions", "man_yards",
  "zone_routes", "zone_targets", "zone_receptions", "zone_yards",
  "team_dropbacks",
] as const;
export type SeasonStatKey = (typeof SEASON_STAT_KEYS)[number];
export type PffSeasonStats = Record<SeasonStatKey, number | null>;

/** Grades and aDOT: combined across seasons by a weight, never summed. */
export const SEASON_AVERAGE_KEYS = [
  "grade_offense", "grade_pass", "grade_run", "grade_pass_route", "grade_run_block", "grade_pass_block",
  "grade_hands_drop", "pass_adot", "rec_adot",
] as const satisfies readonly SeasonStatKey[];
export type SeasonAverageKey = (typeof SEASON_AVERAGE_KEYS)[number];

/** The per-game count each season average is weighted by when seasons combine. */
export const SEASON_AVERAGE_WEIGHT: Record<SeasonAverageKey, GameStatKey> = {
  grade_offense: "snaps",
  grade_pass: "dropbacks",
  grade_run: "rush_att",
  grade_pass_route: "routes",
  grade_run_block: "run_block_snaps",
  grade_pass_block: "pass_block_snaps",
  grade_hands_drop: "targets",
  pass_adot: "attempts",
  rec_adot: "targets",
};

export interface PffSeasonRow extends PffSeasonStats {
  prospect_id: string;
  pff_player_id: number;
  season: number;
  pff_game_ids: number[];
  weeks: number[];
  fetched_at: string;
}

// PFF's column for each split stat (the prefix is the same as ours).
const SPLIT_COL: Record<(typeof SPLIT_STATS)[number], string> = {
  dropbacks: "dropbacks", attempts: "attempts", aimed: "aimed_passes", completions: "completions", drops: "drops",
  yards: "yards", btt: "big_time_throws", twp: "turnover_worthy_plays", sacks: "sacks",
};

const SEASON_RULES: Record<Exclude<SeasonStatKey, SplitKey | "team_dropbacks">, Rule> = {
  grade_offense: GAME_RULES.grade_offense,
  grade_pass: GAME_RULES.grade_pass,
  grade_run: GAME_RULES.grade_run,
  grade_pass_route: GAME_RULES.grade_pass_route,
  grade_run_block: GAME_RULES.grade_run_block,
  grade_pass_block: GAME_RULES.grade_pass_block,
  grade_hands_drop: GAME_RULES.grade_hands_drop,
  pass_adot: GAME_RULES.pass_adot,
  rec_adot: GAME_RULES.rec_adot,
  deep_targets: one("receiving_depth", "deep_targets"),
  deep_receptions: one("receiving_depth", "deep_receptions"),
  deep_yards: one("receiving_depth", "deep_yards"),
  man_routes: one("receiving_scheme", "man_routes"),
  man_targets: one("receiving_scheme", "man_targets"),
  man_receptions: one("receiving_scheme", "man_receptions"),
  man_yards: one("receiving_scheme", "man_yards"),
  zone_routes: one("receiving_scheme", "zone_routes"),
  zone_targets: one("receiving_scheme", "zone_targets"),
  zone_receptions: one("receiving_scheme", "zone_receptions"),
  zone_yards: one("receiving_scheme", "zone_yards"),
};

// ── Extraction ───────────────────────────────────────────────

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function apply(rule: Rule, rows: Partial<Record<PffReportKey, PffRow>>): number | null {
  if (rule.sum) {
    let total: number | null = null;
    for (const [report, col] of rule.from) {
      const v = num(rows[report]?.[col]);
      if (v != null) total = (total ?? 0) + v;
    }
    return total;
  }
  for (const [report, col] of rule.from) {
    const v = num(rows[report]?.[col]);
    if (v != null) return v;
  }
  return null;
}

/** One game's columns from his rows in each weekly report (absent report = NULLs). */
export function extractGameStats(rows: Partial<Record<PffReportKey, PffRow>>): PffGameStats {
  const out = {} as PffGameStats;
  for (const k of GAME_STAT_KEYS) out[k] = apply(GAME_RULES[k], rows);
  return out;
}

/**
 * One season's columns from PFF's aggregates over the charted weeks.
 * `scheme` holds his man / zone row per franchise he played for in those
 * weeks, `teamPassing` every passer's row for those teams (summed into the
 * team's dropbacks); both are summed, since a franchise's weeks don't overlap.
 */
export function extractSeasonStats(
  totals: Partial<Record<PffReportKey, PffRow>>,
  scheme: readonly PffRow[] = [],
  teamPassing: readonly PffRow[] = [],
): PffSeasonStats {
  const out = {} as PffSeasonStats;
  for (const [k, rule] of Object.entries(SEASON_RULES) as [keyof typeof SEASON_RULES, Rule][]) {
    const [report] = rule.from[0];
    out[k] = report === "receiving_scheme"
      ? sumRows(scheme, rule.from[0][1])
      : apply(rule, totals);
  }
  for (const p of SPLIT_PREFIXES) {
    const src: PffReportKey = p === "pa" || p === "npa" ? "passing_concept" : "passing_pressure";
    for (const s of SPLIT_STATS) out[`${p}_${s}`] = num(totals[src]?.[`${p}_${SPLIT_COL[s]}`]);
  }
  out.team_dropbacks = sumRows(teamPassing, "dropbacks");
  return out;
}

function sumRows(rows: readonly PffRow[], col: string): number | null {
  let total: number | null = null;
  for (const r of rows) {
    const v = num(r[col]);
    if (v != null) total = (total ?? 0) + v;
  }
  return total;
}

// ── Which reports each position needs ────────────────────────

/** Player reports with week rows + an aggregate: endpoint path → raw key. */
export const WEEKLY_REPORTS: Record<PffPos, readonly (readonly [string, PffReportKey])[]> = {
  QB: [["passing/summary", "passing_summary"], ["rushing/summary", "rushing_summary"], ["offense/summary", "offense_summary"]],
  RB: [["rushing/summary", "rushing_summary"], ["receiving/summary", "receiving_summary"], ["offense/blocking", "blocking_summary"]],
  WR: [["receiving/summary", "receiving_summary"], ["offense/blocking", "blocking_summary"]],
  TE: [["receiving/summary", "receiving_summary"], ["offense/blocking", "blocking_summary"]],
};

/** Player reports PFF only gives as an aggregate over the requested weeks. */
export const AGGREGATE_REPORTS: Record<PffPos, readonly (readonly [string, PffReportKey])[]> = {
  QB: [["passing/concept", "passing_concept"], ["passing/pressure", "passing_pressure"]],
  RB: [],
  WR: [["receiving/depth", "receiving_depth"]],
  TE: [["receiving/depth", "receiving_depth"]],
};

/** Whether the position needs the team facets (man / zone, team dropbacks). */
export const NEEDS_TEAM_FACETS: Record<PffPos, boolean> = { QB: false, RB: false, WR: true, TE: true };

export function pffPos(position: string): PffPos | null {
  return position === "QB" || position === "RB" || position === "WR" || position === "TE" ? position : null;
}

/** PostgREST select lists (no raw: the app never loads it). */
export const GAME_ROW_SELECT = [
  "game_id", "prospect_id", "pff_player_id", "pff_game_id", "season", "week", "franchise_id", "pff_position", "fetched_at",
  ...GAME_STAT_KEYS,
].join(",");
export const SEASON_ROW_SELECT = [
  "prospect_id", "pff_player_id", "season", "pff_game_ids", "weeks", "fetched_at", ...SEASON_STAT_KEYS,
].join(",");
