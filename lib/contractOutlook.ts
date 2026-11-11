// ============================================================
// Who stays and who goes (contracts plan, stage 5)
// ============================================================
// Pure: a contract room (lib/contractRooms.ts) plus how much each player
// matters, his age and his team's situation → for the coming season, how
// likely each signed player is to be cut, how likely each expiring player is
// to stay, and how many starting spots that really leaves open.
//
// The user's rule (2026-11-11): a contract that LOOKS cuttable isn't enough.
// "If the team has 80 mil in cap space and he's an important player they
// probably will not cut him. If he's like 31 and the team is garbage and
// looking at a rebuild then yes they might." The same reasoning runs the
// other way for expiring deals: a young star gets re-signed or tagged (Puka
// Nacua, whose rookie deal ends after 2026), an old or marginal one walks.
//
// The user's tuning (same day), on Jacobs vs Jonathan Taylor: how LOPSIDED a
// release is matters, not just its size. Jacobs's 2027 saves $13.5M against
// $3.1M dead; Taylor's saves $11.0M against $10.0M, and a release that nets
// that little is one a team skips (it trades or keeps him; the Colts kept
// Taylor at the 2026 deadline while tanking). And a regular who has missed
// most of the season (Jacobs: injury and legal trouble, 3 of 9 games) is a
// cut risk BECAUSE of it, not protected by last season.
//
// Importance uses Dynasty+'s own definitions (lib/scouting/teamLanding.ts
// isEstablished, lib/nflRooms.ts grade bars) on PFF's offense grades and snap
// shares: a STAR graded in his position's top quarter on real snaps,
// ESTABLISHED a regular graded above its bottom quarter, a STARTER a regular
// graded under it (Jonathan Taylor 2026: 77% of snaps at 61.8, the RB bar
// 62.5), DEPTH everyone else with snaps. A player who played under
// MISSED_TIME of his team's games is judged by last season one level lower
// when that's better than this season, and a regular from last season who's
// been missing is UNAVAILABLE (a cut-risk point, a stay-odds point off). Age
// is past his position's prime by PRIME_END_AGE (dynastyScore.ts). Weights
// are first calls for the user to tune; the reasons list says why.
// ============================================================

import type { ContractStatus, CutMath } from "./contractStatus";
import { REGULAR_SHARE, type PositionBar, type RoomPos } from "./nflRooms";
import { STARTING_SPOTS, type PositionRoom, type RoomContract } from "./contractRooms";
import { STAR_SHARE, ageOnSept1, isEstablished } from "./scouting/teamLanding";
import { PRIME_END_AGE } from "./scouting/dynastyScore";

export type Importance = "star" | "established" | "starter" | "depth" | "unknown";
export type Direction = "contending" | "middle" | "rebuilding";

/** One season of PFF offense for a player. */
export interface SeasonLine {
  grade: number | null;
  /** Share of his team's offensive snaps, 0–1 (lib/nflRooms.ts snapShares). */
  share: number | null;
  /** Games he played. */
  games: number | null;
}

export interface PlayerContext {
  /** YYYY-MM-DD. */
  birthDate: string | null;
  /** This season so far; null without snaps. */
  current: SeasonLine | null;
  /** Last season, read when he missed much of this one. */
  prior: SeasonLine | null;
  /** Depth-chart order at his position (1 = first), the fallback when PFF has nothing. */
  depthOrder?: number | null;
}

/** Each position's grade bars for this season and last (lib/nflRooms.ts positionBars). */
export interface SeasonBars {
  current: PositionBar | null;
  prior: PositionBar | null;
}

/** How much he matters, what that's judged on (for the reasons), and whether he's been unavailable. */
export interface Judged {
  level: Importance;
  basis: string;
  /** A regular last season who played under MISSED_TIME of his team's games this season. */
  unavailable: boolean;
}

/** Played fewer than this share of his team's games: missed much of the season. */
export const MISSED_TIME = 0.6;

