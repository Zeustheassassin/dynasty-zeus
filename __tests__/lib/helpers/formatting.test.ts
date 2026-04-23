import { describe, it, expect } from "vitest";
import { formatRelativeDate, normalizeRookieName } from "@/lib/helpers/formatting";

const daysAgo = (n: number) => Date.now() - n * 86400000;

// ── formatRelativeDate ───────────────────────────────────────────────

describe("formatRelativeDate", () => {
  it("returns 'Today' for a timestamp from earlier today", () => {
    expect(formatRelativeDate(daysAgo(0))).toBe("Today");
  });

  it("returns 'Yesterday' for exactly 1 day ago", () => {
    expect(formatRelativeDate(daysAgo(1))).toBe("Yesterday");
  });

  it("returns 'N days ago' for 2–6 days ago", () => {
    expect(formatRelativeDate(daysAgo(2))).toBe("2 days ago");
    expect(formatRelativeDate(daysAgo(5))).toBe("5 days ago");
    expect(formatRelativeDate(daysAgo(6))).toBe("6 days ago");
  });

  it("returns '1 week ago' for 7–13 days ago", () => {
    expect(formatRelativeDate(daysAgo(7))).toBe("1 week ago");
    expect(formatRelativeDate(daysAgo(13))).toBe("1 week ago");
  });

  it("returns '2 weeks ago' for 14–20 days ago", () => {
    expect(formatRelativeDate(daysAgo(14))).toBe("2 weeks ago");
    expect(formatRelativeDate(daysAgo(20))).toBe("2 weeks ago");
  });

  it("returns '3 weeks ago' for 21–29 days ago", () => {
    expect(formatRelativeDate(daysAgo(21))).toBe("3 weeks ago");
    expect(formatRelativeDate(daysAgo(29))).toBe("3 weeks ago");
  });

  it("returns '1 month ago' for 30+ days ago", () => {
    expect(formatRelativeDate(daysAgo(30))).toBe("1 month ago");
    expect(formatRelativeDate(daysAgo(90))).toBe("1 month ago");
  });
});

// ── normalizeRookieName ──────────────────────────────────────────────

describe("normalizeRookieName", () => {
  it("lowercases and strips non-alpha characters", () => {
    expect(normalizeRookieName("Ja'Marr Chase")).toBe("jamarrchase");
  });

  it("strips Jr. suffix", () => {
    expect(normalizeRookieName("Josh Allen Jr.")).toBe("joshallen");
  });

  it("strips Sr suffix", () => {
    expect(normalizeRookieName("Calvin Ridley Sr")).toBe("calvinridley");
  });

  it("strips II suffix", () => {
    expect(normalizeRookieName("Patrick Mahomes II")).toBe("patrickmahomes");
  });

  it("strips III suffix", () => {
    expect(normalizeRookieName("Calvin Ridley III")).toBe("calvinridley");
  });

  it("strips IV suffix", () => {
    expect(normalizeRookieName("Henry Williams IV")).toBe("henrywilliams");
  });

  it("strips hyphen from hyphenated names", () => {
    expect(normalizeRookieName("DeAndre Hopkins")).toBe("deandrehopkins");
  });

  it("returns empty string for an empty input", () => {
    expect(normalizeRookieName("")).toBe("");
  });

  it("handles a name with numbers and punctuation", () => {
    expect(normalizeRookieName("D.K. Metcalf")).toBe("dkmetcalf");
  });
});
