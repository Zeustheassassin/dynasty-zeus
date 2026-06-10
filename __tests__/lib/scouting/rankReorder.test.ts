import { describe, it, expect } from "vitest";
import {
  reorderRanks,
  reorderRanksWithinClass,
  type RankItem,
  type ClassRankItem,
} from "@/lib/scouting/rankReorder";

// Helper: apply the returned diff to a base list and read back the full ranking,
// so assertions can describe the *resulting board* rather than just the diff.
function applied(items: RankItem[], movedId: string, target: number | null) {
  const changes = reorderRanks(items, movedId, target);
  const next = items.map((it) =>
    changes.has(it.id) ? { ...it, rank: changes.get(it.id)! } : it,
  );
  // Return as id->rank for compact assertions.
  const map: Record<string, number | null> = {};
  for (const it of next) map[it.id] = it.rank;
  return { changes, map };
}

const seq = (...ids: string[]): RankItem[] =>
  ids.map((id, i) => ({ id, rank: i + 1 }));

describe("reorderRanks", () => {
  it("moves a player down: 1 -> 4 shifts 2,3,4 up to 1,2,3 (the user's example)", () => {
    const items = seq("A", "B", "C", "D", "E"); // A1 B2 C3 D4 E5
    const { map } = applied(items, "A", 4);
    expect(map).toEqual({ A: 4, B: 1, C: 2, D: 3, E: 5 });
  });

  it("moves a player up: 5 -> 2 shifts 2,3,4 down to 3,4,5", () => {
    const items = seq("A", "B", "C", "D", "E");
    const { map } = applied(items, "E", 2);
    expect(map).toEqual({ A: 1, E: 2, B: 3, C: 4, D: 5 });
  });

  it("only returns the rows that actually changed", () => {
    const items = seq("A", "B", "C", "D", "E");
    const { changes } = applied(items, "A", 4);
    // E keeps rank 5, so it must not be in the diff.
    expect([...changes.keys()].sort()).toEqual(["A", "B", "C", "D"]);
    expect(changes.has("E")).toBe(false);
  });

  it("is a no-op (empty diff) when the rank is unchanged on a clean board", () => {
    const items = seq("A", "B", "C");
    const { changes } = applied(items, "B", 2);
    expect(changes.size).toBe(0);
  });

  it("normalizes duplicate ranks into a contiguous sequence on any edit", () => {
    // Mirrors the real data: two #4s and two #6s, plus a stray gap at 26.
    const items: RankItem[] = [
      { id: "A", rank: 1 },
      { id: "B", rank: 2 },
      { id: "C", rank: 4 }, // dup
      { id: "D", rank: 4 }, // dup
      { id: "E", rank: 6 }, // dup
      { id: "F", rank: 6 }, // dup
      { id: "G", rank: 26 }, // gap
    ];
    // Re-commit A to its own rank (1) — should clean everything else up.
    const { map } = applied(items, "A", 1);
    expect(map).toEqual({ A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7 });
  });

  it("breaks duplicate-rank ties among non-moved rows by original list order", () => {
    // A stays at rank 1; B and C are tied and must keep their original order.
    const items: RankItem[] = [
      { id: "A", rank: 1 },
      { id: "B", rank: 5 }, // dup, listed first
      { id: "C", rank: 5 }, // dup, listed second
    ];
    const { map } = applied(items, "A", 1);
    expect(map).toEqual({ A: 1, B: 2, C: 3 });
  });

  it("moves the edited row to the clamped end even when it was a duplicate", () => {
    // Committing a tied #4 to rank 4 on a 2-deep board clamps it to last (2).
    const items: RankItem[] = [
      { id: "first", rank: 4 },
      { id: "second", rank: 4 },
    ];
    const { map } = applied(items, "first", 4);
    expect(map).toEqual({ first: 2, second: 1 });
  });

  it("clamps a too-high target to the end of the sequence", () => {
    const items = seq("A", "B", "C");
    const { map } = applied(items, "A", 99);
    expect(map).toEqual({ A: 3, B: 1, C: 2 });
  });

  it("clamps a zero/negative target to rank 1", () => {
    const items = seq("A", "B", "C");
    const { map } = applied(items, "C", 0);
    expect(map).toEqual({ A: 2, B: 3, C: 1 });
  });

  it("gives a rank to a previously-unranked prospect and shifts the rest", () => {
    const items: RankItem[] = [
      { id: "A", rank: 1 },
      { id: "B", rank: 2 },
      { id: "X", rank: null },
    ];
    const { map } = applied(items, "X", 2);
    expect(map).toEqual({ A: 1, X: 2, B: 3 });
  });

  it("appends an unranked prospect at the end when target is 1 on an empty board", () => {
    const items: RankItem[] = [
      { id: "A", rank: null },
      { id: "B", rank: null },
    ];
    const { map, changes } = applied(items, "A", 1);
    expect(map).toEqual({ A: 1, B: null });
    expect(changes.size).toBe(1);
  });

  it("unranks a prospect (target null) and compacts the survivors", () => {
    const items = seq("A", "B", "C", "D"); // A1 B2 C3 D4
    const { map } = applied(items, "B", null);
    expect(map).toEqual({ A: 1, B: null, C: 2, D: 3 });
  });

  it("treats a non-finite target as unranking", () => {
    const items = seq("A", "B", "C");
    const { map } = applied(items, "B", Number.NaN);
    expect(map).toEqual({ A: 1, B: null, C: 2 });
  });

  it("rounds a fractional target to the nearest slot", () => {
    const items = seq("A", "B", "C", "D");
    const { map } = applied(items, "D", 2.4); // rounds to 2
    expect(map).toEqual({ A: 1, D: 2, B: 3, C: 4 });
  });

  it("returns an empty diff for an unknown id", () => {
    const items = seq("A", "B");
    const { changes } = applied(items, "ZZZ", 1);
    expect(changes.size).toBe(0);
  });

  it("leaves unrelated unranked prospects untouched", () => {
    const items: RankItem[] = [
      { id: "A", rank: 1 },
      { id: "B", rank: 2 },
      { id: "U", rank: null },
      { id: "V", rank: null },
    ];
    const { map, changes } = applied(items, "A", 2);
    expect(map).toEqual({ A: 2, B: 1, U: null, V: null });
    expect(changes.has("U")).toBe(false);
    expect(changes.has("V")).toBe(false);
  });
});