export interface TeamContext {
  /** This season's win percentage, 0–1. */
  winPct: number | null;
  gamesPlayed: number;
  /** Cap space for the coming season ($M, lib/contractRooms.ts; reads high by dead money from earlier releases). */
  capSpace: number | null;
}

/** A team at or under this win percentage is rebuilding; at or over CONTEND_WIN_PCT, contending. */
export const REBUILD_WIN_PCT = 0.35;
export const CONTEND_WIN_PCT = 0.6;
/** Fewer games than this and the record says nothing yet. */
export const MIN_GAMES = 4;
/** Coming-season cap space ($M) that means no pressure to clear room (the user's "80 mil" is well past it). */
export const ROOMY_CAP = 50;
/** A release that saves at least this much ($M) is worth making for the money alone. */
export const BIG_SAVINGS = 10;
/** Savings under this multiple of the dead money net too little to cut for (Taylor 2027: 1.1×). */
export const NETS_LITTLE = 1.5;
/** Savings at least this multiple of the dead money make a clean exit (Jacobs 2027: 4.3×)… */
export const CLEAN_EXIT = 3;
/** …when they're worth having ($M): a minimum backup with no dead money isn't a "clean exit", just a backup. */
export const CLEAN_EXIT_MIN = 3;

export interface CutCall {
  level: "low" | "possible" | "likely";
  score: number;
  reasons: string[];
  /** The release math for the season, when there is one. */
  cut: CutMath | null;
}

export interface StayCall {
  call: "stays" | "toss-up" | "leaves";
  score: number;
  reasons: string[];
}

export interface PlayerVerdict {
  player: RoomContract;
  importance: Importance;
  /** His age on Sept 1 of the season, null without a birth date. */
  age: number | null;
  /** A regular last season who has missed much of this one (see Judged). */
  unavailable: boolean;
  /** For a player signed for the season. */
  cut: CutCall | null;
  /** For a player whose deal ends before the season (practice-squad deals left out). */
  stay: StayCall | null;
  /** Expected to be one of the room's core players that season: signed or staying, not a likely cut, and
   *  invested in (the user's definition) or at least established. */
  core: boolean;
}

export interface RoomVerdict {
  pos: RoomPos;
  season: number;
  players: PlayerVerdict[];
  /** Core players expected for the season (see PlayerVerdict.core). */
  expectedCore: number;
  /** STARTING_SPOTS minus expectedCore, floored at 0: the spots a team still needs to fill. */
  openSpots: number;
}

const money = (v: number) => `$${v.toFixed(1)}M`;

const RANK: Record<Importance, number> = { star: 4, established: 3, starter: 2, depth: 1, unknown: 0 };
const ONE_DOWN: Record<Importance, Importance> = { star: "established", established: "starter", starter: "depth", depth: "depth", unknown: "unknown" };

function levelOf(line: SeasonLine | null | undefined, bar: PositionBar | null): Importance | null {
  if (!line || line.grade == null || line.share == null || !bar) return null;
  if (line.share >= STAR_SHARE && line.grade >= bar.star) return "star";
  if (isEstablished({ grade: line.grade, share: line.share }, bar)) return "established";
  return line.share >= REGULAR_SHARE ? "starter" : "depth";
}

/** Whether he played under MISSED_TIME of his team's games this season (or not at all). */
export function missedTime(ctx: PlayerContext | null, teamGames: number): boolean {
  if (!ctx?.current) return true;
  return ctx.current.games != null && teamGames > 0 && ctx.current.games < MISSED_TIME * teamGames;
}

