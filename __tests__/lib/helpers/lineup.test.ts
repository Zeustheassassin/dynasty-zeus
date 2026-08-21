import { describe, it, expect } from "vitest";
import type { LineupCoachRow } from "@/lib/types";
import {
  FLEX_ELIGIBLE_POSITIONS,
  SUPER_FLEX_ELIGIBLE_POSITIONS,
  getLineupSettings,
  getLineupSlotEligiblePositions,
  rebalanceLineupForKickoffWindows,
} from "@/lib/helpers/lineup";

// ── Constants ────────────────────────────────────────────────────────────────

describe("FLEX_ELIGIBLE_POSITIONS", () => {
  it("contains RB, WR, and TE", () => {
    expect(FLEX_ELIGIBLE_POSITIONS).toEqual(["RB", "WR", "TE"]);
  });
});

describe("SUPER_FLEX_ELIGIBLE_POSITIONS", () => {
  it("contains QB, RB, WR, and TE", () => {
    expect(SUPER_FLEX_ELIGIBLE_POSITIONS).toEqual(["QB", "RB", "WR", "TE"]);
  });
});

// ── getLineupSettings ────────────────────────────────────────────────────────

describe("getLineupSettings", () => {
  it("returns empty string for null league", () => {
    expect(getLineupSettings(null)).toBe("");
  });

  it("returns empty string for undefined league", () => {
    expect(getLineupSettings(undefined)).toBe("");
  });

  it("returns empty string for league with no roster_positions", () => {
    expect(getLineupSettings({})).toBe("");
  });

  it("excludes BN, IR, and TAXI slots", () => {
    const league = { roster_positions: ["QB", "BN", "IR", "TAXI", "RB"] };
    expect(getLineupSettings(league)).toBe("QB 1 • RB 1");
  });

  it("formats a standard superflex lineup", () => {
    const league = {
      roster_positions: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "BN", "BN", "BN"],
    };
    expect(getLineupSettings(league)).toBe("QB 1 • RB 2 • WR 3 • TE 1 • FLEX 1 • SFLEX 1");
  });

  it("abbreviates SUPER_FLEX as SFLEX", () => {
    const league = { roster_positions: ["SUPER_FLEX"] };
    expect(getLineupSettings(league)).toBe("SFLEX 1");
  });

  it("counts multiple slots of the same position", () => {
    const league = { roster_positions: ["RB", "RB", "RB"] };
    expect(getLineupSettings(league)).toBe("RB 3");
  });
});

// ── getLineupSlotEligiblePositions ───────────────────────────────────────────

describe("getLineupSlotEligiblePositions", () => {
  it("returns FLEX_ELIGIBLE_POSITIONS for FLEX slot", () => {
    expect(getLineupSlotEligiblePositions("FLEX")).toBe(FLEX_ELIGIBLE_POSITIONS);
  });

  it("returns SUPER_FLEX_ELIGIBLE_POSITIONS for SUPER_FLEX slot", () => {
    expect(getLineupSlotEligiblePositions("SUPER_FLEX")).toBe(SUPER_FLEX_ELIGIBLE_POSITIONS);
  });

  it("returns a single-element array for a positional slot", () => {
    expect(getLineupSlotEligiblePositions("QB")).toEqual(["QB"]);
    expect(getLineupSlotEligiblePositions("RB")).toEqual(["RB"]);
    expect(getLineupSlotEligiblePositions("WR")).toEqual(["WR"]);
    expect(getLineupSlotEligiblePositions("TE")).toEqual(["TE"]);
  });
});

// ── rebalanceLineupForKickoffWindows ─────────────────────────────────────────

// Build a minimal LineupCoachRow for testing
const makeRow = (
  slot: string,
  position: string | null,
  kickoffAt: number | null,
  id = "p1"
): LineupCoachRow => ({
  slot,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  player: position ? ({ player_id: id, position } as any) : null,
  score: 0,
  kickoffAt,
});