describe("reorderRanksWithinClass", () => {
  // personal_rank is a ladder per (position, draft class). These items are one
  // position spanning two classes; each class has its own independent 1..N.
  const twoClasses = (): ClassRankItem[] => [
    { id: "a26", draftClass: 2026, rank: 1 },
    { id: "b26", draftClass: 2026, rank: 2 },
    { id: "c26", draftClass: 2026, rank: 3 },
    { id: "a27", draftClass: 2027, rank: 1 },
    { id: "b27", draftClass: 2027, rank: 2 },
  ];

  it("only renumbers the moved prospect's draft class", () => {
    const changes = reorderRanksWithinClass(twoClasses(), "a26", 3); // 2026 ladder only
    // 2026: a->3, b->1, c->2. 2027 untouched.
    expect(Object.fromEntries(changes)).toEqual({ a26: 3, b26: 1, c26: 2 });
    expect(changes.has("a27")).toBe(false);
    expect(changes.has("b27")).toBe(false);
  });

  it("does not collapse two classes that each legitimately have a rank 1", () => {
    // a26 and a27 are both rank 1 — that is VALID (different classes), and a
    // re-commit of a26 to rank 1 must not pull a27 into a shared sequence.
    const changes = reorderRanksWithinClass(twoClasses(), "a26", 1);
    expect(changes.size).toBe(0); // 2026 already contiguous; 2027 never considered
  });

  it("scopes correctly when editing the other class", () => {
    const changes = reorderRanksWithinClass(twoClasses(), "b27", 1); // 2027 ladder
    expect(Object.fromEntries(changes)).toEqual({ b27: 1, a27: 2 });
    expect(changes.has("a26")).toBe(false);
    expect(changes.has("b26")).toBe(false);
    expect(changes.has("c26")).toBe(false);
  });

  it("normalizes duplicates only within the moved prospect's class", () => {
    const items: ClassRankItem[] = [
      { id: "x26", draftClass: 2026, rank: 4 }, // dup within 2026
      { id: "y26", draftClass: 2026, rank: 4 }, // dup within 2026
      { id: "z27", draftClass: 2027, rank: 4 }, // same number, different class — leave alone
    ];
    const changes = reorderRanksWithinClass(items, "x26", 4);
    // 2026 normalizes to 1,2 (x clamped to end of its 2-deep class); 2027 untouched.
    expect(Object.fromEntries(changes)).toEqual({ x26: 2, y26: 1 });
    expect(changes.has("z27")).toBe(false);
  });

  it("returns an empty diff for an unknown id", () => {
    const changes = reorderRanksWithinClass(twoClasses(), "nope", 1);
    expect(changes.size).toBe(0);
  });
});
