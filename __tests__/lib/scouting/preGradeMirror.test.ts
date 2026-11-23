import { describe, it, expect } from "vitest";
import { changedPreGrades, mirroredPreGrade, preGradeIsMirrored } from "@/lib/scouting/preGradeMirror";
import type { BoardScores } from "@/lib/types";

const scores = (dynasty: number | null) => ({ dynasty }) as BoardScores;

describe("mirroredPreGrade", () => {
  it("maps the Dynasty Score on the curve", () => {
    expect(mirroredPreGrade(2.25)).toBe(95);
    expect(mirroredPreGrade(0)).toBe(75);
  });

  it("leaves a prospect without a Dynasty Score alone", () => {
    expect(mirroredPreGrade(null)).toBeNull();
    expect(mirroredPreGrade(undefined)).toBeNull();
    expect(mirroredPreGrade(NaN)).toBeNull();
  });
});

describe("preGradeIsMirrored", () => {
  it("reads the Dynasty the Big Board last saved, in any class (drafted ones too, 2026-11-22)", () => {
    expect(preGradeIsMirrored({ board_scores: scores(1.2) })).toBe(true);
    expect(preGradeIsMirrored({ board_scores: scores(null) })).toBe(false);
    expect(preGradeIsMirrored({ board_scores: null })).toBe(false);
  });
});

describe("changedPreGrades", () => {
  const rows = [
    { id: "a", pre_draft_grade: 80 },
    { id: "b", pre_draft_grade: 70 },
    { id: "c", pre_draft_grade: null },
    { id: "d", pre_draft_grade: 64 },
  ];

  it("writes the mirrored grades that differ from the stored ones, nothing else", () => {
    const mirrored = new Map([["a", 80], ["b", 71.5], ["c", 90]]);
    expect([...changedPreGrades(rows, mirrored, new Map())]).toEqual([["b", 71.5], ["c", 90]]);
  });

  it("doesn't send a grade this visit already tried until it changes", () => {
    const mirrored = new Map([["b", 71.5], ["c", 90]]);
    expect([...changedPreGrades(rows, mirrored, new Map([["b", 71.5], ["c", 88]]))]).toEqual([["c", 90]]);
  });

  it("compares a stored grade that came back as text by value", () => {
    const stored = [{ id: "a", pre_draft_grade: "80.0" as unknown as number }];
    expect(changedPreGrades(stored, new Map([["a", 80]]), new Map()).size).toBe(0);
  });
});
