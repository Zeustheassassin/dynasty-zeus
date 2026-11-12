import { describe, it, expect } from "vitest";
import { realignRanks, type RankUpdate } from "@/lib/scouting/realignRanks";

type P = { id: string; name: string; position: string; draft_class_year: number; overall_rank: number | null; personal_rank: number | null };
const p = (id: string, position: string, ovr: number | null, pos: number | null, year = 2027): P =>
  ({ id, name: id.toUpperCase(), position, draft_class_year: year, overall_rank: ovr, personal_rank: pos });

const BOARD: P[] = [
  p("w1", "WR", 1, 1),
  p("q1", "QB", 2, 1),
  p("w2", "WR", 3, 2),
  p("r1", "RB", 4, 1),
  p("w3", "WR", 5, 3), // no score: follows
  p("w4", "WR", null, null), // scored, unranked: joins
  p("t1", "TE", null, null), // no score, unranked: stays unranked
  p("x1", "WR", 1, 1, 2028), // another class
];
const SCORES: Record<string, number> = { w1: 0.5, q1: 1.8, w2: 2.1, r1: -0.3, w4: 1.0, x1: 3 };
const score = (id: string) => SCORES[id];

const after = (b: P[], updates: Map<string, RankUpdate>) => b.map((x) => ({ ...x, ...updates.get(x.id) }));

describe("realignRanks on the All tab (OVR and every position's rank)", () => {
  const plan = realignRanks(BOARD, score, { classes: [2027], position: null });
  const board = after(BOARD, plan.updates);
  const ovr = (id: string) => board.find((x) => x.id === id)!.overall_rank;
  const pos = (id: string) => board.find((x) => x.id === id)!.personal_rank;

  it("puts the scored first, best first, then the ranked without a score in their order", () => {
    expect(["w2", "q1", "w4", "w1", "r1", "w3"].map(ovr)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ovr("t1")).toBeNull();
  });

  it("ranks each position the same way", () => {
    expect(["w2", "w4", "w1", "w3"].map(pos)).toEqual([1, 2, 3, 4]);
    expect(pos("q1")).toBe(1);
    expect(pos("r1")).toBe(1);
    expect(pos("t1")).toBeNull();
  });

  it("touches only the class asked for", () => {
    expect(plan.updates.has("x1")).toBe(false);
    expect(board.find((x) => x.id === "x1")!.overall_rank).toBe(1);
  });

  it("writes only what changes, and keeps the old values for Undo", () => {
    // q1 stays OVR 2 and QB 1: nothing to write.
    expect(plan.updates.has("q1")).toBe(false);
    expect(plan.updates.get("w2")).toEqual({ overall_rank: 1, personal_rank: 1 });
    expect(plan.before.get("w2")).toEqual({ overall_rank: 3, personal_rank: 2 });
    expect(plan.updates.get("w1")).toEqual({ overall_rank: 4, personal_rank: 3 });
    expect(plan.before.get("w4")).toEqual({ overall_rank: null, personal_rank: null });
    expect(after(board, plan.before)).toEqual(BOARD);
  });

  it("counts who went first and who followed", () => {
    expect(plan.scored).toBe(5);
    expect(plan.unscoredRanked).toBe(1);
  });

  it("has nothing to do the second time", () => {
    expect(realignRanks(board, score, { classes: [2027], position: null }).updates.size).toBe(0);
  });
});

describe("realignRanks on a position tab (that position's rank only)", () => {
  it("leaves OVR and the other positions alone", () => {
    const plan = realignRanks(BOARD, score, { classes: [2027], position: "WR" });
    for (const u of plan.updates.values()) expect(Object.keys(u)).toEqual(["personal_rank"]);
    expect([...plan.updates.keys()].sort()).toEqual(["w1", "w2", "w3", "w4"]);
    const board = after(BOARD, plan.updates);
    expect(["w2", "w4", "w1", "w3"].map((id) => board.find((x) => x.id === id)!.personal_rank)).toEqual([1, 2, 3, 4]);
  });
});

describe("realignRanks across classes", () => {
  it("ranks each class on its own", () => {
    const plan = realignRanks(BOARD, score, { classes: [2027, 2028], position: null });
    const board = after(BOARD, plan.updates);
    expect(board.find((x) => x.id === "x1")!.overall_rank).toBe(1);
    expect(board.find((x) => x.id === "w2")!.overall_rank).toBe(1);
  });

  it("breaks a tie by the current rank", () => {
    const tie = [p("a", "WR", 2, 2), p("b", "WR", 1, 1)];
    expect(realignRanks(tie, () => 1, { classes: [2027], position: null }).updates.size).toBe(0);
  });
});
