// ============================================================
// A league's view of the rookie board (positional value stages 2–3 of the
// 2026-11-27 plan: the Rookie Big Board's "Order for" and the live draft)
// ============================================================
// The board's OVR order is built for the user's usual format. For one league,
// each position's multiplier (positionalValue.ts, read off League Formats,
// never recomputed here) moves that position's prospects by a fixed amount of
// the score the board follows, and the board re-sorts by score + shift.
//
// The user's calls (2026-11-27, evening; they replace the slot-curve method of
// that afternoon):
//   - The order rests on the score's gaps, not the slots: OVR 8 and 9 can be
//     0.01 apart or 0.5 apart, and a multiplier should cross a small gap but
//     not a tier break.
//   - The score is Dynasty until the class's NFL draft is over, then Dynasty+
//     (the score OVR follows then; the user realigns by it on draft Saturday).
//   - The exchange rate comes from their own Pick Values for the class: ln of
//     the pick value at OVR place k against the score at place k, over the
//     priced places (2027: +1.00 Dynasty ≈ ×2.65, R² 0.97). A multiplier m is
//     then a shift of ln(m) ÷ that slope, the same as value = e^(rate·score) × m.
//     Never the score times m: the score is in SDs around an arbitrary zero, so
//     ×1.40 would add +0.80 at +2.00, +0.10 at +0.25, and push a −0.50 down.
//   - OVR place k reads the k-th best score of the class, so a hand move keeps
//     its place and takes the gap there (identical while OVR follows the score).
//   - Within a position the order never changes (one shift per position, ties
//     to OVR), ×1.00 everywhere is OVR, and tiers stay universal.
// Pure.
// ============================================================

import { PICK_VALUE_SLOTS, slotValueFrom } from "./picks";

/** The most rounds read off the pick value map for one class (rookie drafts here run 4–5). */
const MAX_ROUNDS = 10;

/** The fewest scored, priced places the exchange rate is read from. */
export const MIN_RATE_POINTS = 10;

export interface PickCurve {
  year: number;
  /** Slots per round the prices are in (12, as Pick Values and FantasyCalc price them). */
  slots: number;
  /** Each priced pick's value in draft order (1.01, 1.02 … the last priced slot), never rising. */
  values: number[];
}

/**
 * The class's pick values in draft order, from the pick value map the app
 * already merges (the user's Pick Values over FantasyCalc): each slot's
 * price, else its Early / Mid / Late band, else its round. A slot priced
 * above the one before it reads as that one. Null when the class has no
 * prices at all.
 */
export function pickValueCurve(pickValues: Record<string, number>, year: number, slots = PICK_VALUE_SLOTS): PickCurve | null {
  const values: number[] = [];
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const row = Array.from({ length: slots }, (_, i) => slotValueFrom(pickValues, year, round, i + 1, slots));
    if (row.every((v) => !(v > 0))) break;
    for (const v of row) {
      const prev = values.length ? values[values.length - 1] : Infinity;
      values.push(Math.min(v > 0 ? v : 0, prev));
    }
  }
  while (values.length && !(values[values.length - 1] > 0)) values.pop();
  return values.length ? { year, slots, values } : null;
}

const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/**
 * The score each ranked place reads, in OVR order: the class's scores high to
 * low, the k-th best to the k-th scored place. A place without a score reads
 * the mean of the nearest scored places above and below (the one there is,
 * at either end). All null when no place has a score.
 */
export function placeScores(scores: readonly (number | null | undefined)[]): (number | null)[] {
  const sorted = scores.filter(finite).sort((a, b) => b - a);
  if (!sorted.length) return scores.map(() => null);
  let next = 0;
  const out: (number | null)[] = scores.map((s) => (finite(s) ? sorted[next++] : null));
  return out.map((s, i) => {
    if (s != null) return s;
    let up = i - 1;
    while (up >= 0 && out[up] == null) up--;
    let down = i + 1;
    while (down < out.length && out[down] == null) down++;
    const a = up >= 0 ? out[up] : null;
    const b = down < out.length ? out[down] : null;
    return a != null && b != null ? (a + b) / 2 : (a ?? b);
  });
}

export interface ScoreRate {
  /** How much ln(pick value) falls per point of the score: +1.00 is worth ×e^perPoint. */
  perPoint: number;
  /** The scored, priced places it was read from. */
  points: number;
  /** How well a straight line in ln(value) fits them (1 = exactly). */
  r2: number;
}

/**
 * What the user's Pick Values make one point of the score worth: the slope
 * of ln(the pick value at place k) on place k's score, over the priced places
 * whose own prospect has a score. Null with fewer than MIN_RATE_POINTS of
 * them, or when the value doesn't fall as the score does.
 */
export function scoreRate(
  scores: readonly (number | null)[],
  scored: readonly boolean[],
  curve: PickCurve,
): ScoreRate | null {
  const pts: [number, number][] = [];
  for (let k = 0; k < Math.min(scores.length, curve.values.length); k++) {
    const s = scores[k];
    if (scored[k] && s != null && curve.values[k] > 0) pts.push([s, Math.log(curve.values[k])]);
  }
  if (pts.length < MIN_RATE_POINTS) return null;
  const mx = pts.reduce((t, p) => t + p[0], 0) / pts.length;
  const my = pts.reduce((t, p) => t + p[1], 0) / pts.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
  if (!(sxx > 0)) return null;
  const perPoint = sxy / sxx;
  if (!(perPoint > 0)) return null;
  return { perPoint, points: pts.length, r2: syy > 0 ? (sxy * sxy) / (sxx * syy) : 1 };
}

