import { describe, it, expect } from "vitest";
import { isValidSleeperId, parseIntParam, SLEEPER_ID_RE } from "@/lib/apiHelpers";

// ── SLEEPER_ID_RE ───────────────────────────────────────────────────

describe("SLEEPER_ID_RE", () => {
  it("accepts numeric strings of 1–20 digits", () => {
    expect(SLEEPER_ID_RE.test("1")).toBe(true);
    expect(SLEEPER_ID_RE.test("123456789012345678")).toBe(true);   // 18 digits
    expect(SLEEPER_ID_RE.test("1234567890123456789")).toBe(true);  // 19 digits (common recent ID)
    expect(SLEEPER_ID_RE.test("12345678901234567890")).toBe(true); // 20 digits (max u64)
    expect(SLEEPER_ID_RE.test("00123")).toBe(true); // leading zeros are fine
  });

  it("rejects strings with non-numeric characters", () => {
    expect(SLEEPER_ID_RE.test("abc")).toBe(false);
    expect(SLEEPER_ID_RE.test("123abc")).toBe(false);
    expect(SLEEPER_ID_RE.test("12.3")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(SLEEPER_ID_RE.test("")).toBe(false);
  });

  it("rejects strings longer than 20 digits", () => {
    expect(SLEEPER_ID_RE.test("123456789012345678901")).toBe(false); // 21 digits
  });
});

// ── isValidSleeperId ────────────────────────────────────────────────

describe("isValidSleeperId", () => {
  it("returns true for a valid numeric ID string", () => {
    expect(isValidSleeperId("985345987234512345")).toBe(true);
    expect(isValidSleeperId("1")).toBe(true);
  });

  it("returns false for null", () => {
    expect(isValidSleeperId(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isValidSleeperId(undefined)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isValidSleeperId("")).toBe(false);
  });

  it("returns false for a string containing letters", () => {
    expect(isValidSleeperId("abc123")).toBe(false);
  });

  it("returns false for a 21-digit string (overflow protection)", () => {
    expect(isValidSleeperId("123456789012345678901")).toBe(false);
  });

  it("acts as a type predicate (narrows to string)", () => {
    const id: string | null = "123456";
    if (isValidSleeperId(id)) {
      // TypeScript should narrow id to string here — just verify it works at runtime
      expect(id.toUpperCase()).toBe("123456");
    } else {
      throw new Error("Expected id to be valid");
    }
  });
});

// ── parseIntParam ───────────────────────────────────────────────────

describe("parseIntParam", () => {
  it("returns null for null input", () => {
    expect(parseIntParam(null, 1, 100)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseIntParam(undefined, 1, 100)).toBeNull();
  });

  it("parses a valid integer string within range", () => {
    expect(parseIntParam("50", 1, 100)).toBe(50);
  });

  it("parses the minimum boundary value", () => {
    expect(parseIntParam("1", 1, 100)).toBe(1);
  });

  it("parses the maximum boundary value", () => {
    expect(parseIntParam("100", 1, 100)).toBe(100);
  });

  it("returns null when below minimum", () => {
    expect(parseIntParam("0", 1, 100)).toBeNull();
  });

  it("returns null when above maximum", () => {
    expect(parseIntParam("101", 1, 100)).toBeNull();
  });

  it("returns null for a non-numeric string", () => {
    expect(parseIntParam("abc", 1, 100)).toBeNull();
  });

  it("truncates a float string (parseInt behavior) and returns the integer part if in range", () => {
    // parseInt("3.7") === 3, which is within [1, 100], so we get 3
    expect(parseIntParam("3.7", 1, 100)).toBe(3);
  });

  it("handles negative ranges correctly", () => {
    expect(parseIntParam("-5", -10, -1)).toBe(-5);
    expect(parseIntParam("0", -10, -1)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseIntParam("", 1, 100)).toBeNull();
  });
});
