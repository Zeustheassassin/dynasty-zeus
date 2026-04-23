import { describe, it, expect } from "vitest";
import {
  getRosterDirectionProfile,
  getProfilePosBuckets,
  getTradePartnerFit,
  getTradePartnerFitLabel,
} from "@/lib/helpers/direction/roster";
import type { RosterDirectionProfile } from "@/lib/types";
import type { StrategicBucket } from "@/lib/types";

// ── helpers ─────────────────────────────────────────────────────────

const makeRoster = (id: number, wins = 5, fpts = 1200) => ({
  roster_id: id,
  players: [] as string[],
  settings: { wins, losses: 10 - wins, fpts, fpts_max: fpts * 1.1 },
});

const makeProfile = (
  bucket: StrategicBucket,
  positionRanks: Array<{ pos: string; total: number; rank: number }>,
  n = 12,
  extras: Partial<RosterDirectionProfile> = {}
): RosterDirectionProfile => ({
  bucket,
  bucketColor: "",
  dynRank: 1,
  redRank: 1,
  standRank: 1,
  maxPfRank: 1,
  n,
  summary: "",
  actions: [],
  shortAction: "",
  strengths: [],
  concerns: [],
  positionRanks,
  coreAge: 26,
  youngCoreCount: 0,
  oldCoreCount: 0,
  pickTotal: 0,
  firstRounders: 0,
  premiumCurrentFirsts: 0,
  futureFirsts: 0,
  ...extras,
});

// ── getTradePartnerFitLabel ──────────────────────────────────────────

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

// ── getRosterDirectionProfile ────────────────────────────────────────

