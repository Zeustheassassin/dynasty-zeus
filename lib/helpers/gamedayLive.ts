// ============================================================
// Live-game math for the Gameday Hub: how much of a game is left, what a
// player is still expected to score, and how likely a matchup is to be won.
// Pure functions only — buildGamedayMatchups (lib/helpers/gameday.ts) is the
// single caller that turns these into the rows the UI renders.
// ============================================================
import { clamp } from "./math";
import { computeLeagueFpts } from "./scoring";
import { getLineupSlotEligiblePositions } from "./lineup";
import { getProjectionVolatility } from "./projectionVolatility";
import type {
  ProjectionRow, SleeperPlayer, TeamGameState, BenchRegret, BenchRegretSwap,
} from "../types";

const PERIOD_SECONDS = 15 * 60;
const REGULATION_PERIODS = 4;
const REGULATION_SECONDS = PERIOD_SECONDS * REGULATION_PERIODS;

// ── Game clock ──────────────────────────────────────────────

/**
 * Fraction of the game still to be played, 0..1. Upcoming = 1, Final = 0.
 * Returns null for a Live game with no period/clock data (an older cached
 * scoreboard payload, or ESPN omitting it) so the caller can fall back to
 * something honest instead of guessing.
 *
 * Overtime (period 5) is measured against the regulation length, so the
 * fraction there is tiny (a 10:00 OT period = 1/6) — the game is effectively
 * over as far as remaining-volume goes, which is the right read.
 */
export const gameFractionRemaining = (game: TeamGameState | null | undefined): number | null => {
  if (!game) return null;
  if (game.state === "Final") return 0;
  if (game.state === "Upcoming") return 1;
  if (game.status === "halftime") return 0.5;

  const period = game.period ?? 0;
  if (period < 1) return null;
  // No clock reading: assume the period just started rather than reporting 0.
  const clock = clamp(game.clockSeconds ?? PERIOD_SECONDS, 0, PERIOD_SECONDS);
  if (period > REGULATION_PERIODS) return clamp(clock / REGULATION_SECONDS, 0, 1);
  const secondsLeft = (REGULATION_PERIODS - period) * PERIOD_SECONDS + clock;
  return clamp(secondsLeft / REGULATION_SECONDS, 0, 1);
};

const quarterLabel = (period: number): string => (period > REGULATION_PERIODS ? "OT" : `Q${period}`);

/** Short live readout for a game: "Q3 4:12 · SF 17-10 · SF ball", "Halftime · SF 17-10".
 *  Empty string when there's nothing worth showing beyond the state pill. */
export const formatGameDetail = (game: TeamGameState | null | undefined, team?: string | null): string => {
  if (!game) return "";
  if (game.status === "postponed") return "Postponed";
  if (game.status === "canceled") return "Canceled";
  if (game.state === "Upcoming") return game.status === "delayed" ? "Delayed" : "";

  const scoreText = game.score != null && game.oppScore != null
    ? `${team ?? ""} ${game.score}-${game.oppScore}`.trim()
    : "";
  if (game.state === "Final") return scoreText;

  const clockText = game.status === "halftime"
    ? "Halftime"
    : game.period && game.period > 0
    ? `${quarterLabel(game.period)}${game.clockDisplay ? ` ${game.clockDisplay}` : ""}`
    : "";
  const prefix = game.status === "delayed" ? "Delayed" : clockText;
  const ball = game.hasPossession && team ? `${team} ball` : "";
  return [prefix, scoreText, ball].filter(Boolean).join(" · ");
};

// ── Who can't score ─────────────────────────────────────────

/** Expected share of a Doubtful player's projection actually played. */
export const DOUBTFUL_FACTOR = 0.2;

/** Statuses that mean the player will not (or no longer can) play. */
const RULED_OUT_RE = /\bout\b|\bir\b|\bpup\b|\bsus\b|suspend|inactive|injured reserve|retired/;

/** 0 for a player who can't play, a reduced factor for Doubtful, else 1.
 *  Deliberately mirrors the Lineup Coach's injury gate (Out/IR/Doubtful) but
 *  adds the other "can't play" tags. Sleeper's players map is cached for up to
 *  a day, so this reads the last-known status, not a live inactives list. */