/** How much he matters to his team (see the header). */
export function judgeImportance(ctx: PlayerContext | null, bars: SeasonBars, pos: RoomPos, teamGames: number): Judged {
  const now = levelOf(ctx?.current, bars.current);
  const missed = missedTime(ctx, teamGames);
  const prior = missed ? levelOf(ctx?.prior, bars.prior) : null;
  const unavailable = missed && ctx?.prior?.share != null && ctx.prior.share >= REGULAR_SHARE;
  const games = ctx?.current?.games;
  const played = `${games ? `${games} of ${teamGames} games` : "no snaps"} this season`;
  const before = prior ? ONE_DOWN[prior] : null;
  if (prior && before && (!now || RANK[before] > RANK[now])) {
    return { level: before, unavailable, basis: `${before}: a ${prior} last season, ${played}` };
  }
  if (now) return { level: now, unavailable, basis: unavailable ? `${now}, ${played}` : `${now} this season` };
  if (ctx?.depthOrder != null) {
    const level = ctx.depthOrder <= STARTING_SPOTS[pos] ? "established" : "depth";
    return { level, unavailable: false, basis: `${level} by the depth chart (no PFF snaps)` };
  }
  return { level: "unknown", unavailable: false, basis: "no snaps to judge him by" };
}

export function importanceOf(ctx: PlayerContext | null, bars: SeasonBars, pos: RoomPos, teamGames: number): Importance {
  return judgeImportance(ctx, bars, pos, teamGames).level;
}

export function teamDirection(team: TeamContext): Direction {
  if (team.winPct == null || team.gamesPlayed < MIN_GAMES) return "middle";
  if (team.winPct <= REBUILD_WIN_PCT) return "rebuilding";
  return team.winPct >= CONTEND_WIN_PCT ? "contending" : "middle";
}

const judged = (level: Importance): Judged => ({ level, basis: `${level} this season`, unavailable: false });
const IMPORTANCE_CUT: Record<Importance, number> = { star: -3, established: -1, starter: 0, depth: 1, unknown: 0 };

/** How likely a player signed for `season` is to be released before it (the user's rule, see the header).
 *  `who` is his importance, or a plain level read as "this season". */
export function cutRisk(status: ContractStatus, pos: RoomPos, who: Judged | Importance, age: number | null, team: TeamContext, season: number): CutCall | null {
  const j = typeof who === "string" ? judged(who) : who;
  if (status.endYear == null || status.endYear < season) return null;
  const cut = status.cuts.find((c) => c.year === season) ?? null;
  if (!cut) return { level: "low", score: 0, cut, reasons: [status.yearlyBreakdown ? `no release math for ${season}` : "a new deal OTC hasn't broken down yet"] };
  if (cut.savings < cut.deadMoney) {
    return { level: "low", score: 0, cut, reasons: [`releasing him in ${season} saves ${money(cut.savings)} and leaves ${money(cut.deadMoney)} dead`] };
  }

  const reasons = [`releasing him in ${season} saves ${money(cut.savings)} for ${money(cut.deadMoney)} dead`];
  let score = 0;
  const ratio = cut.deadMoney > 0.05 ? cut.savings / cut.deadMoney : Infinity;
  if (ratio < NETS_LITTLE) { score -= 2; reasons.push("that nets little: a team would rather trade or keep him"); }
  else if (ratio >= CLEAN_EXIT && cut.savings >= CLEAN_EXIT_MIN) { score += 1; reasons.push(Number.isFinite(ratio) ? `a clean exit (${ratio.toFixed(1)}× the dead money)` : "a clean exit (no dead money)"); }
  if (cut.savings >= BIG_SAVINGS) score += 1;
  score += IMPORTANCE_CUT[j.level];
  reasons.push(j.basis);
  if (j.unavailable) { score += 1; reasons.push("missed most of this season"); }
  const prime = PRIME_END_AGE[pos];
  if (age != null && age >= prime + 2) { score += 2; reasons.push(`${Math.floor(age)} in ${season}, well past a ${pos}'s prime (${prime})`); }
  else if (age != null && age >= prime) { score += 1; reasons.push(`${Math.floor(age)} in ${season}, past a ${pos}'s prime (${prime})`); }
  if (teamDirection(team) === "rebuilding" && age != null && age >= prime - 1) { score += 1; reasons.push("a veteran on a rebuilding team"); }
  if (team.capSpace != null && team.capSpace < 0) { score += 1; reasons.push(`the team is ${money(-team.capSpace)} over next year's cap`); }
  else if (team.capSpace != null && team.capSpace >= ROOMY_CAP) { score -= 1; reasons.push(`the team has ${money(team.capSpace)} of room`); }
  return { level: score >= 3 ? "likely" : score >= 1 ? "possible" : "low", score, cut, reasons };
}

