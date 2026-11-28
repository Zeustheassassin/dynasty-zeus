import { describe, it, expect } from "vitest";
import {
  pickValueCurve, placeScores, scoreRate, scoreShift, leagueOrder, leagueBoardRows, leaguePlaceTitle,
  shownMult, shiftsText, rateText, signedScore, MIN_RATE_POINTS,
} from "@/lib/helpers/leagueBoard";
import { applyPickValueOverrides } from "@/lib/helpers/picks";

// A league's view of the rookie board (positional value stages 2–3 of the
// 2026-11-27 plan). The user's call that evening: the order rests on the
// score's gaps, not the slots. Each position's multiplier becomes a shift in
// the score (Dynasty before the NFL draft, Dynasty+ after) of ln(m) ÷ the rate
// their own Pick Values put on a point of it, and the board sorts by score +
// shift. Never the score times m.

// The user's own 2027 slot values (Pick Values, saved 2026-10-30).
const VALUES_2027 = [
  7900, 6400, 5300, 5000, 4600, 4300, 3800, 3300, 3000, 2800, 2600, 2400,
  2200, 2100, 2000, 1900, 1800, 1750, 1700, 1650, 1600, 1550, 1500, 1450,
  1400, 1350, 1300, 1250, 1200, 1150, 1100, 1075, 1050, 1025, 1000, 975,
  950, 925, 900, 875, 850, 825, 800, 775, 750, 725, 700, 675,
];
const slotKey = (i: number) => `2027-${Math.floor(i / 12) + 1}.${String((i % 12) + 1).padStart(2, "0")}`;
const OVERRIDES = Object.fromEntries(VALUES_2027.map((v, i) => [slotKey(i), v]));
// FantasyCalc prices 2027 by Early / Mid / Late band only; the user's slots go over it.
const MARKET: Record<string, number> = {
  "2027-1-early": 4942, "2027-1-mid": 3500, "2027-1-late": 2600, "2027-1": 3680,
  "2027-2-early": 1800, "2027-2-mid": 1500, "2027-2-late": 1300, "2027-2": 1530,
  "2027-3-early": 900, "2027-3-mid": 800, "2027-3-late": 700, "2027-3": 800,
  "2027-4-early": 500, "2027-4-mid": 450, "2027-4-late": 400, "2027-4": 450,
  "2028-1": 3000, "2028-2": 1400,
};
const MAP = applyPickValueOverrides(MARKET, OVERRIDES);
const CURVE = pickValueCurve(MAP, 2027)!;

// The user's 2027 board on 2026-11-27 (read-only export): all 116 ranked
// prospects in OVR order, each one's position and saved Dynasty. OVR followed
// Dynasty exactly that day.
const POS_2027 = "WR RB TE RB WR WR QB QB WR QB WR QB WR WR RB RB RB QB TE RB WR WR RB WR TE RB WR WR QB WR QB RB RB WR RB TE RB WR WR TE RB WR RB WR RB WR RB RB QB RB TE WR WR WR WR RB WR WR QB RB RB WR RB RB QB RB TE WR RB WR WR WR WR TE RB QB QB QB RB RB RB WR RB TE RB WR WR WR WR RB QB WR QB WR RB RB RB RB TE QB WR RB WR WR RB QB RB WR WR RB WR WR RB RB TE WR".split(" ");
const DYN_2027 = [2.426, 2.242, 2.043, 1.948, 1.900, 1.455, 1.340, 1.192, 1.186, 1.108, 0.893, 0.832, 0.813, 0.753, 0.733, 0.673, 0.662, 0.610, 0.572, 0.547, 0.518, 0.496, 0.479, 0.459, 0.448, 0.446, 0.438, 0.361, 0.333, 0.294, 0.237, 0.225, 0.190, 0.182, 0.176, 0.173, 0.164, 0.126, 0.048, 0.040, 0.026, 0.019, 0.009, -0.026, -0.030, -0.037, -0.040, -0.061, -0.064, -0.071, -0.071, -0.080, -0.104, -0.118, -0.137, -0.139, -0.141, -0.151, -0.172, -0.180, -0.186, -0.202, -0.214, -0.230, -0.262, -0.263, -0.275, -0.276, -0.397, -0.402, -0.411, -0.434, -0.451, -0.461, -0.492, -0.504, -0.536, -0.540, -0.545, -0.564, -0.575, -0.581, -0.586, -0.597, -0.637, -0.664, -0.684, -0.731, -0.741, -0.753, -0.870, -0.873, -0.890, -0.900, -0.901, -0.901, -0.901, -0.938, -0.967, -0.973, -0.988, -1.080, -1.194, -1.212, -1.223, -1.241, -1.260, -1.377, -1.384, -1.409, -1.479, -1.512, -1.714, -1.781, -2.217, -2.432];
interface Row { ovr: number; pos: string; dyn: number | null }
const BOARD: Row[] = POS_2027.map((pos, i) => ({ ovr: i + 1, pos, dyn: DYN_2027[i] }));
const pos = (r: Row) => r.pos;
const dyn = (r: Row) => r.dyn;

