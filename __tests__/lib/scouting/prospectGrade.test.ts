import { describe, it, expect } from "vitest";
import {
  parseGrade,
  clampGrade,
  roundGrade,
  formatGrade,
  gradeColor,
  gradeDelta,
  GRADE_MIN,
  GRADE_MAX,
} from "@/lib/scouting/prospectGrade";

describe("parseGrade", () => {
  it("keeps a one-decimal grade exactly as typed (the 88.6 case)", () => {
    expect(parseGrade("88.6")).toBe(88.6);
  });

  it("accepts whole numbers and the range endpoints", () => {
    expect(parseGrade("70")).toBe(70);
    expect(parseGrade(`${GRADE_MIN}`)).toBe(GRADE_MIN);
    expect(parseGrade(`${GRADE_MAX}`)).toBe(GRADE_MAX);
  });

  it("rounds finer precision down to one decimal, matching numeric(4,1)", () => {
    expect(parseGrade("88.64")).toBe(88.6);
    expect(parseGrade("88.65")).toBe(88.7);
    expect(parseGrade("88.99")).toBe(89);
  });

  it("clamps out-of-range input into 1-100 instead of failing the DB CHECK", () => {
    expect(parseGrade("120")).toBe(GRADE_MAX);
    expect(parseGrade("0")).toBe(GRADE_MIN);
    expect(parseGrade("-14.2")).toBe(GRADE_MIN);
  });

  it("treats blank (and whitespace) as 'clear the grade', not as a zero", () => {
    expect(parseGrade("")).toBeNull();
    expect(parseGrade("   ")).toBeNull();
  });

  it("returns undefined for text that isn't a number, so the caller writes nothing", () => {
    expect(parseGrade("abc")).toBeUndefined();
    expect(parseGrade("88.6.1")).toBeUndefined();
    // A half-typed decimal is deliberately 'not a number yet' rather than 88.
    expect(parseGrade("Infinity")).toBeUndefined();
  });

  it("parses a trailing-dot entry as the whole number it already is", () => {
    // "88." is what the box holds mid-keystroke; Number() reads it as 88, which
    // is a legitimate grade, so committing on blur saves 88.0 rather than junk.
    expect(parseGrade("88.")).toBe(88);
  });
});

describe("clampGrade / roundGrade", () => {
  it("clamps to the 1-100 range", () => {
    expect(clampGrade(0.4)).toBe(GRADE_MIN);
    expect(clampGrade(101)).toBe(GRADE_MAX);
    expect(clampGrade(55.5)).toBe(55.5);
  });

  it("rounds half-up at the one-decimal boundary despite float representation", () => {
    expect(roundGrade(88.65)).toBe(88.7);
    expect(roundGrade(1.05)).toBe(1.1);
    expect(roundGrade(2.675)).toBe(2.7);
  });
});

describe("formatGrade", () => {
  it("always shows one decimal so the column reads as a single scale", () => {
    expect(formatGrade(88.6)).toBe("88.6");
    expect(formatGrade(90)).toBe("90.0");
    expect(formatGrade(100)).toBe("100.0");
  });

  it("shows an em dash for ungraded, which is not the same as a low grade", () => {
    expect(formatGrade(null)).toBe("—");
    expect(formatGrade(undefined)).toBe("—");
  });
});

describe("gradeColor", () => {
  it("separates the tiers at 90 / 80 / 70", () => {
    expect(gradeColor(90)).toBe("text-emerald-400");
    expect(gradeColor(89.9)).toBe("text-sky-400");
    expect(gradeColor(80)).toBe("text-sky-400");
    expect(gradeColor(79.9)).toBe("text-slate-200");
    expect(gradeColor(70)).toBe("text-slate-200");
    expect(gradeColor(69.9)).toBe("text-slate-500");
  });

  it("dims ungraded rows", () => {
    expect(gradeColor(null)).toBe("text-slate-600");
  });
});

describe("gradeDelta", () => {
  it("reports how far the landing spot moved a prospect", () => {
    expect(gradeDelta(88.6, 91.2)).toBe(2.6);
    expect(gradeDelta(88.6, 84.1)).toBe(-4.5);
    expect(gradeDelta(88.6, 88.6)).toBe(0);
  });

  it("stays null until both grades exist", () => {
    expect(gradeDelta(88.6, null)).toBeNull();
    expect(gradeDelta(null, 91.2)).toBeNull();
    expect(gradeDelta(null, null)).toBeNull();
  });

  it("does not accumulate float error (91.2 - 88.6 is not 2.5999999)", () => {
    expect(gradeDelta(88.6, 91.2)).toBe(2.6);
    expect(gradeDelta(70.1, 70.3)).toBe(0.2);
  });
});
