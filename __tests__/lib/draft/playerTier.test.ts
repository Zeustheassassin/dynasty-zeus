import { describe, it, expect } from "vitest";
import {
  PLAYER_TIERS,
  TIER_META,
  isPlayerTier,
  sanitizeTierMap,
  emptyTierCounts,
  buildTierReport,
  compareSlots,
  summarizeTiersByGroup,
  SLOT_GROUPS,
  type PlayerTier,
  type TierReportInput,
} from "@/lib/draft/playerTier";

const input = (
  over: Partial<TierReportInput> & Pick<TierReportInput, "slot" | "tier">,
): TierReportInput => ({
  name: "Player", position: "WR", year: "2023", avgPickNo: 1, ...over,
});

describe("the tier scale itself", () => {
  it("runs best to worst, which every consumer relies on for ordering", () => {
    expect(PLAYER_TIERS).toEqual(["star", "starter", "flex", "bench", "clogger", "cut"]);
  });

  it("gives every tier a full set of display metadata", () => {
    for (const tier of PLAYER_TIERS) {
      const meta = TIER_META[tier];
      expect(meta.label.length).toBeGreaterThan(0);
      // The board buttons are one glyph wide; a two-character glyph would break them.
      expect([...meta.glyph]).toHaveLength(1);
      expect(meta.text).toMatch(/^text-/);
      expect(meta.bar).toMatch(/^bg-/);
    }
  });

  it("uses a distinct glyph per tier, so buttons are never ambiguous", () => {
    const glyphs = PLAYER_TIERS.map((t) => TIER_META[t].glyph);
    expect(new Set(glyphs).size).toBe(PLAYER_TIERS.length);
  });
});

describe("isPlayerTier / sanitizeTierMap", () => {
  it("accepts every real tier", () => {
    for (const tier of PLAYER_TIERS) expect(isPlayerTier(tier)).toBe(true);
  });

  it("rejects the RETIRED hit/neutral/bust scale", () => {
    // The old grades still sit in the neighbouring DB column; if one ever reached
    // this code it must be dropped, not rendered as an unknown tier.
    expect(isPlayerTier("hit")).toBe(false);
    expect(isPlayerTier("neutral")).toBe(false);
    expect(isPlayerTier("bust")).toBe(false);
  });

  it("rejects non-strings and junk", () => {
    expect(isPlayerTier(null)).toBe(false);
    expect(isPlayerTier(undefined)).toBe(false);
    expect(isPlayerTier(3)).toBe(false);
    expect(isPlayerTier("Star")).toBe(false); // case matters — stored lowercase
  });

  it("keeps the good keys and drops the bad ones from a mixed blob", () => {
    expect(sanitizeTierMap({
      "2023_1": "star",
      "2023_2": "hit",      // retired scale
      "2023_3": "cut",
      "2023_4": 7,
      "2023_5": null,
    })).toEqual({ "2023_1": "star", "2023_3": "cut" });
  });

  it("returns an empty map for anything that isn't an object", () => {
    expect(sanitizeTierMap(null)).toEqual({});
    expect(sanitizeTierMap(undefined)).toEqual({});
    expect(sanitizeTierMap("star")).toEqual({});
    expect(sanitizeTierMap(42)).toEqual({});
  });
});

describe("buildTierReport", () => {
  it("groups by slot and counts each tier", () => {
    const report = buildTierReport([
      input({ slot: "1.01", tier: "star",    name: "A", avgPickNo: 1 }),
      input({ slot: "1.01", tier: "cut",     name: "B", avgPickNo: 1.4 }),
      input({ slot: "1.01", tier: "star",    name: "C", avgPickNo: 1.2 }),
      input({ slot: "2.05", tier: "bench",   name: "D", avgPickNo: 17 }),
    ]);

    expect(report).toHaveLength(2);
    const first = report[0];
    expect(first.slot).toBe("1.01");
    expect(first.total).toBe(3);
    expect(first.counts.star).toBe(2);
    expect(first.counts.cut).toBe(1);
    expect(first.counts.flex).toBe(0);
  });

  it("computes rates that sum to 1 across the tiers present", () => {
    const report = buildTierReport([
      input({ slot: "1.03", tier: "star" }),
      input({ slot: "1.03", tier: "flex" }),
      input({ slot: "1.03", tier: "flex" }),
      input({ slot: "1.03", tier: "cut" }),
    ]);
    const { rates } = report[0];
    expect(rates.star).toBeCloseTo(0.25);
    expect(rates.flex).toBeCloseTo(0.5);
    expect(rates.cut).toBeCloseTo(0.25);
    expect(PLAYER_TIERS.reduce((s, t) => s + rates[t], 0)).toBeCloseTo(1);
  });

  it("orders slots by round then pick, not lexically", () => {
    // "1.12" vs "2.01": a string sort would be fine here, but "10" vs "9" is the
    // case that breaks, and rounds past 9 are reachable via the 5th+ bucket.
    const report = buildTierReport([
      input({ slot: "2.01", tier: "cut" }),
      input({ slot: "10.02", tier: "cut" }),
      input({ slot: "1.12", tier: "cut" }),
      input({ slot: "1.02", tier: "cut" }),
    ]);
    expect(report.map((r) => r.slot)).toEqual(["1.02", "1.12", "2.01", "10.02"]);
  });

  it("sorts each slot's players by average pick", () => {
    const report = buildTierReport([
      input({ slot: "1.05", tier: "cut",  name: "Later",  avgPickNo: 5.9 }),
      input({ slot: "1.05", tier: "star", name: "Sooner", avgPickNo: 5.1 }),
    ]);
    expect(report[0].players.map((p) => p.name)).toEqual(["Sooner", "Later"]);
  });

  it("returns an empty report for no grades", () => {
    expect(buildTierReport([])).toEqual([]);
  });

  it("starts every slot from a zeroed count object, not a shared one", () => {
    const report = buildTierReport([
      input({ slot: "1.01", tier: "star" }),
      input({ slot: "2.01", tier: "cut" }),
    ]);
    expect(report[0].counts.cut).toBe(0);
    expect(report[1].counts.star).toBe(0);
  });
});