export const playerAvailability = (player: SleeperPlayer | null | undefined): number => {
  if (!player) return 1;
  const s = `${player.injury_status ?? ""} ${player.status ?? ""}`.toLowerCase();
  if (RULED_OUT_RE.test(s)) return 0;
  if (/doubtful/.test(s)) return DOUBTFUL_FACTOR;
  return 1;
};
// ── Remaining-points model ──────────────────────────────────

/** Pace shrinkage: weight on observed pace = elapsed / (elapsed + K). K > 1 means
 *  even a finished game only gets ~40% pace / 60% projection — fantasy scoring
 *  is lumpy (TDs), so a hot start is only weak evidence of a hot finish. */
export const PACE_SHRINKAGE_K = 1.5;
/** Observed pace vs. projected pace is clamped to this range before blending so one long
 *  TD can't project a player to a 40-point game. */
export const PACE_RATIO_MIN = 0.4;
export const PACE_RATIO_MAX = 2.0;
/** Don't read pace until this much of the game (and this many projected points)
 *  has been played — 3 snaps of data isn't a pace. */
const MIN_ELAPSED_FOR_PACE = 0.1;
const MIN_EXPECTED_FOR_PACE = 1;

// Game-script sensitivity: how far a full one-score-plus (14 pt) lead moves a
// position's remaining volume. Heuristic constants — trailing teams pass, leading
// teams run. Tune here, nowhere else.
const SCRIPT_SENSITIVITY: Record<string, number> = { RB: 0.12, WR: -0.08, TE: -0.08, QB: -0.05 };
const SCRIPT_FULL_LEAD = 14;
/** Script only means something once a game has some shape; ramp in by halftime. */
const SCRIPT_FULL_AT_ELAPSED = 0.5;
const BLOWOUT_LEAD = 21;
const BLOWOUT_MAX_REMAINING = 0.25;
/** Leading-blowout garbage time: starting QB/pass catchers get pulled or stop targeting. */
const BLOWOUT_LEADER_FACTOR: Record<string, number> = { QB: 0.5, WR: 0.7, TE: 0.7 };

/** Multiplier on a player's remaining points from the score margin. `lead` is
 *  the player's team score minus the opponent's (null when unknown → neutral). */
export const gameScriptMultiplier = (
  position: string,
  lead: number | null,
  fractionRemaining: number
): number => {
  if (lead == null || fractionRemaining <= 0 || fractionRemaining >= 1) return 1;
  const elapsed = 1 - fractionRemaining;
  const sensitivity = SCRIPT_SENSITIVITY[position] ?? 0;
  const s = clamp(lead / SCRIPT_FULL_LEAD, -1, 1);
  const ramp = clamp(elapsed / SCRIPT_FULL_AT_ELAPSED, 0, 1);
  let factor = 1 + sensitivity * s * ramp;
  if (lead >= BLOWOUT_LEAD && fractionRemaining <= BLOWOUT_MAX_REMAINING) {
    factor *= BLOWOUT_LEADER_FACTOR[position] ?? 1;
  }
  return factor;
};

export interface RemainingInput {
  /** Full-game pre-game projection, already scored under this league's rules. */
  projected: number;
  /** Points scored so far, per the official Sleeper matchup. */
  actual: number;
  /** Fraction of the game left (see gameFractionRemaining). */
  fractionRemaining: number;
  position: string;
  /** Team score minus opponent score, or null when unknown. */
  lead: number | null;
  /** 0 = can't play, 1 = healthy (see playerAvailability). */
  availability: number;
}

/**
 * Expected points still to come for one player.
 *
 *   baseline = projected × fractionRemaining
 *   pace     = actual / (projected × elapsed)           (clamped, shrunk toward 1)
 *   remaining = baseline × pace × gameScript × availability
 *
 * Trusts the projection early and observed scoring later. Sleeper's matchup
 * feed only carries points (not a stat line), so pace is read at the points
 * level — the heavy shrinkage + clamp stand in for regressing TDs to expected.
 */