const IMPORTANCE_STAY: Record<Importance, number> = { star: 2, established: 1, starter: 0, depth: -1, unknown: 0 };

/** How likely a player whose deal ends before `season` is to be back for it. */
export function stayOdds(status: ContractStatus, pos: RoomPos, who: Judged | Importance, age: number | null, team: TeamContext, season: number): StayCall | null {
  const j = typeof who === "string" ? judged(who) : who;
  if (!status.active || status.endYear == null || status.endYear >= season || status.kind === "practice") return null;
  const fa = status.freeAgency;
  if (fa === "ERFA" || fa === "RFA") {
    // An ERFA costs a minimum tender, so anyone who plays a real role is kept; an RFA tender costs more.
    const keeps = fa === "ERFA" ? RANK[j.level] >= RANK.starter : j.level === "star" || j.level === "established";
    const kind = fa === "ERFA" ? "exclusive" : "restricted";
    return keeps
      ? { call: "stays", score: 2, reasons: [`${kind} free agent: the team's to keep`] }
      : { call: "toss-up", score: 0, reasons: [`${kind} free agent, but ${j.basis}`] };
  }

  let score = IMPORTANCE_STAY[j.level];
  const reasons = [j.basis];
  if (j.unavailable) { score -= 1; reasons.push("missed most of this season"); }
  const prime = PRIME_END_AGE[pos];
  if (age != null && age >= prime + 2) { score -= 2; reasons.push(`${Math.floor(age)} in ${season}, well past a ${pos}'s prime (${prime})`); }
  else if (age != null && age >= prime) { score -= 1; reasons.push(`${Math.floor(age)} in ${season}, past a ${pos}'s prime (${prime})`); }
  else if (age != null && age < prime - 2) { score += 1; reasons.push(`${Math.floor(age)} in ${season}, young`); }
  if (teamDirection(team) === "rebuilding" && age != null && age >= prime - 1) { score -= 1; reasons.push("a veteran on a rebuilding team"); }
  if (team.capSpace != null && team.capSpace < 0) { score -= 1; reasons.push(`the team is ${money(-team.capSpace)} over next year's cap`); }
  return { call: score >= 2 ? "stays" : score >= 0 ? "toss-up" : "leaves", score, reasons };
}

/** A room's coming season once likely cuts go and likely re-signings stay. */
export function roomVerdict(
  room: PositionRoom,
  season: number,
  contextOf: (p: RoomContract) => PlayerContext | null,
  team: TeamContext,
  bars: SeasonBars,
): RoomVerdict {
  const players = room.players.map((player): PlayerVerdict => {
    const ctx = contextOf(player);
    const who = judgeImportance(ctx, bars, room.pos, team.gamesPlayed);
    const age = ageOnSept1(ctx?.birthDate ?? null, season);
    const cut = cutRisk(player.status, room.pos, who, age, team, season);
    const stay = stayOdds(player.status, room.pos, who, age, team, season);
    const counts = who.level === "star" || who.level === "established";
    const core = (cut != null && cut.level !== "likely" && (player.invested || counts)) || (stay?.call === "stays" && counts);
    return { player, importance: who.level, age, unavailable: who.unavailable, cut, stay, core };
  });
  const expectedCore = players.filter((p) => p.core).length;
  return { pos: room.pos, season, players, expectedCore, openSpots: Math.max(0, STARTING_SPOTS[room.pos] - expectedCore) };
}