describe("rebalanceLineupForKickoffWindows", () => {
  it("returns the original lineup unchanged when hasKickoffData is false", () => {
    const lineup = [makeRow("RB", "RB", 1000), makeRow("FLEX", "RB", 800, "p2")];
    const result = rebalanceLineupForKickoffWindows(lineup, false);
    expect(result).toBe(lineup);
  });

  it("swaps RB into locked slot when FLEX RB has an earlier kickoff", () => {
    // Locked RB slot at 14:00, FLEX RB at 13:00 → FLEX moves to locked
    const locked = makeRow("RB", "RB", 1400, "late");
    const flex   = makeRow("FLEX", "RB", 1300, "early");
    const result = rebalanceLineupForKickoffWindows([locked, flex], true);

    expect(result[0].slot).toBe("RB");
    expect(result[0].player?.player_id).toBe("early");
    expect(result[1].slot).toBe("FLEX");
    expect(result[1].player?.player_id).toBe("late");
  });

  it("does not swap when locked slot has an earlier kickoff", () => {
    const locked = makeRow("RB", "RB", 1300, "early");
    const flex   = makeRow("FLEX", "RB", 1400, "late");
    const result = rebalanceLineupForKickoffWindows([locked, flex], true);

    expect(result[0].player?.player_id).toBe("early");
    expect(result[1].player?.player_id).toBe("late");
  });

  it("does not swap when kickoffs are equal", () => {
    const locked = makeRow("RB", "RB", 1300, "a");
    const flex   = makeRow("FLEX", "RB", 1300, "b");
    const result = rebalanceLineupForKickoffWindows([locked, flex], true);

    expect(result[0].player?.player_id).toBe("a");
    expect(result[1].player?.player_id).toBe("b");
  });

  it("does not swap FLEX player into wrong positional slot (WR in RB slot)", () => {
    const locked = makeRow("RB", "RB", 1400, "rb");
    const flex   = makeRow("FLEX", "WR", 1300, "wr");
    const result = rebalanceLineupForKickoffWindows([locked, flex], true);

    // WR is not eligible for the RB locked slot
    expect(result[0].player?.player_id).toBe("rb");
    expect(result[1].player?.player_id).toBe("wr");
  });

  it("swaps QB into SUPER_FLEX from locked QB slot", () => {
    // SUPER_FLEX has an RB, locked QB has a later kickoff than a QB in SUPER_FLEX
    // Actually: try to move an earlier-kicking QB (in SUPER_FLEX) into the locked QB slot
    const lockedQB  = makeRow("QB", "QB", 1400, "lateQB");
    const superFlex = makeRow("SUPER_FLEX", "QB", 1300, "earlyQB");
    const result    = rebalanceLineupForKickoffWindows([lockedQB, superFlex], true);

    expect(result[0].slot).toBe("QB");
    expect(result[0].player?.player_id).toBe("earlyQB");
    expect(result[1].slot).toBe("SUPER_FLEX");
    expect(result[1].player?.player_id).toBe("lateQB");
  });

  it("treats null kickoffAt as last priority (MAX_SAFE_INTEGER)", () => {
    // Locked RB has null kickoffAt → treated as very late → FLEX RB with real kickoff should swap in
    const locked = makeRow("RB", "RB", null, "nullKickoff");
    const flex   = makeRow("FLEX", "RB", 1300, "realKickoff");
    const result = rebalanceLineupForKickoffWindows([locked, flex], true);

    expect(result[0].player?.player_id).toBe("realKickoff");
    expect(result[1].player?.player_id).toBe("nullKickoff");
  });

  it("returns a new array (does not mutate the input)", () => {
    const lineup = [makeRow("RB", "RB", 1400, "a"), makeRow("FLEX", "RB", 1300, "b")];
    const result = rebalanceLineupForKickoffWindows(lineup, true);
    expect(result).not.toBe(lineup);
  });

  it("with 2 locked RB slots and 2 FLEX RBs, assigns the earliest FLEX kickoff to each locked slot without duplicating or dropping a player", () => {
    // Regression test: flexIndexes used to be computed once before the
    // lockedIndexes loop, so every locked slot re-selected the SAME
    // earliest-kickoff FLEX candidate instead of the next-best one —
    // duplicating that player into two slots and silently dropping another.
    const rb1  = makeRow("RB", "RB", 1300, "rb1-late-ish");   // 1:00pm
    const rb2  = makeRow("RB", "RB", 1600, "rb2-latest");     // 4:00pm
    const flex1 = makeRow("FLEX", "RB", 900,  "flex1-earliest");  // 9:00am
    const flex2 = makeRow("FLEX", "RB", 1000, "flex2-early");     // 10:00am

    const result = rebalanceLineupForKickoffWindows([rb1, rb2, flex1, flex2], true);

    // Every original player must still appear exactly once.
    const ids = result.map((r) => r.player?.player_id).sort();
    expect(ids).toEqual(["flex1-earliest", "flex2-early", "rb1-late-ish", "rb2-latest"].sort());

    const bySlot = (slot: string) => result.filter((r) => r.slot === slot).map((r) => r.player?.player_id);
    // The earliest FLEX RB (flex1) fills the first locked RB slot...
    expect(bySlot("RB")).toContain("flex1-earliest");
    // ...and the next-earliest (flex2) fills the SECOND locked RB slot,
    // not a repeat of flex1.
    expect(bySlot("RB")).toContain("flex2-early");
    expect(bySlot("RB")).not.toContain("rb1-late-ish");
    expect(bySlot("RB")).not.toContain("rb2-latest");
    // The two bumped locked players land in the vacated FLEX slots.
    expect(bySlot("FLEX").sort()).toEqual(["rb1-late-ish", "rb2-latest"].sort());
  });
});
