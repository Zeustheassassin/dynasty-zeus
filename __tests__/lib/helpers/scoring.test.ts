import { describe, it, expect } from "vitest";
import {
  normalizeProjName,
  DEFAULT_SCORING,
  FC_BASELINE_SCORING,
  computeLeagueFpts,
  computeScoringMultipliers,
  getNonStandardRules,
  formatRule,
  groupRules,
} from "@/lib/helpers/scoring";

// ── normalizeProjName ────────────────────────────────────────────────────────

describe("normalizeProjName", () => {
  it("lowercases and removes non-alpha characters", () => {
    expect(normalizeProjName("Patrick Mahomes")).toBe("patrickmahomes");
  });

  it("strips Jr suffix", () => {
    expect(normalizeProjName("Tyreek Hill Jr.")).toBe("tyreekhill");
    expect(normalizeProjName("Calvin Ridley Jr")).toBe("calvinridley");
  });

  it("strips Sr suffix", () => {
    expect(normalizeProjName("Player Sr.")).toBe("player");
  });

  it("strips roman numeral suffixes II, III, IV, V", () => {
    expect(normalizeProjName("Calvin Johnson II")).toBe("calvinjohnson");
    expect(normalizeProjName("Player III")).toBe("player");
    expect(normalizeProjName("Player IV")).toBe("player");
    expect(normalizeProjName("Player V")).toBe("player");
  });

  it("removes hyphens, apostrophes, spaces, and numbers", () => {
    expect(normalizeProjName("D'Andre Swift")).toBe("dandreswift");
    expect(normalizeProjName("Odell Beckham-Jones 84")).toBe("odellbeckhamjones");
  });

  it("handles an already-normalized name", () => {
    expect(normalizeProjName("justinjefferson")).toBe("justinjefferson");
  });
});

// ── DEFAULT_SCORING ──────────────────────────────────────────────────────────

describe("DEFAULT_SCORING", () => {
  it("is full PPR (rec = 1)", () => {
    expect(DEFAULT_SCORING.rec).toBe(1);
  });

  it("has 4pt passing TDs", () => {
    expect(DEFAULT_SCORING.pass_td).toBe(4);
  });

  it("has 0.5 TE premium", () => {
    expect(DEFAULT_SCORING.bonus_rec_te).toBe(0.5);
  });
});

// ── FC_BASELINE_SCORING ──────────────────────────────────────────────────────

describe("FC_BASELINE_SCORING", () => {
  it("is full PPR with no TE premium", () => {
    expect(FC_BASELINE_SCORING.rec).toBe(1);
    expect(FC_BASELINE_SCORING.bonus_rec_te).toBe(0);
  });

  it("has 4pt passing TDs", () => {
    expect(FC_BASELINE_SCORING.pass_td).toBe(4);
  });
});

// ── computeLeagueFpts ────────────────────────────────────────────────────────

