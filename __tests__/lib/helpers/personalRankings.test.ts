import { describe, it, expect } from "vitest";
import {
  derivePersonalSignal,
  reconcilePersonalOrdering,
  moveInOrdering,
  sortRangeByMarket,
  buildConsensusOrder,
  personalSignalToDisposition,
  buildPersonalDispositions,
  buildPersonalSignals,
  DEFAULT_PERSONAL_SIGNAL_THRESHOLDS,
} from "@/lib/helpers/personalRankings";

describe("derivePersonalSignal (percentage of market rank)", () => {
  it("is NEUTRAL when the gap is under the sell threshold (12%)", () => {
    // User's example: market 200, personal 210 → 10/200 = 5% → no signal.
    expect(derivePersonalSignal(210, 200)).toBe("NEUTRAL");
    expect(derivePersonalSignal(200, 200)).toBe("NEUTRAL");
    expect(derivePersonalSignal(111, 100)).toBe("NEUTRAL"); // 11% < 12%
  });

  it("is SELL when you rank a player 12–20% worse than the market", () => {
    // User's example: market 200, personal 230 → 30/200 = 15% → Sell.
    expect(derivePersonalSignal(230, 200)).toBe("SELL");
    expect(derivePersonalSignal(112, 100)).toBe("SELL"); // exactly 12%
  });

  it("is BUY when you rank a player 12–20% better than the market", () => {
    expect(derivePersonalSignal(85, 100)).toBe("BUY"); // 15% better
    expect(derivePersonalSignal(88, 100)).toBe("BUY"); // exactly 12%
  });

  it("escalates to STRONG (Super) Sell/Buy at/over 20%", () => {
    expect(derivePersonalSignal(240, 200)).toBe("STRONG_SELL"); // 20% worse
    expect(derivePersonalSignal(150, 200)).toBe("STRONG_BUY");  // 25% better
  });

  it("treats 20% as the inclusive STRONG boundary", () => {
    expect(derivePersonalSignal(119, 100)).toBe("SELL");        // 19% → still SELL
    expect(derivePersonalSignal(120, 100)).toBe("STRONG_SELL"); // 20% → STRONG
    expect(derivePersonalSignal(81, 100)).toBe("BUY");          // 19% → still BUY
    expect(derivePersonalSignal(80, 100)).toBe("STRONG_BUY");   // 20% → STRONG
  });

  it("applies an absolute rank-gap floor (6) so the top of the board is protected", () => {
    // Rank 10: a 5-spot gap is 50% but under the 6-spot floor → no signal.
    expect(derivePersonalSignal(15, 10)).toBe("NEUTRAL");      // delta +5, < 6 floor
    expect(derivePersonalSignal(16, 10)).toBe("SELL");         // delta +6 → fires (capped by top guard)
    // At rank 50 the floor and the 12% threshold coincide at exactly 6 spots.
    expect(derivePersonalSignal(55, 50)).toBe("NEUTRAL");      // delta +5, < 6 floor
    expect(derivePersonalSignal(56, 50)).toBe("SELL");         // delta +6 = 12%
  });

  it("caps a small delta (6–8) in the top 25 at SELL/BUY, not Super", () => {
    expect(derivePersonalSignal(16, 10)).toBe("SELL");        // delta +6 (60%) → Sell, not Super
    expect(derivePersonalSignal(18, 10)).toBe("SELL");        // delta +8 → Sell
    expect(derivePersonalSignal(4, 10)).toBe("BUY");          // delta -6 → Buy
    expect(derivePersonalSignal(19, 10)).toBe("STRONG_SELL"); // delta +9 → Super allowed
    // Outside the top 25 the cap lifts: an 8-spot move past 20% is Super again.
    expect(derivePersonalSignal(34, 26)).toBe("STRONG_SELL"); // delta +8 at rank 26 = 30.8%
  });

  it("respects custom thresholds", () => {
    const tight = { sellPct: 5, strongPct: 10, minGap: 2, topGuardRank: 25, topGuardStrongGap: 9 };
    expect(derivePersonalSignal(103, 100, tight)).toBe("NEUTRAL");     // 3% < 5
    expect(derivePersonalSignal(106, 100, tight)).toBe("SELL");        // 6% mid
    expect(derivePersonalSignal(112, 100, tight)).toBe("STRONG_SELL"); // 12% ≥ 10, rank 100 (no guard)
    expect(derivePersonalSignal(94, 100, tight)).toBe("BUY");          // 6% better
    expect(derivePersonalSignal(101, 100, tight)).toBe("NEUTRAL");     // delta 1 < minGap 2
  });

  it("exposes sane defaults", () => {
    expect(DEFAULT_PERSONAL_SIGNAL_THRESHOLDS.sellPct).toBeLessThan(
      DEFAULT_PERSONAL_SIGNAL_THRESHOLDS.strongPct,
    );
    expect(DEFAULT_PERSONAL_SIGNAL_THRESHOLDS.minGap).toBeGreaterThan(0);
  });
});