// Degenerates Anonymous on 2026-11-27, and a full-point TE premium league.
const DEGENERATES = { QB: 1.46, RB: 0.92, WR: 0.91, TE: 0.74 };
const TEP_FULL = { QB: 1, RB: 1, WR: 0.9, TE: 1.4 };

const placeOf = (rows: readonly Row[], mult: Record<string, number>) => {
  const lo = leagueOrder(rows, pos, dyn, mult, CURVE)!;
  return (ovr: number) => lo.places.get(rows[ovr - 1])!.place;
};

describe("pickValueCurve", () => {
  it("reads the class's slots in draft order", () => {
    expect(CURVE.values).toEqual(VALUES_2027);
    expect(CURVE.slots).toBe(12);
  });

  it("falls back to bands, then rounds, where the user priced no slots", () => {
    const c = pickValueCurve(MARKET, 2027)!;
    expect(c.values.slice(0, 5)).toEqual([4942, 4942, 4942, 4942, 3500]);
    expect(c.values).toHaveLength(48);
    expect(pickValueCurve({ "2028-1": 3000, "2028-2": 1400 }, 2028)!.values).toEqual([...Array(12).fill(3000), ...Array(12).fill(1400)]);
  });

  it("never rises: a slot priced above the one before reads as that one", () => {
    const c = pickValueCurve({ ...MAP, "2027-1.05": 5200 }, 2027)!;
    expect(c.values.slice(2, 6)).toEqual([5300, 5000, 5000, 4300]);
  });

  it("is null for a class with no prices", () => {
    expect(pickValueCurve(MAP, 2030)).toBeNull();
    expect(pickValueCurve({}, 2027)).toBeNull();
    expect(pickValueCurve({ "2029-1.01": 5000 }, 2029)!.values).toEqual([5000]);
  });
});

describe("placeScores", () => {
  it("gives OVR place k the k-th best score, so a hand move keeps its place and takes the gap there", () => {
    expect(placeScores([2, 1.5, 1])).toEqual([2, 1.5, 1]);
    // He was moved up by hand past a better score: the places keep the scores' shape.
    expect(placeScores([1, 2, 1.5])).toEqual([2, 1.5, 1]);
  });

  it("reads the nearest scored places for one without a score (the one there is, at either end)", () => {
    expect(placeScores([2, null, 1])).toEqual([2, 1.5, 1]);
    expect(placeScores([null, 2, 1, null, null])).toEqual([2, 2, 1, 1, 1]);
    expect(placeScores([null, null])).toEqual([null, null]);
  });
});

describe("scoreRate", () => {
  it("reads what a point of Dynasty is worth off the user's own Pick Values (2027: about ×2.65)", () => {
    const r = scoreRate(DYN_2027, DYN_2027.map(() => true), CURVE)!;
    expect(r.points).toBe(48);
    expect(r.perPoint).toBeCloseTo(0.98, 2);
    expect(Math.exp(r.perPoint)).toBeCloseTo(2.65, 1);
    expect(r.r2).toBeGreaterThan(0.95);
    expect(rateText(r, "Dynasty", 2027)).toMatch(/^\+1\.00 Dynasty is worth ×2\.6\d on your 2027 Pick Values$/);
  });

  it("is null with too few scored, priced places, or when value doesn't fall with the score", () => {
    const few = DYN_2027.map((_, i) => i < MIN_RATE_POINTS - 1);
    expect(scoreRate(DYN_2027, few, CURVE)).toBeNull();
    expect(scoreRate(DYN_2027.map(() => 1), DYN_2027.map(() => true), CURVE)).toBeNull();
    expect(scoreRate([...DYN_2027].reverse(), DYN_2027.map(() => true), CURVE)).toBeNull();
  });
});