export const projectRemainingPoints = (input: RemainingInput): number => {
  const { projected, actual, fractionRemaining, position, lead, availability } = input;
  if (availability <= 0 || fractionRemaining <= 0 || projected <= 0) return 0;

  const baseline = projected * fractionRemaining;
  const elapsed = 1 - fractionRemaining;
  const expectedSoFar = projected * elapsed;

  let pace = 1;
  if (elapsed >= MIN_ELAPSED_FOR_PACE && expectedSoFar >= MIN_EXPECTED_FOR_PACE) {
    const ratio = clamp(actual / expectedSoFar, PACE_RATIO_MIN, PACE_RATIO_MAX);
    const weight = elapsed / (elapsed + PACE_SHRINKAGE_K);
    pace = 1 + weight * (ratio - 1);
  }

  return Math.max(baseline * pace * gameScriptMultiplier(position, lead, fractionRemaining) * availability, 0);
};

// ── Uncertainty + win probability ───────────────────────────

const STD_BASE = 2;
const STD_PER_PROJECTED_POINT = 0.4;
const VOLATILITY_STD_FACTOR = { volatile: 1.15, neutral: 1, safe: 0.9 } as const;

/** Std-dev of a player's remaining points. A full-game std-dev of roughly
 *  0.4 × projection + 2 (so ~8 for a 15-pt player), scaled by how much of the
 *  game is left (variance grows with time, so std-dev with its square root)
 *  and nudged by cross-source disagreement when 3+ sources matched. */
export const playerRemainingStdDev = (
  projection: Pick<ProjectionRow, "fpts" | "sourceFpts"> | null | undefined,
  projectedFull: number,
  fractionRemaining: number,
  availability: number
): number => {
  if (availability <= 0 || fractionRemaining <= 0 || projectedFull <= 0) return 0;
  const volatility = getProjectionVolatility(projection);
  const factor = VOLATILITY_STD_FACTOR[volatility?.level ?? "neutral"];
  const fullStd = (STD_BASE + STD_PER_PROJECTED_POINT * projectedFull) * factor;
  return fullStd * Math.sqrt(fractionRemaining);
};

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 erf approximation, |error| < 1.5e-7). */
export const normalCdf = (z: number): number => {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(z * z) / 2);
  return 0.5 * (1 + (z >= 0 ? erf : -erf));
};

/** Probability team A finishes ahead of team B, from each side's projected
 *  final and remaining-points std-dev. `covariance` is Cov(A, B) — positive when
 *  players on opposite sides share a game (e.g. my QB vs. the opponent's WR on
 *  the same NFL team), which narrows the spread of the *difference*. Exact
 *  0/1/0.5 when neither side has any uncertainty left. */
export const winProbability = (
  meanA: number,
  stdA: number,
  meanB: number,
  stdB: number,
  covariance = 0
): number => {
  const diff = meanA - meanB;
  const spread = Math.sqrt(Math.max(stdA * stdA + stdB * stdB - 2 * covariance, 0));
  if (spread < 1e-9) return diff > 1e-9 ? 1 : diff < -1e-9 ? 0 : 0.5;
  return normalCdf(diff / spread);
};

// ── Bench regret ────────────────────────────────────────────

interface RegretPlayer {
  playerId: string;
  name: string;
  position: string;
  points: number;
  isStarter: boolean;
}

const slotRestrictiveness = (slot: string): number => getLineupSlotEligiblePositions(slot).length;

/**
 * "Hindsight" lineup check on actual points so far: builds the best lineup the
 * roster could have started and reports the gap to what was actually started,
 * plus the bench-for-starter swaps that make it up.
 *
 * Fills the most restrictive slots first (QB before FLEX before SUPER_FLEX).
 * Position eligibility is nested (position ⊂ FLEX ⊂ SUPER_FLEX), so this greedy
 * order is optimal. Bench = healthy-or-not non-IR, non-taxi players; the caller
 * decides who's in the pool.
 */
