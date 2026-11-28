// ============================================================
// Positional value per league (stage 1 of the 2026-11-27 plan)
// ============================================================
// How much each position is worth in a league compared with the user's usual
// format (the one their scouting OVR is built for), from lineup math on real
// NFL seasons. The user's calls (2026-11-27): lineup math, not FantasyCalc
// ("I don't always agree with FantasyCalc's market values"); every starting
// slot, the team count and every scoring rule count, bench / taxi / rookie
// rounds don't, best ball the same; no cap; no roster need; they have no 1QB
// leagues. The scouting board stays tape-only: these numbers are for the
// Draft Hub (stage 2's league picker, stage 3's live draft), and nothing reads
// them until the user has reviewed them on League Formats.
//
// For one format (teams, starting slots, scoring):
//   1. Points per game of every QB / RB / WR / TE season line with MIN_GAMES+
//      games (nflSeasonLines.ts, the last 3 finished seasons), scored with the
//      format's own scoring_settings (computeLeagueFpts, as Sleeper scores).
//   2. Per position, the k-th best points per game, averaged over the seasons:
//      one curve per position.
//   3. Fill the starting lineups: each position's own slots × teams, then each
//      flex slot (W/T, W/R, FLEX, then superflex: the narrowest first) with the
//      best player left who can fill it.
//   4. Replacement = the best one who doesn't start. Starting value = the top
//      VALUE_DEPTH (24) at the position, points per game above replacement,
//      summed: the starting outcomes a rookie is drafted for (the top 12 and
//      every starter were tried too, 2026-11-27; the top 24 sits between).
//   5. Share = the position's part of the four positions' starting value.
// A league's multiplier for a position = its share there ÷ its share in the
// usual format. Only how the positions compare moves a board, so shares, not
// raw value: a 14-team league raises every position's raw value, and only
// what moves relative to the rest shows (QB ×1.11 there, on 2023–25).
// Pure.
// ============================================================

import { computeLeagueFpts } from "./scoring";
import type { LeagueFormat } from "./leagueFormat";
import { LINE_POSITIONS, type LinePos, type SeasonLine } from "./nflSeasonLines";

/** A season line counts from this many games (half a season), so a 3-game hot start doesn't set the top of a curve. */
export const MIN_GAMES = 8;

/** Starting value counts the top this many at each position (those who start, above replacement). */
export const VALUE_DEPTH = 24;

/** The user's statement of the format their OVR is built for (2026-11-27): Superflex, PPR, half-point TE premium, 4-point passing TDs. */
export const HOME_SCORING_PINNED: Readonly<Record<string, number>> = { rec: 1, bonus_rec_te: 0.5, pass_td: 4 };