describe("reconcilePersonalOrdering", () => {
  it("seeds from consensus on first use (stored empty) → everyone NEUTRAL", () => {
    const consensus = ["A", "B", "C", "D"];
    const result = reconcilePersonalOrdering([], consensus);
    expect(result).toEqual(consensus);
    expect(result).not.toBe(consensus); // a copy, not the same reference
    // Every player's personalRank equals its consensusRank → all NEUTRAL.
    result.forEach((id, i) => {
      const consensusRank = consensus.indexOf(id) + 1;
      expect(derivePersonalSignal(i + 1, consensusRank)).toBe("NEUTRAL");
    });
  });

  it("keeps the user's order when the universe is unchanged", () => {
    expect(reconcilePersonalOrdering(["C", "A", "B"], ["A", "B", "C"])).toEqual(["C", "A", "B"]);
  });

  it("drops players who have left the universe (retired / filtered out)", () => {
    // GONE is no longer in consensus, so it falls out of the personal board.
    expect(reconcilePersonalOrdering(["GONE", "A", "B"], ["A", "B"])).toEqual(["A", "B"]);
  });

  it("splices a newcomer in at its consensus index so it reads NEUTRAL — even after heavy reordering", () => {
    // X is brand new at consensus rank 3 (index 2). The user had fully reversed
    // the old board. X must land at personal rank 3 so its signal is NEUTRAL.
    const stored = ["D", "C", "B", "A"];
    const consensus = ["A", "B", "X", "C", "D"];
    const result = reconcilePersonalOrdering(stored, consensus);
    expect(result).toEqual(["D", "C", "X", "B", "A"]);
    const personalRank = result.indexOf("X") + 1;
    const consensusRank = consensus.indexOf("X") + 1;
    expect(personalRank).toBe(consensusRank); // exact
    expect(derivePersonalSignal(personalRank, consensusRank)).toBe("NEUTRAL");
  });

  it("places multiple newcomers each at its own consensus rank", () => {
    const stored = ["B", "A"];
    const consensus = ["A", "B", "C", "D", "E"]; // C, D, E are new
    const result = reconcilePersonalOrdering(stored, consensus);
    expect(result).toEqual(["B", "A", "C", "D", "E"]);
    for (const id of ["C", "D", "E"]) {
      expect(result.indexOf(id) + 1).toBe(consensus.indexOf(id) + 1);
    }
  });

  it("dedupes corrupt stored input", () => {
    expect(reconcilePersonalOrdering(["A", "A", "B"], ["A", "B", "C"])).toEqual(["A", "B", "C"]);
  });
});

describe("moveInOrdering", () => {
  const base = ["A", "B", "C", "D", "E"];

  it("moves a player down (A → rank 4)", () => {
    expect(moveInOrdering(base, "A", 4)).toEqual(["B", "C", "D", "A", "E"]);
  });

  it("moves a player up (E → rank 2)", () => {
    expect(moveInOrdering(base, "E", 2)).toEqual(["A", "E", "B", "C", "D"]);
  });

  it("clamps a too-high target to the last slot", () => {
    expect(moveInOrdering(base, "A", 99)).toEqual(["B", "C", "D", "E", "A"]);
  });

  it("clamps a too-low target (≤ 1) to the first slot", () => {
    expect(moveInOrdering(base, "C", 0)).toEqual(["C", "A", "B", "D", "E"]);
    expect(moveInOrdering(base, "C", 1)).toEqual(["C", "A", "B", "D", "E"]);
  });

  it("rounds a fractional target", () => {
    expect(moveInOrdering(base, "E", 2.4)).toEqual(["A", "E", "B", "C", "D"]);
  });

  it("is a no-op for an unknown id (returns the same array reference)", () => {
    expect(moveInOrdering(base, "ZZZ", 2)).toBe(base);
  });
});

