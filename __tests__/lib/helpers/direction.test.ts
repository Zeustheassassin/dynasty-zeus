import { describe, it, expect } from "vitest";
import {
  getLeagueDirectionBucket,
  computeWindowScore,
  getAdjustedDirectionBucket,
  getBucketColor,
  getTradePartnerFitLabel,
  getRosterDirectionProfile,
} from "@/lib/helpers/direction";

// ── getLeagueDirectionBucket ─────────────────────────────────────────

describe("getLeagueDirectionBucket", () => {
  it("returns Elite when both ranks are in top-20% of a 12-team league", () => {
    // top20 = ceil(12 * 0.20) = 3; both rank 1 and rank 2 qualify
    const { bucket } = getLeagueDirectionBucket(1, 1, 12);
    expect(bucket).toBe("Elite");
  });

  it("returns True Contender when both ranks are in top-33% but not both top-20%", () => {
    // top20 = 3, top33 = ceil(12*0.33) = 4; rank 4 is in top33 but not top20
    const { bucket } = getLeagueDirectionBucket(4, 4, 12);
    expect(bucket).toBe("True Contender");
  });

  it("returns Almost There for top-third dynasty but mid-third redraft", () => {
    // dynRank=2 (top33), redRank=6 (mid-third: top33=4, bot33=ceil(12*0.67)=9)
    const { bucket } = getLeagueDirectionBucket(2, 6, 12);
    expect(bucket).toBe("Almost There");
  });

  it("returns Rebuilder for top-third dynasty but bottom-third redraft", () => {
    // dynRank=1, redRank=11 (> bot33=8)
    const { bucket } = getLeagueDirectionBucket(1, 11, 12);
    expect(bucket).toBe("Rebuilder");
  });

  it("returns Fading Contender for mid-third dynasty and top-third redraft", () => {
    const { bucket } = getLeagueDirectionBucket(6, 2, 12);
    expect(bucket).toBe("Fading Contender");
  });

  it("returns Purgatory for mid-third dynasty and mid-third redraft", () => {
    const { bucket } = getLeagueDirectionBucket(6, 6, 12);
    expect(bucket).toBe("Purgatory");
  });

  it("returns Stranded for mid-third dynasty and bottom-third redraft", () => {
    const { bucket } = getLeagueDirectionBucket(6, 11, 12);
    expect(bucket).toBe("Stranded");
  });

  it("returns Window Closing for bottom-third dynasty and top-third redraft", () => {
    const { bucket } = getLeagueDirectionBucket(11, 2, 12);
    expect(bucket).toBe("Window Closing");
  });

  it("returns Fading Out for bottom-third dynasty and mid-third redraft", () => {
    const { bucket } = getLeagueDirectionBucket(11, 6, 12);
    expect(bucket).toBe("Fading Out");
  });

  it("returns Hopeless for bottom-third dynasty and bottom-third redraft", () => {
    const { bucket } = getLeagueDirectionBucket(11, 11, 12);
    expect(bucket).toBe("Hopeless");
  });

  it("scales correctly for an 8-team league", () => {
    // top20 = ceil(8*0.20) = 2; top33 = ceil(8*0.33) = 3
    const { bucket: elite } = getLeagueDirectionBucket(1, 1, 8);
    expect(elite).toBe("Elite");
    const { bucket: hopeless } = getLeagueDirectionBucket(8, 8, 8);
    expect(hopeless).toBe("Hopeless");
  });

  it("returns a non-empty bucketColor string for every bucket", () => {
    const cases: [number, number][] = [
      [1, 1], [4, 4], [2, 6], [1, 11], [6, 2], [6, 6], [6, 11], [11, 2], [11, 6], [11, 11],
    ];
    for (const [d, r] of cases) {
      const { bucketColor } = getLeagueDirectionBucket(d, r, 12);
      expect(bucketColor.length).toBeGreaterThan(0);
    }
  });
});

// ── getBucketColor ──────────────────────────────────────────────────

describe("getBucketColor", () => {
  it("returns a color string for every known bucket", () => {
    const buckets = [
      "Elite", "True Contender", "Almost There", "Rebuilder",
      "Fading Contender", "Window Closing", "Purgatory",
      "Stranded", "Fading Out", "Hopeless",
    ];
    for (const b of buckets) {
      const color = getBucketColor(b);
      expect(color).not.toBe("text-gray-300 bg-gray-800 border-gray-600");
    }
  });

  it("returns fallback gray for unknown bucket", () => {
    expect(getBucketColor("Unknown")).toBe("text-gray-300 bg-gray-800 border-gray-600");
  });
});

// ── computeWindowScore ──────────────────────────────────────────────