/** Who can fill each flex slot, and the order they're filled in (narrowest first). */
export const FLEX_ELIGIBLE: Readonly<Record<string, readonly LinePos[]>> = {
  REC_FLEX: ["WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  FLEX: ["RB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};
const FLEX_ORDER = ["REC_FLEX", "WRRB_FLEX", "FLEX", "SUPER_FLEX"] as const;

/** What the math reads off a league. */
export interface ValueFormat {
  teams: number;
  /** Starting slots by Sleeper name (bench, IR and taxi aside). */
  slots: Record<string, number>;
  scoring: Record<string, number>;
}

export type Curves = Record<LinePos, number[]>;

export interface PositionValue {
  /** Starters league-wide: own slots × teams + those in flex slots. */
  starters: number;
  /** Of those, in a flex or superflex slot. */
  inFlex: number;
  /** Points per game of the best one who doesn't start (rank starters + 1). */
  replacement: number;
  /** The top VALUE_DEPTH starters' points per game above replacement, summed. */
  value: number;
  /** This position's part of the four positions' value (0–1). */
  share: number;
}
export type FormatValue = Record<LinePos, PositionValue>;

export interface LeagueValue {
  /** The position's share of starting value ÷ its share in the usual format; null when the usual format gives it none. */
  mult: Record<LinePos, number | null>;
  league: FormatValue;
  home: FormatValue;
}

/** Each position's points-per-game curve under a scoring: the k-th best, averaged over the seasons (to the shortest season's depth). */
export function pointsCurves(lines: readonly SeasonLine[], scoring: Record<string, number>, minGames = MIN_GAMES): Curves {
  const bySeason = new Map<number, Record<LinePos, number[]>>();
  for (const l of lines) {
    if (l.games < minGames) continue;
    let s = bySeason.get(l.season);
    if (!s) { s = { QB: [], RB: [], WR: [], TE: [] }; bySeason.set(l.season, s); }
    s[l.pos].push(computeLeagueFpts(l.stats, scoring, l.pos) / l.games);
  }
  const out = { QB: [], RB: [], WR: [], TE: [] } as Curves;
  const seasons = [...bySeason.values()];
  if (seasons.length === 0) return out;
  for (const pos of LINE_POSITIONS) {
    const sorted = seasons.map((s) => [...s[pos]].sort((a, b) => b - a));
    const depth = Math.min(...sorted.map((s) => s.length));
    for (let k = 0; k < depth; k++) out[pos].push(sorted.reduce((sum, s) => sum + s[k], 0) / sorted.length);
  }
  return out;
}

/** The curve's value at a 0-based rank; past its end, its last value (a format deeper than the data). */
const at = (curve: readonly number[], k: number) => (curve.length === 0 ? 0 : curve[Math.min(k, curve.length - 1)]);

/** Fill every team's starting lineup from the curves and read each position's starters, replacement and starting value. */
export function formatValue(curves: Curves, f: ValueFormat): FormatValue {
  const teams = Math.max(0, Math.round(f.teams));
  const count = { QB: 0, RB: 0, WR: 0, TE: 0 } as Record<LinePos, number>;
  const inFlex = { QB: 0, RB: 0, WR: 0, TE: 0 } as Record<LinePos, number>;
  for (const pos of LINE_POSITIONS) count[pos] = (f.slots[pos] ?? 0) * teams;
  for (const slot of FLEX_ORDER) {
    const eligible = FLEX_ELIGIBLE[slot];
    for (let i = 0; i < (f.slots[slot] ?? 0) * teams; i++) {
      let best: LinePos | null = null;
      for (const pos of eligible) {
        if (curves[pos].length === 0) continue;
        if (best == null || at(curves[pos], count[pos]) > at(curves[best], count[best])) best = pos;
      }
      if (best == null) break;
      count[best]++;
      inFlex[best]++;
    }
  }
  const out = {} as FormatValue;
  for (const pos of LINE_POSITIONS) {
    const curve = curves[pos];
    const replacement = at(curve, count[pos]);
    let value = 0;
    for (let k = 0; k < Math.min(count[pos], VALUE_DEPTH); k++) value += Math.max(0, at(curve, k) - replacement);
    out[pos] = { starters: count[pos], inFlex: inFlex[pos], replacement, value, share: 0 };
  }
  const total = LINE_POSITIONS.reduce((s, pos) => s + out[pos].value, 0);
  if (total > 0) for (const pos of LINE_POSITIONS) out[pos].share = out[pos].value / total;
  return out;
}

/** A league's format as the math reads it. */
export const valueFormatOf = (f: Pick<LeagueFormat, "teams" | "slots" | "scoring">): ValueFormat => ({
  teams: f.teams, slots: f.slots, scoring: f.scoring,
});

/** The most common of some values; a tie goes to the one seen first. */
function mode<T>(values: readonly T[], key: (v: T) => string = String): T | undefined {
  const counts = new Map<string, { v: T; n: number; first: number }>();
  values.forEach((v, i) => {
    const k = key(v);
    const c = counts.get(k);
    if (c) c.n++; else counts.set(k, { v, n: 1, first: i });
  });
  return [...counts.values()].sort((a, b) => b.n - a.n || a.first - b.first)[0]?.v;
}

const slotsKey = (slots: Record<string, number>) =>
  Object.keys(slots).sort().map((k) => `${k}:${slots[k]}`).join(",");

/**
 * The user's usual format: the scoring they named (HOME_SCORING_PINNED) and,
 * for everything they didn't (the lineup, the team count, every other
 * scoring rule), the most common among their leagues. A league exactly like
 * it reads ×1.00 at every position.
 */
export function homeFormat(formats: readonly Pick<LeagueFormat, "teams" | "slots" | "scoring">[]): ValueFormat | null {
  if (formats.length === 0) return null;
  const slots = mode(formats.map((f) => f.slots), slotsKey)!;
  const teams = mode(formats.map((f) => f.teams))!;
  const keys = new Set(formats.flatMap((f) => Object.keys(f.scoring)));
  const scoring: Record<string, number> = {};
  for (const k of [...keys].sort()) {
    const v = mode(formats.map((f) => (typeof f.scoring[k] === "number" ? f.scoring[k] : 0)));
    if (v) scoring[k] = v;
  }
  return { teams, slots: { ...slots }, scoring: { ...scoring, ...HOME_SCORING_PINNED } };
}

function compare(l: FormatValue, h: FormatValue): LeagueValue {
  const mult = {} as Record<LinePos, number | null>;
  for (const pos of LINE_POSITIONS) mult[pos] = h[pos].share > 0 ? l[pos].share / h[pos].share : null;
  return { mult, league: l, home: h };
}

/** Each position's multiplier in a league against the usual format, with both sides' starters and replacement for the tooltip. */
export function leagueValue(lines: readonly SeasonLine[], league: ValueFormat, home: ValueFormat): LeagueValue {
  return compare(formatValue(pointsCurves(lines, league.scoring), league), formatValue(pointsCurves(lines, home.scoring), home));
}

const scoringKey = (s: Record<string, number>) =>
  Object.keys(s).filter((k) => s[k]).sort().map((k) => `${k}:${s[k]}`).join(",");

/** The usual format's own values, and every league's against it (leagues with the same scoring share one set of curves). */
export function leagueValues(
  lines: readonly SeasonLine[],
  leagues: readonly (Pick<LeagueFormat, "leagueId"> & ValueFormat)[],
  home: ValueFormat,
): { home: FormatValue; byLeague: Map<string, LeagueValue> } {
  const curves = new Map<string, Curves>();
  const curvesFor = (s: Record<string, number>) => {
    const k = scoringKey(s);
    let c = curves.get(k);
    if (!c) { c = pointsCurves(lines, s); curves.set(k, c); }
    return c;
  };
  const h = formatValue(curvesFor(home.scoring), home);
  const byLeague = new Map<string, LeagueValue>();
  for (const l of leagues) byLeague.set(l.leagueId, compare(formatValue(curvesFor(l.scoring), l), h));
  return { home: h, byLeague };
}