describe("leagueOrder", () => {
  it("moves the user's 2027 board as told on 11/27: a shift crosses a small gap, not a tier break", () => {
    const lo = leagueOrder(BOARD, pos, dyn, DEGENERATES, CURVE)!;
    expect(shiftsText(["QB", "RB", "WR", "TE"], DEGENERATES, lo.rate)).toBe("QB +0.39 · RB −0.09 · WR −0.10 · TE −0.31");
    const d = placeOf(BOARD, DEGENERATES);
    // Mestemaker (QB, OVR 7) +0.39 can't clear the 0.56 up to Wesco; Overmyer (TE, 3) −0.31 keeps him above it.
    expect(d(7)).toBe(6);
    expect(d(3)).toBe(5);
    // Flat stretches, neighbours ~0.02 apart: Sayin (QB, 29) and Luckie (TE, 40) travel further.
    expect(d(29)).toBe(14);
    expect(d(40)).toBe(63);
    const t = placeOf(BOARD, TEP_FULL);
    expect(t(3)).toBe(1); // Overmyer
    expect(t(25)).toBe(13); // Honig
  });

  it("leaves the OVR order alone at ×1.00 everywhere", () => {
    const lo = leagueOrder(BOARD, pos, dyn, { QB: 1, RB: 1, WR: 1, TE: 1 }, CURVE)!;
    expect(lo.order).toEqual(BOARD);
    expect([...lo.places.values()].every((p) => p.shift === 0)).toBe(true);
  });

  it("never reorders a position's own players, whatever the multipliers", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let t = 0; t < 50; t++) {
      const mult = { QB: 0.6 + rand(), RB: 0.6 + rand(), WR: 0.6 + rand(), TE: 0.6 + rand() };
      const { order } = leagueOrder(BOARD, pos, dyn, mult, CURVE)!;
      for (const p of ["QB", "RB", "WR", "TE"]) {
        const ovrs = order.filter((r) => r.pos === p).map((r) => r.ovr);
        expect(ovrs).toEqual([...ovrs].sort((a, b) => a - b));
      }
    }
  });

  it("is the shift ln(m) ÷ rate on the place's score, the multiplier rounded as League Formats shows it", () => {
    const lo = leagueOrder(BOARD, pos, dyn, { TE: 1.4049 }, CURVE)!;
    const honig = lo.places.get(BOARD[24])!;
    expect(honig).toMatchObject({ ovr: 25, score: 0.448, mult: 1.4 });
    expect(honig.shift).toBeCloseTo(Math.log(1.4) / lo.rate.perPoint, 10);
    expect(honig.value).toBeCloseTo(0.448 + honig.shift, 10);
    expect(scoreShift(1, lo.rate)).toBe(0);
    expect(shownMult(1.4049)).toBe(1.4);
    expect(shownMult(0.835)).toBe(0.84);
    expect(shownMult(null)).toBe(1);
    expect(shownMult(Number.NaN)).toBe(1);
  });

  it("breaks a tie by OVR, and reads a missing multiplier as ×1.00", () => {
    const flat = BOARD.map((r, i) => ({ ...r, dyn: i < 3 ? 1 : DYN_2027[i] }));
    expect(leagueOrder(flat, pos, dyn, {}, CURVE)!.order.slice(0, 3).map((r) => r.ovr)).toEqual([1, 2, 3]);
    // ×1.004 shows as ×1.00: no shift.
    expect(placeOf(BOARD, { TE: 1.004 })(3)).toBe(3);
    expect(leagueOrder(BOARD, pos, dyn, { WR: null as unknown as number, TE: undefined as unknown as number }, CURVE)!.order).toEqual(BOARD);
  });

  it("is null when too few of the priced places have a score", () => {
    const sparse = BOARD.map((r, i) => ({ ...r, dyn: i < MIN_RATE_POINTS - 1 ? r.dyn : null }));
    expect(leagueOrder(sparse, pos, dyn, DEGENERATES, CURVE)).toBeNull();
  });
});

describe("leagueBoardRows", () => {
  // The Rookie Big Board's "Order for" and the live draft read the whole board the same way.
  const rows = [
    ...BOARD.map((r, i) => ({ id: `p${i + 1}`, position: r.pos, overall_rank: r.ovr as number | null, dyn: r.dyn })),
    { id: "late-rb", position: "RB", overall_rank: null, dyn: 0.4 },
    { id: "late-qb", position: "QB", overall_rank: null, dyn: 0.3 },
  ];
  const score = (r: (typeof rows)[number]) => r.dyn;

  it("re-sorts the ranked and keeps the unranked below, in their own order, with no place", () => {
    const lb = leagueBoardRows(rows, score, DEGENERATES, CURVE)!;
    expect(lb.rows.slice(-2).map((r) => r.id)).toEqual(["late-rb", "late-qb"]);
    expect(lb.places.size).toBe(116);
    expect(lb.places.has(rows[116])).toBe(false);
    expect(lb.places.get(rows[6])).toMatchObject({ ovr: 7, place: 6 });
  });

  it("is the order leagueOrder gives the ranked rows", () => {
    const lo = leagueOrder(rows.slice(0, 116), (r) => r.position, score, TEP_FULL, CURVE)!;
    expect(leagueBoardRows(rows, score, TEP_FULL, CURVE)!.rows.slice(0, 116)).toEqual(lo.order);
  });
});

describe("leaguePlaceTitle", () => {
  it("spells out the math", () => {
    const lo = leagueOrder(BOARD, pos, dyn, DEGENERATES, CURVE)!;
    expect(leaguePlaceTitle(lo.places.get(BOARD[6])!, "QB", "Dynasty", "Degenerates Anonymous"))
      .toBe("OVR 7: Dynasty +1.34, QB ×1.46 = +0.39 → +1.73 → 6 in Degenerates Anonymous (up 1).");
    expect(leaguePlaceTitle(lo.places.get(BOARD[39])!, "TE", "Dynasty", "Degenerates Anonymous"))
      .toMatch(/^OVR 40: Dynasty \+0\.04, TE ×0\.74 = −0\.31 → −0\.27 → 63 in Degenerates Anonymous \(down 23\)\.$/);
    expect(signedScore(-0.004)).toBe("−0.00");
  });
});