export const computeBenchRegret = (
  starterSlots: string[],
  starters: RegretPlayer[],
  bench: RegretPlayer[]
): BenchRegret => {
  const pool = [...starters, ...bench];
  const used = new Set<string>();
  const slotOrder = starterSlots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => slotRestrictiveness(a.slot) - slotRestrictiveness(b.slot) || a.index - b.index);

  const chosen: RegretPlayer[] = [];
  for (const { slot } of slotOrder) {
    const eligible = getLineupSlotEligiblePositions(slot);
    let best: RegretPlayer | null = null;
    for (const p of pool) {
      if (used.has(p.playerId) || !eligible.includes(p.position)) continue;
      if (!best || p.points > best.points) best = p;
    }
    if (best) { used.add(best.playerId); chosen.push(best); }
  }

  const optimalPoints = chosen.reduce((total, p) => total + p.points, 0);
  const actualPoints = starters.reduce((total, p) => total + p.points, 0);
  const points = Math.max(optimalPoints - actualPoints, 0);

  // Pair bench players who made the optimal lineup with the starters who didn't,
  // best-with-worst, for a readable "start A over B" list.
  const benchIn = chosen.filter((p) => !p.isStarter).sort((a, b) => b.points - a.points);
  const chosenIds = new Set(chosen.map((p) => p.playerId));
  const startersOut = starters.filter((p) => !chosenIds.has(p.playerId)).sort((a, b) => a.points - b.points);
  const swaps: BenchRegretSwap[] = [];
  for (let i = 0; i < Math.min(benchIn.length, startersOut.length); i++) {
    const inn = benchIn[i];
    const out = startersOut[i];
    if (inn.points - out.points <= 0) continue;
    swaps.push({
      benchPlayerId: inn.playerId,
      benchName: inn.name,
      benchPoints: inn.points,
      starterPlayerId: out.playerId,
      starterName: out.name,
      starterPoints: out.points,
      gain: inn.points - out.points,
    });
  }

  return { points, optimalPoints, swaps };
};

// ── Poll cadence ────────────────────────────────────────────

export const POLL_LIVE_SCOREBOARD_MS = 30_000;
export const POLL_LIVE_MATCHUPS_MS = 45_000;
/** Cross-league dashboard polls slower: it costs one request per live league, and
 *  Sleeper's proxy already tripped 429s at ~78 requests per full load. */
export const POLL_LIVE_DASHBOARD_MS = 75_000;
export const POLL_IDLE_SCOREBOARD_MS = 5 * 60_000;
/** Poll fast starting this long before a kickoff so "Live" shows up promptly. */
const KICKOFF_SOON_MS = 15 * 60_000;
/** Inactives drop ~90 minutes before kickoff; re-pull projections from here on. */
const INACTIVES_WINDOW_MS = 2 * 60 * 60_000;
export const PROJECTION_REFRESH_MS = 15 * 60_000;

export interface GamedayPollPlan {
  /** Scoreboard refresh interval; null = stop (every game is Final). */
  scoreboardMs: number | null;
  /** Matchup-totals refresh interval; null unless a game is Live. */
  matchupsMs: number | null;
  /** Cross-league dashboard refresh interval; null unless a game is Live. */
  dashboardMs: number | null;
  /** A game kicks off within the inactives window — worth re-pulling projections. */
  refreshProjections: boolean;
  anyLive: boolean;
}

/** What to poll, and how often, given this week's scoreboard. Matchup points
 *  only change while games are Live, so nothing but the (cheap, server-cached)
 *  scoreboard is polled outside that. */