describe("sortRangeByMarket", () => {
  // Personal order A..H; market (consensus) rank is reversed (H best, A worst).
  const ordering = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const consensusRank = new Map([
    ["A", 8], ["B", 7], ["C", 6], ["D", 5],
    ["E", 4], ["F", 3], ["G", 2], ["H", 1],
  ]);

  it("re-sorts only the players inside the 1-based range, by market rank", () => {
    // Range 3–6 (C,D,E,F) re-ordered best-market-first → F,E,D,C; ends untouched.
    expect(sortRangeByMarket(ordering, consensusRank, 3, 6)).toEqual([
      "A", "B", "F", "E", "D", "C", "G", "H",
    ]);
  });

  it("accepts the bounds in either order", () => {
    expect(sortRangeByMarket(ordering, consensusRank, 6, 3)).toEqual([
      "A", "B", "F", "E", "D", "C", "G", "H",
    ]);
  });

  it("is a no-op for a single-rank range", () => {
    expect(sortRangeByMarket(ordering, consensusRank, 4, 4)).toEqual(ordering);
  });

  it("clamps an out-of-range end to the ordering length", () => {
    expect(sortRangeByMarket(ordering, consensusRank, 6, 999)).toEqual([
      "A", "B", "C", "D", "E", "H", "G", "F",
    ]);
  });

  it("clamps a below-1 start up to 1", () => {
    expect(sortRangeByMarket(ordering, consensusRank, -5, 2)).toEqual([
      "B", "A", "C", "D", "E", "F", "G", "H",
    ]);
  });

  it("is a no-op when the range is entirely outside the ordering", () => {
    expect(sortRangeByMarket(ordering, consensusRank, 20, 30)).toBe(ordering);
  });

  it("pushes players missing from consensus (e.g. filtered out) to the back of their slice", () => {
    const sparse = new Map([["A", 4], ["B", 1]]); // C has no consensus rank
    expect(sortRangeByMarket(["A", "B", "C"], sparse, 1, 3)).toEqual(["B", "A", "C"]);
  });
});

describe("buildConsensusOrder", () => {
  const players = {
    qb1: { player_id: "qb1", position: "QB" },
    rb1: { player_id: "rb1", position: "RB" },
    wr1: { player_id: "wr1", position: "WR" },
    k1: { player_id: "k1", position: "K" }, // non-skill position — excluded
    dead: { player_id: "dead", position: "WR" }, // zero value — excluded
  };
  const values: Record<string, number> = { qb1: 5000, rb1: 8000, wr1: 6000, k1: 9000, dead: 0 };
  const valueOf = (id: string) => values[id] ?? 0;

  it("keeps only skill positions with a positive value, sorted value-descending", () => {
    expect(buildConsensusOrder(players, valueOf)).toEqual(["rb1", "wr1", "qb1"]);
  });

  it("excludes a non-skill position even when it has the highest value", () => {
    expect(buildConsensusOrder(players, valueOf)).not.toContain("k1");
  });

  it("returns empty when nothing has value", () => {
    expect(buildConsensusOrder(players, () => 0)).toEqual([]);
  });
});

describe("personalSignalToDisposition", () => {
  it("maps each signal to the Finder's disposition contract", () => {
    expect(personalSignalToDisposition("STRONG_SELL")).toEqual({ sell: "Trade at All Costs", buy: "Zero Interest" });
    expect(personalSignalToDisposition("SELL")).toEqual({ sell: "Lower than Market", buy: "Neutral" });
    expect(personalSignalToDisposition("NEUTRAL")).toEqual({ sell: "Neutral", buy: "Neutral" });
    expect(personalSignalToDisposition("BUY")).toEqual({ sell: "Neutral", buy: "Buy at Market" });
    expect(personalSignalToDisposition("STRONG_BUY")).toEqual({ sell: "Will Trade but Higher than Market", buy: "Buy Over Market" });
  });

  it("STRONG_SELL hard-blocks acquiring (buy 'Zero Interest') and never emits a sell-side block", () => {
    // Sell-side hard block ('Not Willing to Trade') must come from CORE tags only,
    // so no signal should ever produce it.
    const all = (["STRONG_SELL", "SELL", "NEUTRAL", "BUY", "STRONG_BUY"] as const)
      .map(personalSignalToDisposition);
    expect(all.some((d) => d.sell === "Not Willing to Trade")).toBe(false);
    expect(personalSignalToDisposition("STRONG_SELL").buy).toBe("Zero Interest");
  });
});