describe("computeLeagueFpts", () => {
  it("returns 0 for empty stats", () => {
    expect(computeLeagueFpts({}, DEFAULT_SCORING, "WR")).toBe(0);
  });

  it("computes basic passing stats for QB", () => {
    const stats = { pass_yd: 300, pass_td: 3 };
    // 300 * 0.04 + 3 * 4 = 12 + 12 = 24
    expect(computeLeagueFpts(stats, DEFAULT_SCORING, "QB")).toBeCloseTo(24, 5);
  });

  it("computes full PPR receiving stats", () => {
    const stats = { rec: 8, rec_yd: 100 };
    // 8 * 1 + 100 * 0.1 = 8 + 10 = 18
    expect(computeLeagueFpts(stats, DEFAULT_SCORING, "WR")).toBeCloseTo(18, 5);
  });

  it("applies TE premium for TE position", () => {
    const stats = { rec: 5, rec_yd: 50 };
    // rec: 5*1=5, rec_yd: 50*0.1=5, bonus_rec_te: 5*0.5=2.5 → 12.5
    expect(computeLeagueFpts(stats, DEFAULT_SCORING, "TE")).toBeCloseTo(12.5, 5);
  });

  it("does not apply TE premium for WR position", () => {
    const stats = { rec: 5, rec_yd: 50 };
    // same stats, no bonus_rec_te → 10
    expect(computeLeagueFpts(stats, DEFAULT_SCORING, "WR")).toBeCloseTo(10, 5);
  });

  it("applies RB premium when scoring has bonus_rec_rb", () => {
    const scoring = { ...FC_BASELINE_SCORING, bonus_rec_rb: 0.5 };
    const stats = { rec: 4, rec_yd: 30 };
    // rec: 4*1=4, rec_yd: 30*0.1=3, bonus_rec_rb: 4*0.5=2 → 9
    expect(computeLeagueFpts(stats, scoring, "RB")).toBeCloseTo(9, 5);
  });

  it("applies WR premium when scoring has bonus_rec_wr", () => {
    const scoring = { ...FC_BASELINE_SCORING, bonus_rec_wr: 0.5 };
    const stats = { rec: 6, rec_yd: 80 };
    // rec: 6*1=6, rec_yd: 80*0.1=8, bonus_rec_wr: 6*0.5=3 → 17
    expect(computeLeagueFpts(stats, scoring, "WR")).toBeCloseTo(17, 5);
  });

  it("handles null and undefined stat values gracefully", () => {
    const stats = { pass_yd: null, pass_td: undefined, rec: 3 };
    // Only rec contributes: 3 * 1 = 3
    expect(computeLeagueFpts(stats, DEFAULT_SCORING, "WR")).toBeCloseTo(3, 5);
  });

  it("includes rushing TDs", () => {
    const stats = { rush_yd: 100, rush_td: 1 };
    // 100*0.1 + 1*6 = 10 + 6 = 16
    expect(computeLeagueFpts(stats, DEFAULT_SCORING, "RB")).toBeCloseTo(16, 5);
  });
});

// ── computeScoringMultipliers ────────────────────────────────────────────────

describe("computeScoringMultipliers", () => {
  it("returns all 1.0 multipliers when scoring matches FC baseline", () => {
    const result = computeScoringMultipliers(FC_BASELINE_SCORING);
    expect(result.QB).toBeCloseTo(1.0, 5);
    expect(result.WR).toBeCloseTo(1.0, 5);
    expect(result.RB).toBeCloseTo(1.0, 5);
    expect(result.TE).toBeCloseTo(1.0, 5);
  });

  it("returns TE > 1.0 for a TEP league (bonus_rec_te = 0.5)", () => {
    const tepScoring = { ...FC_BASELINE_SCORING, bonus_rec_te: 0.5 };
    const result = computeScoringMultipliers(tepScoring);
    expect(result.TE).toBeGreaterThan(1.0);
    // Other positions unaffected by TEP
    expect(result.QB).toBeCloseTo(1.0, 5);
    expect(result.WR).toBeCloseTo(1.0, 5);
    expect(result.RB).toBeCloseTo(1.0, 5);
  });

  it("returns QB > 1.0 for 6pt passing TD league", () => {
    const scoring = { ...FC_BASELINE_SCORING, pass_td: 6 };
    const result = computeScoringMultipliers(scoring);
    expect(result.QB).toBeGreaterThan(1.0);
  });

  it("clamps extreme multipliers to 0.70 – 1.30", () => {
    // Zero-PPR league
    const halfPprScoring = { ...FC_BASELINE_SCORING, rec: 0 };
    const result = computeScoringMultipliers(halfPprScoring);
    Object.values(result).forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0.70);
      expect(v).toBeLessThanOrEqual(1.30);
    });
  });

  it("returns QB, WR, RB, TE keys", () => {
    const result = computeScoringMultipliers(FC_BASELINE_SCORING);
    expect(Object.keys(result).sort()).toEqual(["QB", "RB", "TE", "WR"].sort());
  });
});

