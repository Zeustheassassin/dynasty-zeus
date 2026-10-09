import { describe, it, expect } from "vitest";
import type { BoardScores, ProspectWithStats } from "../../../lib/types";
import { boardScoresKey, buildBoardScores, changedBoardScores } from "../../../lib/scouting/boardScores";
import { DEFAULT_DYNASTY_WEIGHTS, type DynastyBreakdown } from "../../../lib/scouting/dynastyScore";
import { SAMPLE_FULL, type SampleSize } from "../../../lib/scouting/sampleSize";

const prospect = (id: string, position: string, board_scores: BoardScores | null = null) =>
  ({ id, name: id, position, board_scores }) as ProspectWithStats;

const dyn = (dynasty: number, plus: number | null): DynastyBreakdown =>
  ({ aeScore: dynasty, rookieAge: null, window: null, flags: [], dynasty, draftCapital: null, plus });

const sample = (pos: "QB" | "WR", n: number | null, share: number, tier: SampleSize["tier"]): SampleSize =>
  ({ ...SAMPLE_FULL[pos], n, share, tier });

describe("buildBoardScores", () => {
  const prospects = [prospect("q", "QB"), prospect("w", "WR"), prospect("k", "K")];
  const samples = new Map([["q", sample("QB", 120, 120 / 180, "half")], ["w", sample("WR", null, 0, "low")]]);

  it("saves Dynasty, Dynasty+, the sample dot and the weights, rounded", () => {
    const m = buildBoardScores(prospects, new Map([["q", dyn(1.23456, 3.98765)]]), samples, DEFAULT_DYNASTY_WEIGHTS);
    expect(m.get("q")).toEqual({
      dynasty: 1.235, plus: 3.988,
      sample: { n: 120, share: 0.667, tier: "half" },
      weights: { age: 1, size: 1, draft: 2 },
    });
  });

  it("keeps a prospect without an AE Score (null Dynasty) and skips one without a sample dot", () => {
    const m = buildBoardScores(prospects, new Map(), samples, DEFAULT_DYNASTY_WEIGHTS);
    expect(m.get("w")).toMatchObject({ dynasty: null, plus: null, sample: { n: null, share: 0, tier: "low" } });
    expect(m.has("k")).toBe(false);
  });

  it("leaves Dynasty+ null before a round is set", () => {
    const m = buildBoardScores(prospects, new Map([["q", dyn(0.5, null)]]), samples, DEFAULT_DYNASTY_WEIGHTS);
    expect(m.get("q")).toMatchObject({ dynasty: 0.5, plus: null });
  });
});

describe("boardScoresKey", () => {
  const saved: BoardScores = {
    dynasty: 1.2, plus: null, sample: { n: 50, share: 0.278, tier: "quarter" },
    weights: { age: 1, size: 1, draft: 2 }, saved_at: "2026-10-09T00:00:00.000Z",
  };

  it("ignores saved_at and key order (jsonb reorders keys)", () => {
    const reordered = JSON.parse('{"weights":{"draft":2,"size":1,"age":1},"sample":{"tier":"quarter","share":0.278,"n":50},"plus":null,"dynasty":1.2,"saved_at":"2027-01-01"}');
    expect(boardScoresKey(reordered)).toBe(boardScoresKey(saved));
  });

  it("changes with any saved number, and is null for nothing saved", () => {
    expect(boardScoresKey({ ...saved, dynasty: 1.21 })).not.toBe(boardScoresKey(saved));
    expect(boardScoresKey({ ...saved, weights: { age: 1, size: 1, draft: 2.25 } })).not.toBe(boardScoresKey(saved));
    expect(boardScoresKey(null)).toBeNull();
  });
});

describe("changedBoardScores", () => {
  const value = { dynasty: 0.8, plus: null, sample: { n: 90, share: 0.5, tier: "half" as const }, weights: { age: 1, size: 1, draft: 2 } };
  const next = new Map([["a", value], ["b", value], ["c", value]]);

  it("writes only rows whose scores differ from what's saved", () => {
    const prospects = [
      prospect("a", "WR", { ...value, saved_at: "2026-10-01T00:00:00.000Z" }), // unchanged
      prospect("b", "WR", { ...value, dynasty: 0.7, saved_at: "2026-10-01T00:00:00.000Z" }), // changed
      prospect("c", "WR"), // never saved
    ];
    expect([...changedBoardScores(prospects, next, new Map()).keys()]).toEqual(["b", "c"]);
  });

  it("goes by what this visit already wrote over the loaded row", () => {
    const prospects = [prospect("a", "WR"), prospect("b", "WR"), prospect("c", "WR")];
    const saved = new Map([["a", boardScoresKey(value)], ["b", boardScoresKey(value)], ["c", "older"]]);
    expect([...changedBoardScores(prospects, next, saved).keys()]).toEqual(["c"]);
  });
});