describe("buildPersonalDispositions", () => {
  it("returns an empty map when the board is untouched (everyone NEUTRAL)", () => {
    const consensus = ["A", "B", "C", "D", "E"];
    expect(buildPersonalDispositions([], consensus)).toEqual({});
  });

  it("emits dispositions only for players moved past the neutral band", () => {
    // Consensus A..T (20 players). Move A (consensus #1) down to last → STRONG_SELL;
    // move T (consensus #20) up to first → STRONG_BUY. The rest shift by one, within band.
    const consensus = Array.from({ length: 20 }, (_, i) => String.fromCharCode(65 + i));
    const personal = ["T", ...consensus.slice(1, -1), "A"]; // T first, A last
    const map = buildPersonalDispositions(personal, consensus);
    expect(map["A"]).toEqual({ sell: "Trade at All Costs", buy: "Zero Interest" }); // personal 20 vs consensus 1
    expect(map["T"]).toEqual({ sell: "Will Trade but Higher than Market", buy: "Buy Over Market" }); // personal 1 vs consensus 20
    // Players that only drifted one slot stay neutral → absent from the sparse map.
    expect(map["B"]).toBeUndefined();
    expect(Object.keys(map).sort()).toEqual(["A", "T"]);
  });

  it("seeds from consensus first, so a first-time user gets an empty (all-neutral) map", () => {
    const consensus = ["A", "B", "C"];
    expect(buildPersonalDispositions([], consensus)).toEqual({});
  });

  it("ignores stored ids no longer in the consensus universe", () => {
    const consensus = ["A", "B", "C", "D", "E", "F", "G", "H"];
    // GONE is retired; the live move is dragging A to the bottom.
    const personal = ["GONE", "B", "C", "D", "E", "F", "G", "H", "A"];
    const map = buildPersonalDispositions(personal, consensus);
    expect(map["GONE"]).toBeUndefined();
    expect(map["A"]).toBeDefined();
  });
});

describe("buildPersonalSignals", () => {
  const consensus = Array.from({ length: 20 }, (_, i) => String.fromCharCode(65 + i)); // A..T
  const personal = ["T", ...consensus.slice(1, -1), "A"]; // T first, A last

  it("returns an empty map when the board is untouched (everyone NEUTRAL)", () => {
    expect(buildPersonalSignals([], consensus)).toEqual({});
  });

  it("emits a raw signal only for players moved past the neutral band", () => {
    const map = buildPersonalSignals(personal, consensus);
    expect(map["A"]).toBe("STRONG_SELL"); // personal 20 vs consensus 1
    expect(map["T"]).toBe("STRONG_BUY"); // personal 1 vs consensus 20
    expect(map["B"]).toBeUndefined(); // drifted one slot → neutral → absent
    expect(Object.keys(map).sort()).toEqual(["A", "T"]);
  });

  it("is the unadapted source buildPersonalDispositions translates — same sparse universe", () => {
    const signals = buildPersonalSignals(personal, consensus);
    const dispositions = buildPersonalDispositions(personal, consensus);
    expect(Object.keys(dispositions).sort()).toEqual(Object.keys(signals).sort());
    for (const id of Object.keys(signals)) {
      expect(dispositions[id]).toEqual(personalSignalToDisposition(signals[id]));
    }
  });

  it("only STRONG_SELL drives the Finder's buy-block (the Stage 6 contract)", () => {
    // The block predicate reads signal === 'STRONG_SELL'. Confirm a mid SELL does NOT
    // reach that tier. With the percentage model a top-of-board nudge is a huge %,
    // so the SELL must come from a player deep enough that an 8-spot drop is ~16%.
    const midConsensus = Array.from({ length: 100 }, (_, i) => `p${i + 1}`);
    const midPersonal = midConsensus.filter((id) => id !== "p50");
    midPersonal.splice(57, 0, "p50"); // p50 (market #50) → personal rank 58, gap 8/50 = 16%
    const map = buildPersonalSignals(midPersonal, midConsensus);
    expect(map["p50"]).toBe("SELL");
  });
});
