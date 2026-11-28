// ============================================================
// A league's view of the rookie board (stage 2 of the 2026-11-27 plan; the
// live draft reads the drafting league's view the same way, stage 3)
// ============================================================
// The board's OVR order is built for the user's usual format. For one league,
// each ranked prospect's place on the board is read as a pick of the class on
// the user's own Pick Values curve (1.01 = 7,900 … 4.12 = 675 for 2027), that
// value is multiplied by the league's multiplier for his position
// (positionalValue.ts, read off League Formats, never recomputed here), and
// the board re-sorts by the result.
//
// The user's calls (2026-11-27):
//   - The curve is their Pick Values, as is: where it's steep (1.01 → 1.02
//     drops 19%) a multiplier moves a player a spot or two; where it's flat
//     (rounds 3–4, about 3% a pick) the same multiplier moves him further.
//     Asked against "the same number of spots anywhere": the curve.
//   - Within a position the order never changes: the curve never rises (a
//     slot priced above the one before it reads as that one) and ties go to
//     OVR, so one position's multiplier can't reorder its own players.
//   - Tiers stay universal (draftBoardTiers), so nothing here touches them.
// Past the last priced slot the curve keeps falling at the pace of its last
// round (2027: ×0.970 a pick), so every place has a value and no two tie.
// Pure.
// ============================================================

import { PICK_VALUE_SLOTS, slotValueFrom } from "./picks";

/** The most rounds read off the pick value map for one class (rookie drafts here run 4–5). */
const MAX_ROUNDS = 10;

/** The per-pick fall past the priced slots when the priced curve itself never falls. */
const FLAT_CURVE_FALL = 0.97;

export interface PickCurve {
  year: number;
  /** Slots per round the prices are in (12, as Pick Values and FantasyCalc price them). */
  slots: number;
  /** Each priced pick's value in draft order (1.01, 1.02 … the last priced slot), never rising. */
  values: number[];
  /** Past the last priced pick, each one is this share of the one before. */
  perPick: number;
}

/**
 * The class's pick values in draft order, from the pick value map the app
 * already merges (the user's Pick Values over FantasyCalc): each slot's
 * price, else its Early / Mid / Late band, else its round. Null when the
 * class has no prices at all.
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
  if (values.length === 0) return null;

  const n = values.length;
  const rate = (from: number, steps: number) => Math.pow(values[n - 1] / values[from], 1 / steps);
  let perPick = n > slots ? rate(n - 1 - slots, slots) : n > 1 ? rate(0, n - 1) : 1;
  if (!(perPick < 1) && n > 1) perPick = rate(0, n - 1);
  if (!(perPick > 0 && perPick < 1)) perPick = FLAT_CURVE_FALL;
  return { year, slots, values, perPick };
}

/** The value of the pick at a 1-based place in the class; past the priced ones, the curve's fall carried on. */
export function curveValue(curve: PickCurve, place: number): number {
  const n = curve.values.length;
  if (place <= n) return curve.values[Math.max(1, place) - 1];
  return curve.values[n - 1] * Math.pow(curve.perPick, place - n);
}

/** "2.08" for a priced place, null past the last priced pick. */
export function curveSlotLabel(curve: PickCurve, place: number): string | null {
  if (place < 1 || place > curve.values.length) return null;
  const round = Math.ceil(place / curve.slots);
  const slot = place - (round - 1) * curve.slots;
  return `${round}.${String(slot).padStart(2, "0")}`;
}

/** The last priced pick's label ("4.12"). */
export const curveLastLabel = (curve: PickCurve): string => curveSlotLabel(curve, curve.values.length)!;

export interface LeaguePlace {
  /** Place on the board in the usual format (1 = first ranked). */
  ovr: number;
  /** Place in the league's view. */
  place: number;
  /** The pick value of his OVR place on the curve. */
  base: number;
  /** The league's multiplier for his position, rounded as League Formats shows it (×1.00 when there's none). */
  mult: number;
  /** base × mult: what the league's view sorts by. */
  value: number;
}

/** A multiplier as League Formats shows it (two decimals); a position the usual format gives nothing reads ×1.00. */
export const shownMult = (m: number | null | undefined): number => (m != null && Number.isFinite(m) ? Math.round(m * 100) / 100 : 1);

/**
 * The ranked rows (in OVR order) re-sorted for one league: OVR place → the
 * curve's value × the position's multiplier, highest first, ties by OVR.
 * Returns the new order and each row's place.
 */
export function leagueOrder<T>(
  ranked: readonly T[],
  positionOf: (row: T) => string,
  mult: Readonly<Partial<Record<string, number | null>>>,
  curve: PickCurve,
): { order: T[]; places: Map<T, LeaguePlace> } {
  const scored = ranked.map((row, i) => {
    const base = curveValue(curve, i + 1);
    const m = shownMult(mult[positionOf(row)]);
    return { row, ovr: i + 1, base, mult: m, value: base * m };
  });
  scored.sort((a, b) => b.value - a.value || a.ovr - b.ovr);
  const places = new Map<T, LeaguePlace>();
  scored.forEach((s, i) => places.set(s.row, { ovr: s.ovr, place: i + 1, base: s.base, mult: s.mult, value: s.value }));
  return { order: scored.map((s) => s.row), places };
}

/**
 * The whole board (ranked in OVR order, then the unranked) in one league's
 * order: the ranked re-sorted by leagueOrder, the unranked below them as they
 * were. The Rookie Big Board's "Order for" and the live draft (stage 3) both
 * read the board this way. `places` holds the ranked rows only.
 */
export function leagueBoardRows<T extends { overall_rank: number | null; position: string }>(
  rows: readonly T[],
  mult: Readonly<Partial<Record<string, number | null>>>,
  curve: PickCurve,
): { rows: T[]; places: Map<T, LeaguePlace> } {
  const { order, places } = leagueOrder(rows.filter((p) => p.overall_rank != null), (p) => p.position, mult, curve);
  return { rows: [...order, ...rows.filter((p) => p.overall_rank == null)], places };
}

const whole = (v: number) => Math.round(v).toLocaleString("en-US");

/** The row's tooltip: "OVR 19 → your 2.07 (1,700) × TE ×1.40 = 2,380 → 13th in Gamma." */
export function leaguePlaceTitle(p: LeaguePlace, pos: string, curve: PickCurve, leagueName: string): string {
  const slot = curveSlotLabel(curve, p.ovr);
  const from = slot
    ? `your ${curve.year} ${slot} (${whole(p.base)})`
    : `past your ${curveLastLabel(curve)}: ${whole(p.base)}`;
  const move = p.place < p.ovr ? `up ${p.ovr - p.place}` : p.place > p.ovr ? `down ${p.place - p.ovr}` : "no move";
  return `OVR ${p.ovr} → ${from} × ${pos} ×${p.mult.toFixed(2)} = ${whole(p.value)} → ${p.place} in ${leagueName} (${move}).`;
}