// ── getNonStandardRules ──────────────────────────────────────────────────────

describe("getNonStandardRules", () => {
  it("returns empty array for empty scoring object", () => {
    expect(getNonStandardRules({})).toEqual([]);
  });

  it("ignores zero-value rules", () => {
    expect(getNonStandardRules({ rec: 0, pass_td: 0 })).toEqual([]);
  });

  it("detects a PPR rule (rec is 0 in STANDARD_SCORING)", () => {
    const result = getNonStandardRules({ rec: 1 });
    expect(result).toContainEqual({ key: "rec", value: 1 });
  });

  it("detects TE premium as non-standard", () => {
    const result = getNonStandardRules({ bonus_rec_te: 0.5 });
    expect(result).toContainEqual({ key: "bonus_rec_te", value: 0.5 });
  });

  it("flags a rule absent from STANDARD_SCORING as non-standard", () => {
    const result = getNonStandardRules({ custom_bonus: 2 });
    expect(result).toContainEqual({ key: "custom_bonus", value: 2 });
  });

  it("does not flag rules that match their standard value", () => {
    // pass_yd: 0.04 matches STANDARD_SCORING, but it's non-zero and standard !== undefined
    // Only returns if value !== standard — pass_yd standard is 0.04
    const result = getNonStandardRules({ pass_yd: 0.04 });
    expect(result).not.toContainEqual(expect.objectContaining({ key: "pass_yd" }));
  });
});

// ── formatRule ───────────────────────────────────────────────────────────────

describe("formatRule", () => {
  it("returns a human-readable label for known keys", () => {
    expect(formatRule("pass_int")).toBe("Interceptions Thrown");
    expect(formatRule("rec")).toBe("PPR");
    expect(formatRule("bonus_rec_te")).toBe("TE Premium");
    expect(formatRule("bonus_rec_rb")).toBe("RB Premium");
  });

  it("title-cases unknown keys by replacing underscores with spaces", () => {
    expect(formatRule("some_custom_rule")).toBe("Some Custom Rule");
    expect(formatRule("rush_fd")).toBe("Rushing First Downs");
  });
});

// ── groupRules ───────────────────────────────────────────────────────────────

describe("groupRules", () => {
  const rules = [
    { key: "pass_td", value: 4 },
    { key: "pass_int", value: -2 },
    { key: "rush_td", value: 6 },
    { key: "rush_yd", value: 0.1 },
    { key: "rec", value: 1 },
    { key: "rec_yd", value: 0.1 },
    { key: "bonus_rec_te", value: 0.5 },
  ];

  it("groups passing rules under Passing", () => {
    const { Passing } = groupRules(rules);
    expect(Passing.map((r) => r.key)).toEqual(expect.arrayContaining(["pass_td", "pass_int"]));
    expect(Passing.some((r) => r.key.startsWith("rush"))).toBe(false);
  });

  it("groups rushing rules under Rushing", () => {
    const { Rushing } = groupRules(rules);
    expect(Rushing.map((r) => r.key)).toEqual(expect.arrayContaining(["rush_td", "rush_yd"]));
    expect(Rushing.some((r) => r.key.startsWith("pass"))).toBe(false);
  });

  it("groups receiving rules (rec, rec_*, bonus_rec*) under Receiving", () => {
    const { Receiving } = groupRules(rules);
    expect(Receiving.map((r) => r.key)).toEqual(
      expect.arrayContaining(["rec", "rec_yd", "bonus_rec_te"])
    );
  });

  it("returns empty buckets for an empty rules array", () => {
    const result = groupRules([]);
    expect(result.Passing).toHaveLength(0);
    expect(result.Rushing).toHaveLength(0);
    expect(result.Receiving).toHaveLength(0);
  });
});