/** A multiplier as League Formats shows it (two decimals); a position the usual format gives nothing reads ×1.00. */
export const shownMult = (m: number | null | undefined): number => (m != null && Number.isFinite(m) ? Math.round(m * 100) / 100 : 1);

/** The multiplier as a move in the score at this rate (×1.00 = none). */
export const scoreShift = (mult: number, rate: ScoreRate): number => Math.log(mult) / rate.perPoint;

export interface LeaguePlace {
  /** Place on the board in the usual format (1 = first ranked). */
  ovr: number;
  /** Place in the league's view. */
  place: number;
  /** The score his OVR place reads (placeScores). */
  score: number;
  /** The league's multiplier for his position, rounded as League Formats shows it (×1.00 when there's none). */
  mult: number;
  /** The multiplier as a move in the score (scoreShift). */
  shift: number;
  /** score + shift: what the league's view sorts by. */
  value: number;
}

export interface LeagueOrder<T> {
  order: T[];
  places: Map<T, LeaguePlace>;
  rate: ScoreRate;
}

/**
 * The ranked rows (in OVR order) re-sorted for one league: each place's score
 * plus his position's shift, highest first, ties by OVR. Null when the rate
 * can't be read (too few scored places among the priced picks).
 */
export function leagueOrder<T>(
  ranked: readonly T[],
  positionOf: (row: T) => string,
  scoreOf: (row: T) => number | null | undefined,
  mult: Readonly<Partial<Record<string, number | null>>>,
  curve: PickCurve,
): LeagueOrder<T> | null {
  const own = ranked.map(scoreOf);
  const scores = placeScores(own);
  const rate = scoreRate(scores, own.map(finite), curve);
  if (!rate) return null;
  const scored = ranked.map((row, i) => {
    const m = shownMult(mult[positionOf(row)]);
    const shift = scoreShift(m, rate);
    const score = scores[i]!;
    return { row, ovr: i + 1, score, mult: m, shift, value: score + shift };
  });
  scored.sort((a, b) => b.value - a.value || a.ovr - b.ovr);
  const places = new Map<T, LeaguePlace>();
  scored.forEach((s, i) => places.set(s.row, { ovr: s.ovr, place: i + 1, score: s.score, mult: s.mult, shift: s.shift, value: s.value }));
  return { order: scored.map((s) => s.row), places, rate };
}

/**
 * The whole board (ranked in OVR order, then the unranked) in one league's
 * order: the ranked re-sorted by leagueOrder, the unranked below them as they
 * were. The Rookie Big Board's "Order for" and the live draft both read the
 * board this way. `places` holds the ranked rows only. Null as leagueOrder.
 */
export function leagueBoardRows<T extends { overall_rank: number | null; position: string }>(
  rows: readonly T[],
  scoreOf: (row: T) => number | null | undefined,
  mult: Readonly<Partial<Record<string, number | null>>>,
  curve: PickCurve,
): { rows: T[]; places: Map<T, LeaguePlace>; rate: ScoreRate } | null {
  const lo = leagueOrder(rows.filter((p) => p.overall_rank != null), (p) => p.position, scoreOf, mult, curve);
  if (!lo) return null;
  return { rows: [...lo.order, ...rows.filter((p) => p.overall_rank == null)], places: lo.places, rate: lo.rate };
}

/** "+1.34" / "−0.31". */
export const signedScore = (v: number): string => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(2)}`;

/** "+1.00 Dynasty is worth ×2.65 on your 2027 Pick Values". */
export function rateText(rate: ScoreRate, scoreName: string, year: number): string {
  return `+1.00 ${scoreName} is worth ×${Math.exp(rate.perPoint).toFixed(2)} on your ${year} Pick Values`;
}

/** "QB +0.39 · RB −0.09 · WR −0.10 · TE −0.31": each position's multiplier as a move in the score. */
export function shiftsText(
  positions: readonly string[],
  mult: Readonly<Partial<Record<string, number | null>>>,
  rate: ScoreRate,
): string {
  return positions.map((pos) => `${pos} ${signedScore(scoreShift(shownMult(mult[pos]), rate))}`).join(" · ");
}

/** The row's tooltip: "OVR 7: Dynasty +1.34, QB ×1.46 = +0.39 → +1.73 → 6 in Degenerates Anonymous (up 1)." */
export function leaguePlaceTitle(p: LeaguePlace, pos: string, scoreName: string, leagueName: string): string {
  const move = p.place < p.ovr ? `up ${p.ovr - p.place}` : p.place > p.ovr ? `down ${p.place - p.ovr}` : "no move";
  return `OVR ${p.ovr}: ${scoreName} ${signedScore(p.score)}, ${pos} ×${p.mult.toFixed(2)} = ${signedScore(p.shift)} → ` +
    `${signedScore(p.value)} → ${p.place} in ${leagueName} (${move}).`;
}
