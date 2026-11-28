import { describe, it, expect } from "vitest";
import {
  pickValueCurve, curveValue, curveSlotLabel, curveLastLabel, leagueOrder, leaguePlaceTitle, shownMult,
} from "@/lib/helpers/leagueBoard";
import { applyPickValueOverrides } from "@/lib/helpers/picks";

// Stage 2 of the 2026-11-27 positional value plan: a league's view of the
// rookie board = OVR place → the user's Pick Values slot value × the league's
// multiplier for his position, re-sorted. The user picked their own curve over
// "the same spots anywhere" (2026-11-27).

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

// The first 30 positions of the user's 2027 OVR board (2026-11-27), then a filler pattern to 116.
const TOP = "WR RB TE RB WR WR QB QB WR QB WR QB WR WR RB RB RB QB TE RB WR WR RB WR TE RB WR WR QB WR".split(" ");
const BOARD = Array.from({ length: 116 }, (_, i) => ({ ovr: i + 1, pos: TOP[i] ?? ["WR", "RB", "QB", "WR", "TE", "RB"][i % 6] }));
type Row = (typeof BOARD)[number];
const pos = (r: Row) => r.pos;

describe("pickValueCurve", () => {
  it("reads the class's slots in draft order and carries on at the last round's pace", () => {
    const c = pickValueCurve(MAP, 2027)!;
    expect(c.values).toEqual(VALUES_2027);
    expect(c.slots).toBe(12);
    // 4.12 ÷ 3.12 over 12 picks: (675 / 975)^(1/12).
    expect(c.perPick).toBeCloseTo(Math.pow(675 / 975, 1 / 12), 10);
    expect(c.perPick).toBeCloseTo(0.9698, 4);
    expect(curveLastLabel(c)).toBe("4.12");
  });

  it("falls back to bands, then rounds, where the user priced no slots", () => {
    const c = pickValueCurve(MARKET, 2027)!;
    expect(c.values.slice(0, 5)).toEqual([4942, 4942, 4942, 4942, 3500]);
    expect(c.values).toHaveLength(48);
    const byRound = pickValueCurve({ "2028-1": 3000, "2028-2": 1400 }, 2028)!;
    expect(byRound.values).toEqual([...Array(12).fill(3000), ...Array(12).fill(1400)]);
    // The last 12 picks' pace: 2.12 against 1.12.
    expect(byRound.perPick).toBeCloseTo(Math.pow(1400 / 3000, 1 / 12), 10);
    // When the last 12 picks don't fall at all, the whole curve's pace instead.
    const flatTail = pickValueCurve({ "2028-1": 3000, "2028-2": 1400, "2028-3": 1400 }, 2028)!;
    expect(flatTail.perPick).toBeCloseTo(Math.pow(1400 / 3000, 1 / 35), 10);
  });

  it("never rises: a slot priced above the one before reads as that one", () => {
    const c = pickValueCurve({ ...MAP, "2027-1.05": 5200 }, 2027)!;
    expect(c.values.slice(2, 6)).toEqual([5300, 5000, 5000, 4300]);
  });

  it("is null for a class with no prices, and a single price falls at the default pace", () => {
    expect(pickValueCurve(MAP, 2030)).toBeNull();
    expect(pickValueCurve({}, 2027)).toBeNull();
    const one = pickValueCurve({ "2029-1.01": 5000 }, 2029)!;
    expect(one.values).toEqual([5000]);
    expect(one.perPick).toBe(0.97);
  });
});

describe("curveValue / curveSlotLabel", () => {
  const c = pickValueCurve(MAP, 2027)!;
  it("is the slot's price on the curve and keeps falling past it", () => {
    expect(curveValue(c, 1)).toBe(7900);
    expect(curveValue(c, 20)).toBe(1650);
    expect(curveValue(c, 48)).toBe(675);
    expect(curveValue(c, 49)).toBeCloseTo(675 * c.perPick, 8);
    expect(curveValue(c, 60)).toBeCloseTo(675 * Math.pow(c.perPick, 12), 8);
    expect(curveValue(c, 116)).toBeGreaterThan(0);
  });
  it("labels priced places by round and slot", () => {
    expect(curveSlotLabel(c, 1)).toBe("1.01");
    expect(curveSlotLabel(c, 12)).toBe("1.12");
    expect(curveSlotLabel(c, 19)).toBe("2.07");
    expect(curveSlotLabel(c, 48)).toBe("4.12");
    expect(curveSlotLabel(c, 49)).toBeNull();
  });
});

