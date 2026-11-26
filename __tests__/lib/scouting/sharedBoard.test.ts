import { describe, it, expect } from "vitest";
import type { ProspectWithStats } from "@/lib/types";
import type { SampleSize } from "@/lib/scouting/sampleSize";
import type { ChartedCounts } from "@/lib/scouting/chartedCounts";
import { samplePct } from "@/lib/scouting/sampleTiers";
import {
  buildSharedBoardRows, parseSharedBoardRows, sharedBoardKey, sharedFullSamples,
  type SharedBoardInputs, type SharedBoardRow,
} from "@/lib/scouting/sharedBoard";

// The shared Big Board (/board/{token}, migration 105): one class's All board
// as the owner's Big Board shows it, plus each player's percent of a full
// sample (the user, 2026-11-25: "if ... 150 routes is a full sample and i have
// 100 routes charted i want it to show 66%").

const prospect = (id: string, name: string, position: string, extra: Partial<ProspectWithStats> = {}) =>
  ({
    id, name, position, school: "State", draft_class_year: 2027, height: "6'1\"", weight: 200,
    overall_rank: null, personal_rank: null, pre_draft_grade: null, post_draft_grade: null, total_routes: 0,
    ...extra,
  }) as ProspectWithStats;

const sample = (pos: "QB" | "RB" | "WR" | "TE", n: number | null, full: number, tier: SampleSize["tier"]): SampleSize =>
  ({ key: pos, label: pos, input: "qb", full, n, share: Math.min(1, (n ?? 0) / full), tier }) as SampleSize;

function inputs(extra: Partial<SharedBoardInputs> = {}): SharedBoardInputs {
  return { samples: new Map(), counts: new Map(), preGrades: new Map(), ages: new Map(), ...extra };
}

describe("samplePct", () => {
  it("rounds down and caps at 100: 100 of 150 routes is 66%", () => {
    expect(samplePct(100, 150)).toBe(66);
    expect(samplePct(150, 150)).toBe(100);
    expect(samplePct(210, 160)).toBe(100);
    expect(samplePct(0, 160)).toBe(0);
  });

  it("is exact where floating point isn't (0.29 × 100 = 28.999…)", () => {
    expect(samplePct(29, 100)).toBe(29);
    expect(samplePct(57, 100)).toBe(57);
  });
});

describe("buildSharedBoardRows", () => {
  it("keeps one class, in OVR order, with the unranked after in the order they come", () => {
    const rows = buildSharedBoardRows([
      prospect("a", "Unranked A", "WR"),
      prospect("b", "Second", "RB", { overall_rank: 2 }),
      prospect("c", "Other Class", "WR", { overall_rank: 1, draft_class_year: 2028 }),
      prospect("d", "First", "QB", { overall_rank: 1 }),
      prospect("e", "Unranked B", "TE"),
    ], 2027, inputs());
    expect(rows.map((r) => r.name)).toEqual(["First", "Second", "Unranked A", "Unranked B"]);
  });

  it("carries the board's values: mirrored Pre over the stored one, counts, age in whole years, ranks", () => {
    const p = prospect("w", "Wide", "WR", {
      overall_rank: 3, personal_rank: 1, pre_draft_grade: 70, post_draft_grade: 81.5, height: "", weight: null,
    });
    const [row] = buildSharedBoardRows([p], 2027, inputs({
      preGrades: new Map([["w", 88.4]]),
      counts: new Map<string, ChartedCounts>([["w", { games: 6, snaps: 300, plays: 190 }]]),
      ages: new Map([["w", { years: 20.9, estimated: true }]]),
    }));
    expect(row).toMatchObject({
      ovr: 3, posRank: 1, pre: 88.4, post: 81.5, games: 6, snaps: 300, plays: 190,
      age: 20, ageEst: true, ht: null, wt: null, sample: null,
    });
    // Without a mirror, the stored grade.
    const [plain] = buildSharedBoardRows([p], 2027, inputs());
    expect(plain.pre).toBe(70);
  });

  it("puts each player's percent of a full sample beside the dot", () => {
    const [row] = buildSharedBoardRows([prospect("w", "Wide", "WR")], 2027, inputs({
      samples: new Map([["w", sample("WR", 100, 150, "half")]]),
    }));
    expect(row.sample).toEqual({ n: 100, full: 150, pct: 66, tier: "half" });
  });

  it("under the dot's sample floor reads the exact count, not 0%", () => {
    const rows = buildSharedBoardRows([
      prospect("w", "Wide", "WR", { total_routes: 12 }),
      prospect("r", "Back", "RB"),
      prospect("t", "Tight", "TE"),
    ], 2027, inputs({
      samples: new Map([
        ["w", sample("WR", null, 160, "low")],
        ["r", sample("RB", null, 100, "low")],
        ["t", sample("TE", null, 140, "low")],
      ]),
      samplePlays: new Map([["r", { RB: 9 }]]),
    }));
    expect(rows.map((r) => r.sample)).toEqual([
      { n: 12, full: 160, pct: 7, tier: "low" },
      { n: 9, full: 100, pct: 9, tier: "low" },
      // No count anywhere: nothing charted.
      { n: 0, full: 140, pct: 0, tier: "low" },
    ]);
  });
});