export const getGamedayPollPlan = (
  scheduleByTeam: Record<string, TeamGameState>,
  now: number = Date.now()
): GamedayPollPlan => {
  const games = Object.values(scheduleByTeam);
  if (games.length === 0) {
    // Nothing loaded (offseason or a failed fetch) — retry slowly.
    return { scoreboardMs: POLL_IDLE_SCOREBOARD_MS, matchupsMs: null, dashboardMs: null, refreshProjections: false, anyLive: false };
  }
  const anyLive = games.some((g) => g.state === "Live");
  const allFinal = games.every((g) => g.state === "Final");
  const upcoming = games.filter((g) => g.state === "Upcoming" && g.status !== "postponed");
  const kickoffSoon = upcoming.some((g) => g.kickoffAt - now <= KICKOFF_SOON_MS);
  const inInactivesWindow = upcoming.some((g) => g.kickoffAt > now && g.kickoffAt - now <= INACTIVES_WINDOW_MS);

  return {
    scoreboardMs: allFinal ? null : anyLive || kickoffSoon ? POLL_LIVE_SCOREBOARD_MS : POLL_IDLE_SCOREBOARD_MS,
    matchupsMs: anyLive ? POLL_LIVE_MATCHUPS_MS : null,
    dashboardMs: anyLive ? POLL_LIVE_DASHBOARD_MS : null,
    refreshProjections: inInactivesWindow,
    anyLive,
  };
};

// ── Correlation between players ─────────────────────────────

/** Just what pairwise correlation needs from one starter. */
export interface CorrelatedPlayer {
  position: string;
  team: string | null;
  /** The player's NFL opponent this week, when known. */
  opponent: string | null;
  /** Std-dev of the player's remaining points. */
  stdDev: number;
}

// Heuristic correlations of remaining fantasy points. Same NFL team: a QB's
// passing yards ARE his receivers' yards, so QB–WR/TE are strongly linked; RBs
// barely move with the passing game. Opposing sides of one game share pace and
// game total, so passing-game players correlate mildly. Tune here, nowhere else.
const SAME_TEAM_CORRELATION: Record<string, number> = {
  "QB|WR": 0.45,
  "QB|TE": 0.35,
  "QB|RB": 0.10,
  "WR|WR": 0.10,
  "TE|WR": 0.10,
};
const OPPOSING_PASSING_CORRELATION = 0.10;
const PASSING_GAME_POSITIONS = new Set(["QB", "WR", "TE"]);

/** Correlation (-1..1) of two starters' remaining points; 0 when unrelated. */
export const playerCorrelation = (a: CorrelatedPlayer, b: CorrelatedPlayer): number => {
  if (a.team && b.team && a.team === b.team) {
    return SAME_TEAM_CORRELATION[[a.position, b.position].sort().join("|")] ?? 0;
  }
  if (a.team && b.team && a.team === b.opponent && b.team === a.opponent) {
    return PASSING_GAME_POSITIONS.has(a.position) && PASSING_GAME_POSITIONS.has(b.position)
      ? OPPOSING_PASSING_CORRELATION
      : 0;
  }
  return 0;
};

/** Variance of the sum of one team's starters: Σσ² + 2·Σ ρ·σᵢ·σⱼ over pairs. */
export const teamVariance = (players: CorrelatedPlayer[]): number => {
  let variance = 0;
  for (let i = 0; i < players.length; i++) {
    variance += players[i].stdDev ** 2;
    for (let j = i + 1; j < players.length; j++) {
      variance += 2 * playerCorrelation(players[i], players[j]) * players[i].stdDev * players[j].stdDev;
    }
  }
  return Math.max(variance, 0);
};

/** Cov(team A total, team B total) — nonzero when starters on opposite fantasy
 *  sides share an NFL team or game. */
export const crossTeamCovariance = (a: CorrelatedPlayer[], b: CorrelatedPlayer[]): number => {
  let cov = 0;
  for (const p of a) {
    for (const q of b) cov += playerCorrelation(p, q) * p.stdDev * q.stdDev;
  }
  return cov;
};

// ── Per-stat pace (live stat lines) ─────────────────────────

/** Stat categories a projection's consensus `stats` line carries (see useProjections). */
export const LIVE_STAT_KEYS = ["pass_yd", "pass_td", "pass_int", "rush_yd", "rush_td", "rec", "rec_yd", "rec_td"] as const;

/** Volume stats read for pace, with the minimum expected-so-far before a ratio means anything. */
const PACE_STATS: Record<string, number> = { pass_yd: 30, rush_yd: 8, rec_yd: 8, rec: 1 };
/** Touchdowns and interceptions are NOT paced (a TD is a lump, not a rate): the
 *  remaining expectation is the projection's own, nudged only by how the related
 *  volume is going. Each TD stat is linked to its yardage stat. */