describe("computeWindowScore", () => {
  it("returns 0 for null/undefined profile", () => {
    expect(computeWindowScore(null)).toBe(0);
    expect(computeWindowScore(undefined)).toBe(0);
  });

  it("returns positive score for a young roster (coreAge=24, youngCoreCount=3)", () => {
    const score = computeWindowScore({ coreAge: 24, youngCoreCount: 3, oldCoreCount: 0 });
    // 26-24 = 2 * 0.25 = 0.5; youngCoreCount 3 * 0.85 = 2.55 → 3.05
    expect(score).toBeGreaterThan(0);
  });

  it("returns negative score for an aging roster (coreAge=30, oldCoreCount=4)", () => {
    const score = computeWindowScore({ coreAge: 30, youngCoreCount: 0, oldCoreCount: 4 });
    // age penalty: (30-26)*0.55=2.2; old penalty: 4*1.05=4.2 → -6.4
    expect(score).toBeLessThan(0);
  });

  it("returns 0 when coreAge is exactly 26 and other counts are 0", () => {
    expect(computeWindowScore({ coreAge: 26, youngCoreCount: 0, oldCoreCount: 0 })).toBe(0);
  });
});

// ── getAdjustedDirectionBucket ──────────────────────────────────────

describe("getAdjustedDirectionBucket", () => {
  it("leaves Elite unchanged when composite is neutral (no sim data)", () => {
    const result = getAdjustedDirectionBucket(
      "Elite",
      { coreAge: 26, youngCoreCount: 0, oldCoreCount: 0 },
      50,
      false
    );
    expect(result).toBe("Elite");
  });

  it("demotes Elite to True Contender when composite < -2 (aging core, no sim data)", () => {
    // coreAge=31 → -(31-26)*0.55 = -2.75; oldCoreCount=2 → -2*1.05=-2.1 → total ≈ -4.85
    const result = getAdjustedDirectionBucket(
      "Elite",
      { coreAge: 31, youngCoreCount: 0, oldCoreCount: 2 },
      50,
      false
    );
    expect(["True Contender", "Fading Contender"]).toContain(result);
  });

  it("applies playoff floor: Elite → Rebuilder when playoffOdds < 15 with sim data", () => {
    const result = getAdjustedDirectionBucket(
      "Elite",
      { coreAge: 26, youngCoreCount: 0, oldCoreCount: 0 },
      10,
      true
    );
    expect(result).toBe("Rebuilder");
  });

  it("applies playoff floor: True Contender → Almost There when odds < 50 with sim data (neutral gradient)", () => {
    // coreAge=26 → windowScore=0; playoffPressure=(49-50)/12.5≈-0.08 → composite≈-0.08
    // composite > -1.5 so gradient keeps it as True Contender, then floor fires
    const result = getAdjustedDirectionBucket(
      "True Contender",
      { coreAge: 26, youngCoreCount: 0, oldCoreCount: 0 },
      49,
      true
    );
    expect(result).toBe("Almost There");
  });

  it("returns Fading Out for empty rawBucket", () => {
    const result = getAdjustedDirectionBucket("", null, 50, false);
    expect(result).toBe("Fading Out");
  });

  it("promotes True Contender to Elite with strong positive composite and sim data showing high odds", () => {
    // youngCoreCount=4 → +3.4; coreAge=23 → +(26-23)*0.25=0.75; playoffOdds=90 → (90-50)/12.5=3.2
    // composite ≈ 7.35 → should trigger Elite promotion in True Contender case
    const result = getAdjustedDirectionBucket(
      "True Contender",
      { coreAge: 23, youngCoreCount: 4, oldCoreCount: 0 },
      90,
      true
    );
    expect(result).toBe("Elite");
  });
});

// ── getTradePartnerFitLabel ─────────────────────────────────────────

describe("getTradePartnerFitLabel", () => {
  it("labels scores correctly", () => {
    expect(getTradePartnerFitLabel(40)).toBe("Best Trade Partner");
    expect(getTradePartnerFitLabel(34)).toBe("Best Trade Partner");
    expect(getTradePartnerFitLabel(33)).toBe("Strong Fit");
    expect(getTradePartnerFitLabel(24)).toBe("Strong Fit");
    expect(getTradePartnerFitLabel(23)).toBe("Solid Fit");
    expect(getTradePartnerFitLabel(14)).toBe("Solid Fit");
    expect(getTradePartnerFitLabel(10)).toBe("Neutral Fit");
    expect(getTradePartnerFitLabel(3)).toBe("Tough Fit");
    expect(getTradePartnerFitLabel(0)).toBe("Tough Fit");
  });
});

// ── getRosterDirectionProfile ───────────────────────────────────────