describe("Redacted rows (prospects.share_redacted)", () => {
  // The user: "Can i Mark a player on my big board as Redacted for sharing
  // purposes", then picked "hide who he is".
  it("hide who he is, keep where he sits: the real name never reaches the rows", () => {
    const p = prospect("k", "Keyjuan Brown", "RB", {
      overall_rank: 2, personal_rank: 1, school: "Louisville", height: "5'10\"", weight: 215, share_redacted: true,
    });
    const rows = buildSharedBoardRows([p], 2027, inputs({
      samples: new Map([["k", sample("RB", 110, 100, "full")]]),
      counts: new Map<string, ChartedCounts>([["k", { games: 10, snaps: 316, plays: 110 }]]),
      preGrades: new Map([["k", 94.8]]),
      ages: new Map([["k", { years: 22.4, estimated: false }]]),
    }));
    expect(rows[0]).toEqual({
      redacted: true, ovr: 2, posRank: 1, name: "Redacted", pos: "RB", school: "", age: null, ageEst: false, ht: null, wt: null,
      pre: 94.8, post: null, games: 10, snaps: 316, plays: 110, sample: { n: 110, full: 100, pct: 100, tier: "full" },
    });
    const json = JSON.stringify(rows);
    for (const leak of ["Keyjuan", "Louisville", "215", "5'10"]) expect(json).not.toContain(leak);
  });

  it("a row saved as redacted reads Redacted whatever else it carries", () => {
    const [r] = parseSharedBoardRows([{ redacted: true, name: "Real Name", school: "U", age: 21, ht: "6'0\"", wt: 200, ovr: 4 }]);
    expect(r).toMatchObject({ redacted: true, name: "Redacted", school: "", age: null, ht: null, wt: null, ovr: 4 });
  });
});

describe("sharedBoardKey", () => {
  it("ignores key order (jsonb doesn't keep it) and notices a changed field", () => {
    const row: SharedBoardRow = {
      redacted: false, ovr: 1, posRank: 1, name: "A", pos: "WR", school: "S", age: 21, ageEst: false, ht: "6'0\"", wt: 190,
      pre: 90, post: null, games: 5, snaps: 200, plays: 150, sample: { n: 150, full: 160, pct: 93, tier: "half" },
    };
    // The same row with its keys in reverse order, as jsonb may hand it back.
    const shuffled = Object.fromEntries(Object.entries(row).reverse()) as unknown as SharedBoardRow;
    expect(Object.keys(shuffled)[0]).toBe("sample");
    expect(sharedBoardKey([{ ...row, redacted: true }])).not.toBe(sharedBoardKey([row]));
    expect(sharedBoardKey([shuffled])).toBe(sharedBoardKey([row]));
    expect(sharedBoardKey([{ ...row, ovr: 2 }])).not.toBe(sharedBoardKey([row]));
    expect(sharedBoardKey([{ ...row, sample: { ...row.sample!, pct: 94 } }])).not.toBe(sharedBoardKey([row]));
  });
});

describe("parseSharedBoardRows", () => {
  it("round-trips built rows", () => {
    const rows = buildSharedBoardRows([prospect("w", "Wide", "WR", { overall_rank: 1 })], 2027, inputs({
      samples: new Map([["w", sample("WR", 40, 160, "quarter")]]),
    }));
    const back = parseSharedBoardRows(JSON.parse(JSON.stringify(rows)));
    expect(sharedBoardKey(back)).toBe(sharedBoardKey(rows));
  });

  it("drops rows without a name and blanks bad fields", () => {
    expect(parseSharedBoardRows("nope")).toEqual([]);
    const out = parseSharedBoardRows([
      null,
      { ovr: 1 },
      { name: "Ok", ovr: "1", pos: "RB", wt: Infinity, ageEst: "yes", sample: { n: 5, full: 100, pct: 5, tier: "bogus" } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "Ok", ovr: null, pos: "RB", wt: null, ageEst: false, sample: null });
  });
});

describe("sharedFullSamples", () => {
  it("reads each position's full sample off the rows, the constants otherwise", () => {
    const rows = parseSharedBoardRows([{ name: "A", pos: "RB", sample: { n: 50, full: 125, pct: 40, tier: "quarter" } }]);
    expect(sharedFullSamples(rows)).toEqual({ QB: 180, RB: 125, WR: 160, TE: 140 });
  });
});