const TD_VOLUME_LINK: Record<string, string> = { pass_td: "pass_yd", rush_td: "rush_yd", rec_td: "rec_yd" };
const TD_VOLUME_LINK_STRENGTH = 0.5;

export type StatLine = Record<string, number>;

export interface StatRemainingInput {
  /** Full-game consensus stat line from the projection row. */
  projectedStats: StatLine;
  /** Cumulative live stats so far this game. */
  observedStats: StatLine;
  /** The projection's league-scored full-game total (recomputeConsensusFpts). */
  projectedFpts: number;
  fractionRemaining: number;
  position: string;
  lead: number | null;
  availability: number;
  scoring: Record<string, number>;
}

/** Per-category pace factor (1 = on pace) for the volume stats; only categories with enough data. */
const volumeFactors = (projected: StatLine, observed: StatLine, elapsed: number): Record<string, number> => {
  const factors: Record<string, number> = {};
  if (elapsed < MIN_ELAPSED_FOR_PACE) return factors;
  const weight = elapsed / (elapsed + PACE_SHRINKAGE_K);
  for (const [stat, minExpected] of Object.entries(PACE_STATS)) {
    const expected = (projected[stat] ?? 0) * elapsed;
    if (expected < minExpected) continue;
    const ratio = clamp((observed[stat] ?? 0) / expected, PACE_RATIO_MIN, PACE_RATIO_MAX);
    factors[stat] = 1 + weight * (ratio - 1);
  }
  return factors;
};

/**
 * Remaining points from a live stat line instead of a points total: each volume
 * stat (yards, receptions) extrapolates at its own shrunk pace; TDs/INTs regress
 * to the projection's expectation; then the remaining stat line is scored with the
 * league's own rules. Projection mass the stat line doesn't explain (bonuses,
 * fumbles, blended-in single-number sources) is carried at baseline, so at
 * kickoff the result equals the projection exactly.
 *
 * `observedFpts` is the observed stat line scored under the same rules — the
 * caller compares it with Sleeper's official points to detect a lagging stat feed.
 */
export const projectRemainingFromStats = (
  input: StatRemainingInput
): { remaining: number; observedFpts: number } => {
  const { projectedStats, observedStats, projectedFpts, fractionRemaining, position, lead, availability, scoring } = input;
  const observedFpts = computeLeagueFpts(observedStats, scoring, position);
  if (availability <= 0 || fractionRemaining <= 0) return { remaining: 0, observedFpts };

  const elapsed = 1 - fractionRemaining;
  const factors = volumeFactors(projectedStats, observedStats, elapsed);
  const script = gameScriptMultiplier(position, lead, fractionRemaining);

  const remainingStats: StatLine = {};
  for (const stat of LIVE_STAT_KEYS) {
    const projected = projectedStats[stat] ?? 0;
    if (!projected) continue;
    let factor = factors[stat] ?? 1;
    const linked = TD_VOLUME_LINK[stat];
    if (linked) factor = 1 + TD_VOLUME_LINK_STRENGTH * ((factors[linked] ?? 1) - 1);
    if (stat === "pass_int") factor = 1;
    remainingStats[stat] = projected * fractionRemaining * factor * script;
  }

  const trackedRemaining = computeLeagueFpts(remainingStats, scoring, position);
  const unexplained = projectedFpts - computeLeagueFpts(projectedStats, scoring, position);
  const remaining = Math.max((trackedRemaining + unexplained * fractionRemaining) * availability, 0);
  return { remaining, observedFpts };
};

/** A live stat feed is trusted only while its scored total roughly matches
 *  Sleeper's official points for the same player: stats can lag (or lead) the
 *  matchup feed, and the untracked scoring (fumbles, 2-pt, bonuses) leaves a
 *  small legitimate gap. */
export const liveStatsMatchOfficialPoints = (observedFpts: number, officialPoints: number): boolean =>
  Math.abs(observedFpts - officialPoints) <= Math.max(4, 0.25 * Math.max(observedFpts, officialPoints));