describe("getRosterDirectionProfile", () => {
  const makeRoster = (id: number, wins = 5, fpts = 1200) => ({
    roster_id: id,
    players: [],
    settings: { wins, losses: 10 - wins, fpts, fpts_max: fpts * 1.1 },
  });

  it("returns null when rosterId is 0", () => {
    const result = getRosterDirectionProfile({
      rosterId: 0,
      rosters: [makeRoster(1)],
      ownedPicks: [],
      players: {},
      pickValues: {},
      redraftValues: {},
      dynastyValueForPlayer: () => 0,
    });
    expect(result).toBeNull();
  });

  it("returns null when rosters array is empty", () => {
    const result = getRosterDirectionProfile({
      rosterId: 1,
      rosters: [],
      ownedPicks: [],
      players: {},
      pickValues: {},
      redraftValues: {},
      dynastyValueForPlayer: () => 0,
    });
    expect(result).toBeNull();
  });

  it("returns null when roster is not found", () => {
    const result = getRosterDirectionProfile({
      rosterId: 99,
      rosters: [makeRoster(1)],
      ownedPicks: [],
      players: {},
      pickValues: {},
      redraftValues: {},
      dynastyValueForPlayer: () => 0,
    });
    expect(result).toBeNull();
  });

  it("returns a profile with expected shape for a minimal valid input", () => {
    const rosters = Array.from({ length: 12 }, (_, i) => makeRoster(i + 1, i, 1000 + i * 50));
    const result = getRosterDirectionProfile({
      rosterId: 1,
      rosters,
      ownedPicks: [],
      players: {},
      pickValues: {},
      redraftValues: {},
      dynastyValueForPlayer: () => 0,
    });
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("bucket");
    expect(result).toHaveProperty("dynRank");
    expect(result).toHaveProperty("redRank");
    expect(result).toHaveProperty("n", 12);
    expect(result).toHaveProperty("summary");
    expect(Array.isArray(result?.actions)).toBe(true);
    expect(result?.actions.length).toBeGreaterThan(0);
    expect(Array.isArray(result?.positionRanks)).toBe(true);
  });

  it("ranks the roster with the highest dynasty value at dynRank=1", () => {
    const rosters = Array.from({ length: 4 }, (_, i) => ({
      roster_id: i + 1,
      players: [`player${i + 1}`],
      settings: { wins: 5, losses: 5, fpts: 1000, fpts_max: 1100 },
    }));
    const dynastyValues: Record<string, number> = {
      player1: 100,
      player2: 500, // roster 2 has the best dynasty value
      player3: 200,
      player4: 300,
    };
    const players: Record<string, { position: string; age: number }> = {
      player1: { position: "WR", age: 25 },
      player2: { position: "WR", age: 24 },
      player3: { position: "WR", age: 26 },
      player4: { position: "WR", age: 27 },
    };
    const result = getRosterDirectionProfile({
      rosterId: 2,
      rosters,
      ownedPicks: [],
      players,
      pickValues: {},
      redraftValues: {},
      dynastyValueForPlayer: (id) => dynastyValues[id] ?? 0,
    });
    expect(result?.dynRank).toBe(1);
  });

  it("counts future firsts correctly from ownedPicks", () => {
    const currentYear = String(new Date().getFullYear());
    const nextYear = String(new Date().getFullYear() + 1);
    const rosters = [makeRoster(1), makeRoster(2)];
    const picks = [
      { season: currentYear, round: 1, owner_id: 1, slot: "1.07" },
      { season: nextYear, round: 1, owner_id: 1, slot: "" },
      { season: nextYear, round: 1, owner_id: 1, slot: "" },
    ];
    const result = getRosterDirectionProfile({
      rosterId: 1,
      rosters,
      ownedPicks: picks,
      players: {},
      pickValues: {},
      redraftValues: {},
      dynastyValueForPlayer: () => 0,
    });
    expect(result?.firstRounders).toBe(3);
    expect(result?.futureFirsts).toBe(2);
  });

  it("identifies premium current firsts (picks 1-6)", () => {
    const currentYear = String(new Date().getFullYear());
    const rosters = [makeRoster(1), makeRoster(2)];
    const picks = [
      { season: currentYear, round: 1, owner_id: 1, slot: `${currentYear}.03` },
      { season: currentYear, round: 1, owner_id: 1, slot: `${currentYear}.09` },
    ];
    const result = getRosterDirectionProfile({
      rosterId: 1,
      rosters,
      ownedPicks: picks,
      players: {},
      pickValues: {},
      redraftValues: {},
      dynastyValueForPlayer: () => 0,
    });
    expect(result?.premiumCurrentFirsts).toBe(1);
  });
});
