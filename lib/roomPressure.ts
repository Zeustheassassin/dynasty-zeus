// ============================================================
// Room pressure: how likely a team brings in competition (contracts plan, stage 6)
// ============================================================
// Pure: a team's room at one position (open starting spots, lib/contractRooms.ts)
// + its draft picks (lib/nflDraftPicks.ts) + where its picks are likely to land
// (standings) → the odds it adds a player there: a first-rounder, a day 1–2
// pick (rounds 1–3), a day 3 pick (rounds 4–7), or a veteran it invests in
// (signing or trade). The user's question (2026-11-11): how stable is a
// player's situation, and does a rookie have a path.
//
// Every number here was MEASURED, none tuned (scratch study, 2026-11-11, on
// nflverse's historical_contracts + draft_picks + games):
//   * Rooms rebuilt as they stood after each season 2015–2025 (the view this
//     app has in November: deals signed by then that run into the next season,
//     "invested" on the user's definition, R1 5th-year options counted), then
//     what each team drafted the next April (2016–2026 drafts): 1,408 team-
//     position rooms, 345 day 1–2 picks at QB / RB / WR / TE.
//   * PICK_SHARE: each round's share of picks at the position, 2016–2026.
//     Round 1 is split at pick 10: 23.6% of top-10 picks were QBs, 4.6% of
//     picks 11–32. No other position moved with the slot.
//   * NEED: a Poisson fit of picks at the position against the base rate,
//     log-linear in the share of starting spots open. An open room draft-
//     picks the position 1.80× as often as a full one on days 1–2 (z 4.5),
//     2.51× in round 1 (z 4.2), 1.30× on day 3 (z 2.4); the same in
//     2016–20 and 2021–26, and per position within noise (QB 2.35×, others
//     1.65× on days 1–2), so one pooled curve. The predicted odds track what
//     happened by quintile (day 1–2: 8 / 13 / 19 / 27 / 43% predicted vs 6 /
//     13 / 22 / 26 / 50% seen).
//   * VETERAN_ADD: the share of rooms that added an invested veteran (on the
//     team that season, not the one before, not a rookie), by open spots.
//     RB showed no effect (8.1% full vs 6.7% open), so it's pooled.
//   * Draft picks and veteran adds came out independent (either one: QB open
//     36.8% seen vs 34.8% if independent, WR 2+ open 65.9 vs 66.1), so
//     `any` multiplies them.
//   * topTenOdds: P(a team's own round-1 pick lands in the top 10) from its
//     rank by record so far, a logistic whose spread shrinks with the games
//     left (seasons 2010–2025, 8,352 team-weeks; within ~3 pts by decile).
//
// The open-spot count it was measured on is stage 4's contract-only count
// (PositionRoom.outlook openSpots: STARTING_SPOTS minus invested players
// signed for the season). Stage 5's roomVerdict count (likely cuts and
// re-signings, established players) is a different count the rates weren't
// measured on. Compensatory and JC-2A picks (rounds 3–7, after March) aren't
// known yet and aren't counted.
// ============================================================

import { STARTING_SPOTS } from "./contractRooms";
import type { RoomPos } from "./nflRooms";
import { DRAFT_ROUNDS, type OwnedPick, type TeamDraftCapital } from "./nflDraftPicks";

/** Where a pick sits: round 1 split at pick 10 (QBs go early), then by round. */
export type PickBand = "R1top" | "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7";

/** Share of each band's picks at the position (2016–2026 drafts, nflverse draft_picks). */
export const PICK_SHARE: Record<RoomPos, Record<PickBand, number>> = {
  QB: { R1top: 0.236, R1: 0.046, R2: 0.02, R3: 0.038, R4: 0.036, R5: 0.036, R6: 0.047, R7: 0.045 },
  RB: { R1top: 0.064, R1: 0.037, R2: 0.062, R3: 0.068, R4: 0.114, R5: 0.086, R6: 0.085, R7: 0.093 },
  WR: { R1top: 0.136, R1: 0.138, R2: 0.151, R3: 0.127, R4: 0.121, R5: 0.103, R6: 0.137, R7: 0.117 },
  TE: { R1top: 0.027, R1: 0.037, R2: 0.065, R3: 0.066, R4: 0.073, R5: 0.074, R6: 0.038, R7: 0.053 },
};
/** Top-10 picks of round 1. */
export const TOP_PICKS = 10;
/** Teams in the league: a team's chance at a top-10 pick when nothing is known. */
const TEAMS = 32;

export type PickWindow = "round1" | "day12" | "day3";
/** How much more often than the base rate a room drafts its position: [full room, every starting spot open],
 *  log-linear between by the share of spots open (measured, see the header). */
export const NEED: Record<PickWindow, readonly [number, number]> = {
  round1: [0.69, 1.74],
  day12: [0.82, 1.47],
  day3: [0.92, 1.2],
};
const WINDOW_ROUNDS: Record<PickWindow, readonly [number, number]> = { round1: [1, 1], day12: [1, 3], day3: [4, DRAFT_ROUNDS] };
/** One pick's chance at a position never reads above this (the product would go negative). */
const PICK_CAP = 0.95;

/** Share of rooms that added a veteran the team invested in, by open starting spots (index = spots open,
 *  the last value for anything more). Measured, see the header. */
export const VETERAN_ADD: Record<RoomPos, readonly number[]> = {
  QB: [0.06, 0.103],
  RB: [0.077, 0.077],
  WR: [0.238, 0.228, 0.412],
  TE: [0.107, 0.292],
};

/** The draft-slot logistic: P(top 10) = 1 / (1 + e^((rank − center) / spread)), spread = SLOT_SPREAD ×
 *  √(games left ÷ season games) + SLOT_SPREAD_FLOOR. Rank 1 = the worst record. */
