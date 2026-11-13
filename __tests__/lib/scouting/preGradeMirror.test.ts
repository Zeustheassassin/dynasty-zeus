import { describe, it, expect } from "vitest";
import { changedPreGrades, mirroredPreGrade, preGradeIsMirrored } from "@/lib/scouting/preGradeMirror";
import type { BoardScores } from "@/lib/types";

const NOV_2026 = new Date("2026-11-12T12:00:00Z");
const scores = (dynasty: number | null) => ({ dynasty }) as BoardScores;

describe("mirroredPreGrade", () => {
  it("maps the Dynasty Score while the class is still to be drafted", () => {
    expect(mirroredPreGrade({ draft_class_year: 2027 }, 2.3, NOV_2026)).toBe(95);
    expect(mirroredPreGrade({ draft_class_year: 2028 }, 0, NOV_2026)).toBe(75);
  });

  it("stops at the draft (May 1 of the class year): the stored grade stands", () => {
    expect(mirroredPreGrade({ draft_class_year: 2026 }, 2.3, NOV_2026)).toBeNull();
    expect(mirroredPreGrade({ draft_class_year: 2027 }, 2.3, new Date("2027-04-30T23:59:00Z"))).toBe(95);
    expect(mirroredPreGrade({ draft_class_year: 2027 }, 2.3, new Date("2027-05-01T00:00:00Z"))).toBeNull();
  });

  it("leaves a prospect without a Dynasty Score alone", () => {
    expect(mirroredPreGrade({ draft_class_year: 2027 }, null, NOV_2026)).toBeNull();
    expect(mirroredPreGrade({ draft_class_year: 2027 }, undefined, NOV_2026)).toBeNull();
    expect(mirroredPreGrade({ draft_class_year: 2027 }, NaN, NOV_2026)).toBeNull();
  });
});

describe("preGradeIsMirrored", () => {
  it("reads the Dynasty the Big Board last saved", () => {
    expect(preGradeIsMirrored({ draft_class_year: 2027, board_scores: scores(1.2) }, NOV_2026)).toBe(true);
    expect(preGradeIsMirrored({ draft_class_year: 2027, board_scores: scores(null) }, NOV_2026)).toBe(false);
    expect(preGradeIsMirrored({ draft_class_year: 2027, board_scores: null }, NOV_2026)).toBe(false);
    expect(preGradeIsMirrored({ draft_class_year: 2026, board_scores: scores(1.2) }, NOV_2026)).toBe(false);
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