describe("getRosterDirectionProfile", () => {
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
      player2: 500,
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

// ── getProfilePosBuckets ─────────────────────────────────────────────

describe("getProfilePosBuckets", () => {
  // n=12: strongThreshold = max(2, ceil(12/3)) = 4; weakThreshold = max(5, 12-2) = 10

  it("returns empty arrays for null profile", () => {
    const result = getProfilePosBuckets(null);
    expect(result.strong).toEqual([]);
    expect(result.weak).toEqual([]);
  });

  it("returns empty arrays for undefined profile", () => {
    const result = getProfilePosBuckets(undefined);
    expect(result.strong).toEqual([]);
    expect(result.weak).toEqual([]);
  });

  it("identifies a strong position (rank <= strongThreshold)", () => {
    const profile = makeProfile("Elite", [
      { pos: "QB", total: 5000, rank: 1 },
      { pos: "WR", total: 3000, rank: 7 },
    ]);
    const { strong } = getProfilePosBuckets(profile);
    expect(strong).toContain("QB");
    expect(strong).not.toContain("WR");
  });

  it("identifies a weak position (rank >= weakThreshold)", () => {
    const profile = makeProfile("Rebuilder", [
      { pos: "RB", total: 500, rank: 11 },
      { pos: "WR", total: 3000, rank: 5 },
    ]);
    const { weak } = getProfilePosBuckets(profile);
    expect(weak).toContain("RB");
    expect(weak).not.toContain("WR");
  });

  it("middle-ranked positions appear in neither strong nor weak", () => {
    const profile = makeProfile("Purgatory", [
      { pos: "TE", total: 1500, rank: 6 },
    ]);
    const { strong, weak } = getProfilePosBuckets(profile);
    expect(strong).not.toContain("TE");
    expect(weak).not.toContain("TE");
  });

  it("scales thresholds correctly for an 8-team league", () => {
    // n=8: strongThreshold = max(2, ceil(8/3)) = 3; weakThreshold = max(4, 6) = 6
    const profile = makeProfile(
      "Fading Out",
      [
        { pos: "QB", total: 4000, rank: 2 },
        { pos: "RB", total: 200,  rank: 7 },
        { pos: "WR", total: 2000, rank: 4 },
      ],
      8
    );
    const { strong, weak } = getProfilePosBuckets(profile);
    expect(strong).toContain("QB");
    expect(strong).not.toContain("WR"); // rank=4 > strongThreshold=3 for n=8
    expect(weak).toContain("RB");
  });
});

// ── getTradePartnerFit ───────────────────────────────────────────────

describe("getTradePartnerFit", () => {
  it("returns zero fit when either profile is null", () => {
    const result = getTradePartnerFit({ myProfile: null, oppProfile: null, tradeCount30d: 0 });
    expect(result.fitScore).toBe(0);
    expect(result.fitLabel).toBe("Neutral Fit");
    expect(result.fitReasons).toEqual([]);
  });

  it("returns zero fit when myProfile is missing", () => {
    const opp = makeProfile("Rebuilder", [{ pos: "WR", total: 3000, rank: 1 }]);
    const result = getTradePartnerFit({ myProfile: null, oppProfile: opp, tradeCount30d: 0 });
    expect(result.fitScore).toBe(0);
  });

  it("adds fitScore when opp is strong where I am weak (overlapToBuy)", () => {
    // n=12: strongThreshold=4, weakThreshold=10
    const myProfile  = makeProfile("Almost There", [{ pos: "QB", total: 500,  rank: 11 }]);
    const oppProfile = makeProfile("Rebuilder",    [{ pos: "QB", total: 5000, rank: 2  }]);
    const result = getTradePartnerFit({ myProfile, oppProfile, tradeCount30d: 0 });
    // overlapToBuy = ["QB"] → +12
    expect(result.fitScore).toBeGreaterThanOrEqual(12);
    expect(result.fitReasons.some((r) => r.includes("QB"))).toBe(true);
  });

  it("adds fitScore when I am strong where opp is weak (overlapToSell)", () => {
    const myProfile  = makeProfile("Elite",     [{ pos: "WR", total: 5000, rank: 1  }]);
    const oppProfile = makeProfile("Rebuilder", [{ pos: "WR", total: 500,  rank: 11 }]);
    const result = getTradePartnerFit({ myProfile, oppProfile, tradeCount30d: 0 });
    // overlapToSell = ["WR"] → +10
    expect(result.fitScore).toBeGreaterThanOrEqual(10);
  });

  it("adds timeline bonus when one is a buyer and the other is a seller", () => {
    const myProfile  = makeProfile("Rebuilder",      [{ pos: "WR", total: 500,  rank: 8 }]);
    const oppProfile = makeProfile("True Contender", [{ pos: "WR", total: 3000, rank: 6 }]);
    const result = getTradePartnerFit({ myProfile, oppProfile, tradeCount30d: 0 });
    // iAmSelling + oppBuying → +14
    expect(result.fitScore).toBeGreaterThanOrEqual(14);
    expect(result.fitReasons.some((r) => r.includes("timelines"))).toBe(true);
  });

  it("subtracts when both are buyers", () => {
    const myProfile  = makeProfile("Elite",          [{ pos: "QB", total: 4000, rank: 5 }]);
    const oppProfile = makeProfile("True Contender", [{ pos: "WR", total: 3000, rank: 5 }]);
    const result = getTradePartnerFit({ myProfile, oppProfile, tradeCount30d: 0 });
    // both buying → -5; no position overlap → total = -5
    expect(result.fitScore).toBe(-5);
  });

  it("adds draft capital bonus when opp has enough future firsts", () => {
    const myProfile  = makeProfile("Elite",     [{ pos: "WR", total: 3000, rank: 5 }]);
    const oppProfile = makeProfile("Rebuilder", [{ pos: "WR", total: 500,  rank: 5 }], 12, { futureFirsts: 2 });
    const result = getTradePartnerFit({ myProfile, oppProfile, tradeCount30d: 0 });
    // iAmBuying + oppSelling → +14; draft capital → +5
    expect(result.fitScore).toBeGreaterThanOrEqual(19);
    expect(result.fitReasons.some((r) => r.includes("draft"))).toBe(true);
  });

  it("adds active trader bonus for tradeCount30d >= 2", () => {
    const myProfile  = makeProfile("Purgatory", [{ pos: "QB", total: 2000, rank: 5 }]);
    const oppProfile = makeProfile("Purgatory", [{ pos: "QB", total: 2000, rank: 5 }]);
    const baseline = getTradePartnerFit({ myProfile, oppProfile, tradeCount30d: 0 });
    const active   = getTradePartnerFit({ myProfile, oppProfile, tradeCount30d: 3 });
    // tradeCount=3 → min(3,3)*3 = +9 vs tradeCount=0 → +0
    expect(active.fitScore).toBeGreaterThan(baseline.fitScore);
    expect(active.fitReasons.some((r) => r.includes("active") || r.includes("market"))).toBe(true);
  });

  it("returns fitLabel consistent with fitScore thresholds", () => {
    const myProfile  = makeProfile("Elite",     [{ pos: "RB", total: 5000, rank: 1 }, { pos: "WR", total: 4000, rank: 2 }]);
    const oppProfile = makeProfile("Rebuilder", [{ pos: "RB", total: 500,  rank: 11 }, { pos: "WR", total: 300, rank: 12 }], 12, { futureFirsts: 3 });
    const result = getTradePartnerFit({ myProfile, oppProfile, tradeCount30d: 3 });
    expect(["Best Trade Partner", "Strong Fit", "Solid Fit"].some((l) => l === result.fitLabel)).toBe(true);
    expect(result.fitScore).toBeGreaterThan(0);
  });
});
