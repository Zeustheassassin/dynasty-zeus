import { describe, it, expect } from "vitest";
import type { SleeperRoster, SleeperPlayer } from "@/lib/types";
import {
  computeRosterDropCost,
  computeStarDiscounts,
  computeFinderStarDiscounts,
  computePosTotals,
  computeLeagueRank,
} from "@/components/tradeHub/calculatorUtils";

const roster = (players: string[]) => ({ players }) as unknown as SleeperRoster;
const sp = (position: string) => ({ position }) as unknown as SleeperPlayer;

// ── computeRosterDropCost ────────────────────────────────────────────

describe("computeRosterDropCost", () => {
  it("returns 0 for null roster", () => {
    expect(computeRosterDropCost(null, 2, 25, {})).toBe(0);
  });

  it("returns 0 when netPlayerGain is 0 or negative", () => {
    expect(computeRosterDropCost(roster(["p1"]), 0, 25, {})).toBe(0);
    expect(computeRosterDropCost(roster(["p1"]), -1, 25, {})).toBe(0);
  });

  it("returns 0 when open roster slots absorb the gain", () => {
    // 3 players, limit 5, gain 2 → openSlots=2 → dropsNeeded=0
    expect(computeRosterDropCost(roster(["p1", "p2", "p3"]), 2, 5, {})).toBe(0);
  });

  it("sums the lowest-value players dropped (ascending sort)", () => {
    // 3 players fill the roster (limit=3), gain=2 → drop 2 cheapest
    const fcValues = { p1: 100, p2: 300, p3: 200 };
    // ascending sort: [100, 200, 300]; take 2 → 100 + 200 = 300
    expect(computeRosterDropCost(roster(["p1", "p2", "p3"]), 2, 3, fcValues)).toBe(300);
  });

  it("uses 0 for players missing from fcValues", () => {
    // roster full, gain=1, p1 not in fcValues → value 0
    const fcValues = { p2: 500 };
    // ascending sort: [0, 500]; take 1 → 0
    expect(computeRosterDropCost(roster(["p1", "p2"]), 1, 2, fcValues)).toBe(0);
  });

  it("respects partial open slots", () => {
    // 4 players, limit 5 → 1 open slot; gain=3 → dropsNeeded=max(0,3-1)=2
    const fcValues = { p1: 50, p2: 100, p3: 200, p4: 300 };
    // ascending sort: [50,100,200,300]; take 2 → 50+100=150
    expect(computeRosterDropCost(roster(["p1", "p2", "p3", "p4"]), 3, 5, fcValues)).toBe(150);
  });
});

// ── computeStarDiscounts ─────────────────────────────────────────────

describe("computeStarDiscounts", () => {
  const noPickValue = () => 0;

  it("returns zeros for empty value arrays", () => {
    expect(computeStarDiscounts([], [], [], [], noPickValue)).toEqual({ onReceive: 0, onGive: 0 });
  });

  it("returns zeros when only one side is empty", () => {
    expect(computeStarDiscounts([3000], [], [], [], noPickValue)).toEqual({ onReceive: 0, onGive: 0 });
    expect(computeStarDiscounts([], [3000], [], [], noPickValue)).toEqual({ onReceive: 0, onGive: 0 });
  });

  it("returns zeros when values are equal (no star premium)", () => {
    expect(computeStarDiscounts([3000], [3000], [], [], noPickValue)).toEqual({ onReceive: 0, onGive: 0 });
  });

  it("returns zeros when values are below 2000 (no star threshold)", () => {
    expect(computeStarDiscounts([1500], [800], [], [], noPickValue)).toEqual({ onReceive: 0, onGive: 0 });
  });

  it("penalises onReceive when give star > receive (opponent gets the star)", () => {
    // gv=4000 > rv=1000, gv >= 2000, no picks → threshold=0.78, maxPct=0.12
    // ratio=0.25 < 0.78; discount = min((0.78-0.25)/0.25, 1) * 4000 * 0.12 = 1 * 480 = 480
    const { onReceive, onGive } = computeStarDiscounts([4000], [1000], [], [], noPickValue);
    expect(onReceive).toBe(-480);
    expect(onGive).toBe(0);
  });

  it("penalises onGive when receive star > give (I am getting the star)", () => {
    // rv=4000 > gv=1000, rv >= 2000
    const { onReceive, onGive } = computeStarDiscounts([1000], [4000], [], [], noPickValue);
    expect(onReceive).toBe(0);
    expect(onGive).toBe(-480);
  });

  it("applies no discount when ratio is at or above threshold", () => {
    // gv=3000, rv=2500 → ratio=2500/3000≈0.833 ≥ 0.78 → no penalty
    const { onReceive, onGive } = computeStarDiscounts([3000], [2500], [], [], noPickValue);
    expect(onReceive).toBe(0);
    expect(onGive).toBe(0);
  });
});

// ── computeFinderStarDiscounts ───────────────────────────────────────
// The finder adapter must delegate to computeStarDiscounts with non-colliding,
// side-prefixed keys so the 1st-round "near global top" branch (0.12 maxPct) is
// honoured — this is the path FinderResults' old inline copy got wrong (it used
// a flat 0.0125), making the sort net disagree with the displayed card net.

