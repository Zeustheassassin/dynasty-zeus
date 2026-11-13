import { describe, it, expect } from "vitest";
import {
  parseGrade,
  clampGrade,
  roundGrade,
  formatGrade,
  gradeColor,
  gradeDelta,
  gradeTier,
  gradeTierRange,
  GRADE_MIN,
  GRADE_MAX,
  GRADE_TIERS,
  gradeFromDynasty,
  dynastyGradeCurveText,
} from "@/lib/scouting/prospectGrade";

describe("gradeFromDynasty (the Pre grade's Dynasty curve)", () => {
  it("hits the user's points exactly", () => {
    expect(gradeFromDynasty(2)).toBe(90);
    expect(gradeFromDynasty(2.3)).toBe(95);
    expect(gradeFromDynasty(3)).toBe(100);
    expect(gradeFromDynasty(-2.25)).toBe(50);
    expect(gradeFromDynasty(0)).toBe(75);
  });

  it("runs a straight line between them, to one decimal", () => {
    expect(gradeFromDynasty(1)).toBe(82.5); // halfway 0 → 2
    expect(gradeFromDynasty(2.15)).toBe(92.5); // halfway 2 → 2.3
    expect(gradeFromDynasty(2.65)).toBe(97.5); // halfway 2.3 → 3
    expect(gradeFromDynasty(-1.125)).toBe(62.5); // halfway −2.25 → 0
    expect(gradeFromDynasty(-6.125)).toBe(25); // halfway −10 → −2.25
    expect(gradeFromDynasty(0.5)).toBe(78.8); // 75 + 15 × 0.5 / 2 = 78.75
  });

  it("puts +2.0 up to +2.3 in 90–94.9 and +2.3 up to +3.0 in 95–100", () => {
    expect(gradeFromDynasty(1.99)).toBeLessThan(90);
    expect(gradeFromDynasty(2.29)).toBe(94.8); // 90 + 5 × 0.29 / 0.3 = 94.83
    expect(gradeFromDynasty(2.29)).toBeLessThan(95);
    expect(gradeFromDynasty(2.99)).toBeLessThan(100);
  });

  it("holds the ends past them, with the column's 1.0 floor where the curve says 0", () => {
    expect(gradeFromDynasty(4)).toBe(100);
    expect(gradeFromDynasty(6)).toBe(100);
    expect(gradeFromDynasty(-10)).toBe(GRADE_MIN);
    expect(gradeFromDynasty(-14)).toBe(GRADE_MIN);
    expect(gradeFromDynasty(-9.8)).toBe(1.3); // 50 × 0.2 / 7.75 = 1.29
  });

  it("only goes up", () => {
    let last = -Infinity;
    for (let d = -11; d <= 5; d += 0.05) {
      const g = gradeFromDynasty(d);
      expect(g).toBeGreaterThanOrEqual(last);
      last = g;
    }
  });

  it("reads the curve for tooltips", () => {
    expect(dynastyGradeCurveText()).toBe("−10 → 0 · −2.25 → 50 · 0 → 75 · +2 → 90 · +2.3 → 95 · +3 → 100");
  });
});

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

describe("gradeTier", () => {
  // The user's scale: each cut-off is the tier's lowest grade, and the grade
  // one decimal below it falls in the next tier down.
  const cases: [number, string][] = [
    [100, "Generational"], [95, "Generational"],
    [94.9, "Cornerstone"], [90, "Cornerstone"],
    [89.9, "Star"], [85, "Star"],
    [84.9, "Starter"], [80, "Starter"],
    [79.9, "Rotational"], [75, "Rotational"],
    [74.9, "Depth"], [70, "Depth"],
    [69.9, "Practice Squad"], [65, "Practice Squad"],
    [64.9, "CFL"], [GRADE_MIN, "CFL"],
  ];
  it.each(cases)("%s → %s", (g, label) => {
    expect(gradeTier(g)!.label).toBe(label);
  });

  it("is null for an ungraded prospect", () => {
    expect(gradeTier(null)).toBeNull();
    expect(gradeTier(undefined)).toBeNull();
  });
});

describe("gradeTierRange", () => {
  it("labels each tier's range the way the legend shows it", () => {
    expect(GRADE_TIERS.map(gradeTierRange)).toEqual([
      "95+", "90–94.9", "85–89.9", "80–84.9", "75–79.9", "70–74.9", "65–69.9", "Under 65",
    ]);
  });
});

describe("gradeColor", () => {
  it("colours a grade by its tier", () => {
    expect(gradeColor(95)).toBe("text-fuchsia-400");
    expect(gradeColor(88.6)).toBe("text-amber-400");
    expect(gradeColor(64.9)).toBe("text-red-400");
  });

  it("gives every tier its own colour", () => {
    expect(new Set(GRADE_TIERS.map((t) => t.text)).size).toBe(GRADE_TIERS.length);
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