export const SLOT_CENTER = 10.25;
export const SLOT_SPREAD = 5.75;
export const SLOT_SPREAD_FLOOR = 0.2;
export const SEASON_GAMES = 17;

/** Chance a team ranked `rank` by record (1 = worst) after `gamesPlayed` games picks in the top 10. */
export function topTenOdds(rank: number, gamesPlayed: number, seasonGames = SEASON_GAMES): number {
  const left = Math.max(0, seasonGames - gamesPlayed);
  const spread = SLOT_SPREAD * Math.sqrt(left / seasonGames) + SLOT_SPREAD_FLOOR;
  return 1 / (1 + Math.exp((rank - SLOT_CENTER) / spread));
}

export interface TeamRecord {
  teamId: number;
  /** 0–1, ties as half a win. */
  winPct: number;
  pointDiff: number;
  gamesPlayed: number;
}

/** Each team's chance its own round-1 pick lands in the top 10, from the standings (worst record first,
 *  point differential breaking ties the way strength of schedule would, roughly). */
export function topTenByTeam(records: readonly TeamRecord[]): Map<number, number> {
  const order = [...records].sort((a, b) => a.winPct - b.winPct || a.pointDiff - b.pointDiff || a.teamId - b.teamId);
  return new Map(order.map((r, i) => [r.teamId, topTenOdds(i + 1, r.gamesPlayed)]));
}

/** The NEED multiplier for a room with `openSpots` of its starting spots open. */
export function needMultiplier(window: PickWindow, pos: RoomPos, openSpots: number): number {
  const [full, open] = NEED[window];
  const frac = Math.min(1, Math.max(0, openSpots / STARTING_SPOTS[pos]));
  return Math.exp(Math.log(full) + frac * (Math.log(open) - Math.log(full)));
}

/** One pick's base chance at the position: round 1 blends its top-10 and later shares by the pick's top-10 odds. */
export function pickShare(pos: RoomPos, round: number, topTen: number): number {
  const s = PICK_SHARE[pos];
  if (round === 1) return topTen * s.R1top + (1 - topTen) * s.R1;
  return s[`R${round}` as PickBand] ?? 0;
}

export interface RoomPressureInput {
  pos: RoomPos;
  /** Starting spots open for the draft's season, stage 4's count (see the header). */
  openSpots: number;
  /** The team's picks in that draft; null when unknown (veteran odds only). */
  capital: TeamDraftCapital | null;
  /** A pick's top-10 odds from its ORIGINAL team (topTenByTeam); absent → 10 in 32. */
  topTenOf?: (originalTeam: number) => number | undefined;
}

export interface RoomPressure {
  pos: RoomPos;
  openSpots: number;
  /** Chance the team drafts the position in round 1 / rounds 1–3 / rounds 4–7; null without picks. */
  round1: number | null;
  day12: number | null;
  day3: number | null;
  /** Chance it adds a veteran it invests in (signing or trade). */
  veteran: number;
  /** Chance of either a day 1–2 pick or a veteran (independent, see the header); veteran alone without picks. */
  any: number;
  /** Picks held: [day 1, day 2, day 3]; null without picks. */
  picks: [number, number, number] | null;
  /** Round-1 picks likely in the top 10 (≥ 50%). */
  likelyTopTen: number;
  /** Picks held on a condition (a "whichever is earlier", or one that may not convey). */
  uncertainPicks: number;
  reasons: string[];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** The odds a team brings in competition at one position (see the header). */
export function roomPressure({ pos, openSpots, capital, topTenOf }: RoomPressureInput): RoomPressure {
  const spots = STARTING_SPOTS[pos];
  const open = Math.min(spots, Math.max(0, openSpots));
  const vets = VETERAN_ADD[pos];
  const veteran = vets[Math.min(open, vets.length - 1)];
  const reasons = [`${open} of ${spots} starting ${pos} spot${spots > 1 ? "s" : ""} open`];
  const topTen = (p: OwnedPick) => (p.round === 1 ? topTenOf?.(p.original) ?? TOP_PICKS / TEAMS : 0);

  if (!capital) {
    return { pos, openSpots: open, round1: null, day12: null, day3: null, veteran, any: veteran, picks: null, likelyTopTen: 0, uncertainPicks: 0, reasons };
  }

  const odds = (window: PickWindow): number => {
    const [lo, hi] = WINDOW_ROUNDS[window];
    const m = needMultiplier(window, pos, open);
    let none = 1;
    for (const p of capital.picks) {
      if (p.round < lo || p.round > hi) continue;
      none *= 1 - Math.min(PICK_CAP, pickShare(pos, p.round, topTen(p)) * m);
    }
    return 1 - none;
  };
  const round1 = odds("round1");
  const day12 = odds("day12");
  const day3 = odds("day3");
  const likelyTopTen = capital.picks.filter((p) => p.round === 1 && topTen(p) >= 0.5).length;
  const uncertainPicks = capital.picks.filter((p) => p.conditional).length;

  const [d1, d2, d3] = capital.byDay;
  reasons.push(`${d1} first-round pick${d1 === 1 ? "" : "s"}${likelyTopTen ? ` (${likelyTopTen} likely top ${TOP_PICKS})` : ""}, ${d2} on day 2, ${d3} on day 3`);
  if (uncertainPicks) reasons.push(`${uncertainPicks} of them conditional`);
  reasons.push(`veteran added: ${pct(veteran)} for a room like this`);
  return { pos, openSpots: open, round1, day12, day3, veteran, any: 1 - (1 - day12) * (1 - veteran), picks: [d1, d2, d3], likelyTopTen, uncertainPicks, reasons };
}