describe("compareSlots", () => {
  it("compares round first, then slot, numerically", () => {
    expect(compareSlots("1.12", "2.01")).toBeLessThan(0);
    expect(compareSlots("2.01", "1.12")).toBeGreaterThan(0);
    expect(compareSlots("1.02", "1.10")).toBeLessThan(0);
    expect(compareSlots("3.04", "3.04")).toBe(0);
  });
});

describe("summarizeTiersByGroup", () => {
  const report = buildTierReport([
    input({ slot: "1.01", tier: "star" }),    // Early 1st
    input({ slot: "1.04", tier: "starter" }), // Early 1st
    input({ slot: "1.06", tier: "flex" }),    // Mid 1st
    input({ slot: "3.11", tier: "cut" }),     // Late 3rd
  ]);

  it("rolls slots into their labelled buckets", () => {
    const groups = summarizeTiersByGroup(report);
    const early1 = groups.find((g) => g.label === "Early 1st")!;
    expect(early1.total).toBe(2);
    expect(early1.counts.star).toBe(1);
    expect(early1.counts.starter).toBe(1);

    const mid1 = groups.find((g) => g.label === "Mid 1st")!;
    expect(mid1.total).toBe(1);
    expect(mid1.counts.flex).toBe(1);
  });

  it("drops buckets nothing has been graded into, so no empty columns render", () => {
    const labels = summarizeTiersByGroup(report).map((g) => g.label);
    expect(labels).toEqual(["Early 1st", "Mid 1st", "Late 3rd"]);
    expect(labels).not.toContain("4th Round");
  });

  it("puts every round past the 4th in the 5th+ bucket", () => {
    // The old H/N/B summary matched `round === 5` exactly, so a 6th-round or
    // waiver-slot grade fell out of the totals entirely.
    const deep = buildTierReport([
      input({ slot: "5.02", tier: "cut" }),
      input({ slot: "6.08", tier: "clogger" }),
      input({ slot: "12.01", tier: "cut" }),
    ]);
    const groups = summarizeTiersByGroup(deep);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("5th+/Waiv");
    expect(groups[0].total).toBe(3);
    expect(groups[0].counts.cut).toBe(2);
    expect(groups[0].counts.clogger).toBe(1);
  });

  it("keeps the 4th-round bucket separate from the 5th+ one", () => {
    const groups = summarizeTiersByGroup(buildTierReport([
      input({ slot: "4.09", tier: "bench" }),
      input({ slot: "5.01", tier: "cut" }),
    ]));
    expect(groups.map((g) => g.label)).toEqual(["4th Round", "5th+/Waiv"]);
  });

  it("covers rounds 1-4 with no gaps and no overlaps", () => {
    for (let slot = 1; slot <= 12; slot++) {
      for (let round = 1; round <= 4; round++) {
        const matches = SLOT_GROUPS.filter(
          (g) => g.round === round && slot >= g.min && slot <= g.max,
        );
        expect(matches, `round ${round} slot ${slot}`).toHaveLength(1);
      }
    }
  });

  it("returns nothing for an empty report", () => {
    expect(summarizeTiersByGroup([])).toEqual([]);
  });
});

describe("emptyTierCounts", () => {
  it("zeroes every tier and hands back a fresh object each call", () => {
    const a = emptyTierCounts();
    const b = emptyTierCounts();
    expect(Object.values(a).every((v) => v === 0)).toBe(true);
    a.star = 5;
    expect(b.star).toBe(0);
  });

  it("has a key for every tier and nothing else", () => {
    expect(Object.keys(emptyTierCounts()).sort()).toEqual([...PLAYER_TIERS].sort());
  });
});

describe("tier keys round-trip through the stored blob shape", () => {
  it("survives a JSON round trip the way Supabase jsonb stores them", () => {
    const stored: Record<string, PlayerTier> = { "2023_4034": "star", "2024_11": "clogger" };
    expect(sanitizeTierMap(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });
});