describe("computeFinderStarDiscounts", () => {
  it("matches the canonical no-pick result (delegates correctly)", () => {
    expect(
      computeFinderStarDiscounts([{ value: 4000 }], [{ value: 1000 }], [], []),
    ).toEqual({ onReceive: -480, onGive: 0 });
  });

  it("applies the 0.12 maxPct when a RECEIVED 1st is near the global top (not 0.0125)", () => {
    // recv 1st = 5900 ≥ globalTop(6000)*0.97 → params {0.78, 0.12}.
    // Penalised pairing: give star 6000 vs recv 1000 → ratio 0.167.
    // discount = 1 * 6000 * 0.12 = 720 (old flat-0.0125 path would give 75).
    const { onReceive, onGive } = computeFinderStarDiscounts(
      [{ value: 6000 }, { value: 6000 }],
      [{ value: 1000 }],
      [],
      [{ round: 1, value: 5900 }],
    );
    expect(onReceive).toBe(-720);
    expect(onGive).toBe(0);
  });

  it("applies the 0.12 maxPct when a GIVEN 1st is near the global top", () => {
    const { onReceive, onGive } = computeFinderStarDiscounts(
      [{ value: 1000 }],
      [{ value: 6000 }, { value: 6000 }],
      [{ round: 1, value: 5900 }],
      [],
    );
    expect(onReceive).toBe(0);
    expect(onGive).toBe(-720);
  });

  it("values give/receive 1st-round picks from their own side (no key collision)", () => {
    // Both sides hold a round-1 pick (give 6000, receive 500). The penalised
    // pairing is give-star 6000 vs receive 1000, so recvParams (recv 1st = 500,
    // below near-top → 0.0125) drives it: 1 * 6000 * 0.0125 = 75. A per-side
    // index collision that let the receive pick read the give pick's 6000 would
    // not change this pairing's params, but distinct keys keep each side honest.
    expect(
      computeFinderStarDiscounts(
        [{ value: 1000 }], [{ value: 1000 }],
        [{ round: 1, value: 6000 }], [{ round: 1, value: 500 }],
      ),
    ).toEqual({ onReceive: -75, onGive: 0 });
  });
});

// ── computePosTotals ─────────────────────────────────────────────────

describe("computePosTotals", () => {
  const players: Record<string, SleeperPlayer> = {
    qb1: sp("QB"),
    rb1: sp("RB"),
    rb2: sp("RB"),
    wr1: sp("WR"),
    k1:  sp("K"),
  };
  const val = (id: string) => ({ qb1: 3000, rb1: 1500, rb2: 1000, wr1: 2000, k1: 500 }[id] ?? 0);

  it("returns all-zero record for empty playerIds", () => {
    expect(computePosTotals([], players, val)).toEqual({ QB: 0, RB: 0, WR: 0, TE: 0 });
  });

  it("sums values by position and ignores non-skill positions", () => {
    const result = computePosTotals(["qb1", "rb1", "rb2", "wr1", "k1"], players, val);
    expect(result.QB).toBe(3000);
    expect(result.RB).toBe(2500); // 1500 + 1000
    expect(result.WR).toBe(2000);
    expect(result.TE).toBe(0);
    expect(result["K"]).toBeUndefined(); // not tracked
  });

  it("ignores player IDs not found in the players map", () => {
    const result = computePosTotals(["unknown1"], players, val);
    expect(Object.values(result).every((v) => v === 0)).toBe(true);
  });
});

// ── computeLeagueRank ────────────────────────────────────────────────

describe("computeLeagueRank", () => {
  const teams = [
    { QB: 3000, RB: 2000 },
    { QB: 2500, RB: 1500 },
    { QB: 2000, RB: 1000 },
  ];

  it("returns 1 for the highest QB total", () => {
    expect(computeLeagueRank(teams, "QB", 3000, 3)).toBe(1);
  });

  it("returns 2 for the second-highest QB total", () => {
    expect(computeLeagueRank(teams, "QB", 2500, 3)).toBe(2);
  });

  it("returns 3 for the lowest QB total", () => {
    expect(computeLeagueRank(teams, "QB", 2000, 3)).toBe(3);
  });

  it("clamps to rosterCount when total is below all teams", () => {
    expect(computeLeagueRank(teams, "QB", 100, 3)).toBe(3);
  });

  it("returns 1 for empty allTeamsPos (no competitors)", () => {
    expect(computeLeagueRank([], "QB", 500, 1)).toBe(1);
  });

  it("handles a position not present in any team (defaults to 0)", () => {
    // All teams have TE=0; total=0 → ties with everyone → rank=1 (0 >= 0 immediately)
    expect(computeLeagueRank(teams, "TE", 0, 3)).toBe(1);
  });

  it("uses the specified position key correctly", () => {
    expect(computeLeagueRank(teams, "RB", 2000, 3)).toBe(1);
    expect(computeLeagueRank(teams, "RB", 1000, 3)).toBe(3);
  });
});
