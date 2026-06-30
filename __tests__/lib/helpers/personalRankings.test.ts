import { describe, it, expect } from "vitest";
import {
  derivePersonalSignal,
  reconcilePersonalOrdering,
  moveInOrdering,
  buildConsensusOrder,
  personalSignalToDisposition,
  buildPersonalDispositions,
  buildPersonalSignals,
  DEFAULT_PERSONAL_SIGNAL_THRESHOLDS,
} from "@/lib/helpers/personalRankings";

describe("derivePersonalSignal", () => {
  it("is NEUTRAL when personal and consensus ranks are close (within the band)", () => {
    // The user's example: player X at personal 14 vs consensus 13 → neutral.
    expect(derivePersonalSignal(14, 13)).toBe("NEUTRAL");
    expect(derivePersonalSignal(13, 13)).toBe("NEUTRAL");
    expect(derivePersonalSignal(8, 13)).toBe("NEUTRAL"); // delta -5, exactly the band
    expect(derivePersonalSignal(18, 13)).toBe("NEUTRAL"); // delta +5, exactly the band
  });

  it("is SELL when you rank a player worse than the market (positive delta, mid)", () => {
    // Player Y at personal 32 vs consensus 18 → delta +14 → sell, don't buy.
    expect(derivePersonalSignal(32, 18)).toBe("SELL");
  });

  it("is BUY when you rank a player better than the market (negative delta, mid)", () => {
    // Player Z at personal 19 vs consensus 33 → delta -14 → buy, don't sell.
    expect(derivePersonalSignal(19, 33)).toBe("BUY");
  });

  it("escalates to STRONG_SELL / STRONG_BUY past the strong band", () => {
    expect(derivePersonalSignal(40, 18)).toBe("STRONG_SELL"); // delta +22
    expect(derivePersonalSignal(10, 40)).toBe("STRONG_BUY"); // delta -30
  });

  it("treats the strong band as inclusive of SELL/BUY (boundary at strongBand)", () => {
    // delta exactly +15 is still SELL; +16 tips into STRONG_SELL.
    expect(derivePersonalSignal(20, 5)).toBe("SELL"); // delta +15
    expect(derivePersonalSignal(21, 5)).toBe("STRONG_SELL"); // delta +16
    expect(derivePersonalSignal(5, 20)).toBe("BUY"); // delta -15
    expect(derivePersonalSignal(5, 21)).toBe("STRONG_BUY"); // delta -16
  });

  it("respects custom thresholds", () => {
    const tight = { neutralBand: 1, strongBand: 3 };
    expect(derivePersonalSignal(10, 11, tight)).toBe("NEUTRAL"); // delta -1, within band
    expect(derivePersonalSignal(10, 12, tight)).toBe("BUY"); // delta -2, mid (|2|>1, not >3)
    expect(derivePersonalSignal(10, 15, tight)).toBe("STRONG_BUY"); // delta -5 (>3)
    expect(derivePersonalSignal(14, 12, tight)).toBe("SELL"); // delta +2, mid
  });

  it("exposes sane defaults", () => {
    expect(DEFAULT_PERSONAL_SIGNAL_THRESHOLDS.neutralBand).toBeLessThan(
      DEFAULT_PERSONAL_SIGNAL_THRESHOLDS.strongBand,
    );
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
    // reach that tier: move A only past the neutral band but short of the strong band.
    const midConsensus = Array.from({ length: 12 }, (_, i) => String.fromCharCode(65 + i)); // A..L
    const midPersonal = ["B", "C", "D", "E", "F", "G", "H", "A", "I", "J", "K", "L"]; // A: #1 → #8 (delta +7)
    const map = buildPersonalSignals(midPersonal, midConsensus);
    expect(map["A"]).toBe("SELL");
  });
});