describe("leagueOrder", () => {
  const c = pickValueCurve(MAP, 2027)!;
  const placeOf = (mult: Record<string, number>) => {
    const { places } = leagueOrder(BOARD, pos, mult, c);
    return (ovr: number) => places.get(BOARD[ovr - 1])!.place;
  };

  it("moves the examples the user saw on 11/27", () => {
    const te = placeOf({ TE: 1.4 });
    expect([te(3), te(19), te(25)]).toEqual([2, 13, 17]);
    const rb = placeOf({ RB: 1.38 });
    expect([rb(2), rb(15), rb(26)]).toEqual([1, 11, 20]);
    const qb = placeOf({ QB: 0.83 });
    expect([qb(7), qb(12), qb(18), qb(29)]).toEqual([7, 15, 23, 34]);
  });

  it("leaves the OVR order alone at ×1.00 everywhere", () => {
    const { order } = leagueOrder(BOARD, pos, { QB: 1, RB: 1, WR: 1, TE: 1 }, c);
    expect(order).toEqual(BOARD);
  });

  it("never reorders a position's own players, whatever the multipliers", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let t = 0; t < 50; t++) {
      const mult = { QB: 0.6 + rand(), RB: 0.6 + rand(), WR: 0.6 + rand(), TE: 0.6 + rand() };
      const { order } = leagueOrder(BOARD, pos, mult, c);
      for (const p of ["QB", "RB", "WR", "TE"]) {
        const ovrs = order.filter((r) => r.pos === p).map((r) => r.ovr);
        expect(ovrs).toEqual([...ovrs].sort((a, b) => a - b));
      }
    }
  });

  it("breaks a tie by OVR, and reads a missing multiplier as ×1.00", () => {
    const flat = pickValueCurve({ "2028-1": 3000 }, 2028)!;
    const rows = [{ ovr: 1, pos: "WR" }, { ovr: 2, pos: "TE" }, { ovr: 3, pos: "RB" }];
    expect(leagueOrder(rows, pos, { TE: 1.01 }, flat).order.map((r) => r.ovr)).toEqual([2, 1, 3]);
    // ×1.004 shows as ×1.00, so it ties, and the tie goes to OVR.
    expect(leagueOrder(rows, pos, { TE: 1.004 }, flat).order.map((r) => r.ovr)).toEqual([1, 2, 3]);
    expect(leagueOrder(rows, pos, { WR: null, TE: undefined }, flat).order.map((r) => r.ovr)).toEqual([1, 2, 3]);
  });

  it("uses the multiplier as League Formats shows it (two decimals)", () => {
    expect(shownMult(1.4049)).toBe(1.4);
    expect(shownMult(0.835)).toBe(0.84);
    expect(shownMult(null)).toBe(1);
    expect(shownMult(Number.NaN)).toBe(1);
    const { places } = leagueOrder(BOARD, pos, { TE: 1.4049 }, c);
    const honig = places.get(BOARD[24])!;
    expect(honig).toMatchObject({ ovr: 25, base: 1400, mult: 1.4 });
    expect(honig.value).toBeCloseTo(1960, 8);
  });
});

describe("leaguePlaceTitle", () => {
  const c = pickValueCurve(MAP, 2027)!;
  it("spells out the math, priced and past the priced picks", () => {
    const { places } = leagueOrder(BOARD, pos, { TE: 1.4 }, c);
    expect(leaguePlaceTitle(places.get(BOARD[18])!, "TE", c, "Gamma TEP"))
      .toBe("OVR 19 → your 2027 2.07 (1,700) × TE ×1.40 = 2,380 → 13 in Gamma TEP (up 6).");
    const past = places.get(BOARD[59])!;
    expect(leaguePlaceTitle(past, BOARD[59].pos, c, "Gamma TEP"))
      .toMatch(/^OVR 60 → past your 4\.12: [\d,]+ × \w+ ×\d\.\d\d = [\d,]+ → \d+ in Gamma TEP \((up \d+|down \d+|no move)\)\.$/);
  });
});
