import { describe, it, expect } from "vitest";
import { deriveChartingDecision } from "@/components/scouting/shared/chartingConstants";

describe("deriveChartingDecision", () => {
  it("Undecided with a charted game becomes Partial Chart", () => {
    expect(deriveChartingDecision("pending", 1, "WR", 30)).toBe("partial_chart");
    expect(deriveChartingDecision("pending", 2, "QB", undefined, 40)).toBe("partial_chart");
    expect(deriveChartingDecision("pending", 1, "RB")).toBe("partial_chart");
  });

  it("Undecided past the threshold becomes Fully Charted", () => {
    expect(deriveChartingDecision("pending", 5, "WR", 150)).toBe("fully_charted");
    expect(deriveChartingDecision("pending", 6, "RB")).toBe("fully_charted");
  });

  it("Undecided with no charted games stays Undecided", () => {
    expect(deriveChartingDecision("pending", 0, "WR", 0)).toBe("pending");
  });

  it("Charting moves along the same chain", () => {
    expect(deriveChartingDecision("charting", 0, "TE", 0)).toBe("charting");
    expect(deriveChartingDecision("charting", 1, "TE", 40)).toBe("partial_chart");
    expect(deriveChartingDecision("charting", 4, "TE", 120)).toBe("fully_charted");
  });

  it("Not Charting is left alone and nothing is demoted", () => {
    expect(deriveChartingDecision("not_charting", 3, "WR", 200)).toBe("not_charting");
    expect(deriveChartingDecision("fully_charted", 1, "WR", 20)).toBe("fully_charted");
    expect(deriveChartingDecision("partial_chart", 1, "QB", undefined, 10)).toBe("partial_chart");
  });
});
