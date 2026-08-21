import { describe, it, expect } from "vitest";
import { injuryBadge } from "@/components/DataHub/dataHubHelpers";

// injuryBadge returns a React element (or null) — a plain object we can
// inspect via .props without needing to render/jsdom.
function badgeText(status: string | null | undefined): string | null {
  const el = injuryBadge(status);
  if (!el) return null;
  return (el.props as { children: string }).children;
}
function badgeClass(status: string | null | undefined): string | null {
  const el = injuryBadge(status);
  if (!el) return null;
  return (el.props as { className: string }).className;
}

describe("injuryBadge — healthy statuses show no badge", () => {
  it.each([null, undefined, "", "Active", "active", "Probable", "PROBABLE"])(
    "returns null for %s",
    (status) => {
      expect(injuryBadge(status)).toBeNull();
    }
  );
});

describe("injuryBadge — known short codes", () => {
  it("Q -> amber Questionable badge", () => {
    expect(badgeText("Q")).toBe("Q");
    expect(badgeClass("Q")).toContain("amber");
  });
  it("D -> orange Doubtful badge", () => {
    expect(badgeText("D")).toBe("D");
    expect(badgeClass("D")).toContain("orange");
  });
  it("O -> red Out badge", () => {
    expect(badgeText("O")).toBe("O");
    expect(badgeClass("O")).toContain("red");
  });
  it("IR -> red badge", () => {
    expect(badgeText("IR")).toBe("IR");
    expect(badgeClass("IR")).toContain("red");
  });
});

describe("injuryBadge — full-word spellings match the same tier as their short code", () => {
  it("Questionable matches Q's tier", () => {
    expect(badgeClass("Questionable")).toBe(badgeClass("Q"));
  });
  it("Doubtful matches D's tier", () => {
    expect(badgeClass("Doubtful")).toBe(badgeClass("D"));
  });
  it("Out matches O's tier", () => {
    expect(badgeClass("Out")).toBe(badgeClass("O"));
  });
});

describe("injuryBadge — regression: codes beyond the old IR/O/D/Q allowlist now badge instead of silently reading healthy", () => {
  it.each(["PUP", "Sus", "NA", "DNR", "Cov", "NFI", "IR-Designated"])(
    "%s gets a badge, not null",
    (status) => {
      expect(injuryBadge(status)).not.toBeNull();
      // Unrecognized/exotic codes fall into the most-severe (red) catch-all tier.
      expect(badgeClass(status)).toContain("red");
    }
  );
});
