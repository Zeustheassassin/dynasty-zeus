import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveChartingDecision, FULLY_CHARTED_HINT } from "@/components/scouting/shared/chartingConstants";
import { SAMPLE_FULL_PLAYS } from "@/lib/scouting/sampleTiers";
import { SAMPLE_FULL } from "@/lib/scouting/sampleSize";

describe("deriveChartingDecision", () => {
  it("Undecided with a charted game becomes Partial Chart", () => {
    expect(deriveChartingDecision("pending", 1, "WR", 30)).toBe("partial_chart");
    expect(deriveChartingDecision("pending", 2, "QB", 40)).toBe("partial_chart");
    expect(deriveChartingDecision("pending", 1, "RB")).toBe("partial_chart");
  });

  // The user, 2026-11-19: "Use the Big Boards Full Sample Metric to determine if
  // its a full sample for the prospect board" (Marcellous Hawkins read Fully
  // Charted on 11 games while the Big Board had him at 80%).
  it("is Fully Charted exactly at the Big Board's full sample: QB 180, RB 100, WR 160, TE 140", () => {
    expect(SAMPLE_FULL_PLAYS).toEqual({ QB: 180, RB: 100, WR: 160, TE: 140 });
    for (const pos of ["QB", "RB", "WR", "TE"] as const) {
      const full = SAMPLE_FULL_PLAYS[pos];
      expect(SAMPLE_FULL[pos].full).toBe(full); // the sample dot's full
      expect(deriveChartingDecision("charting", 5, pos, full)).toBe("fully_charted");
      expect(deriveChartingDecision("pending", 5, pos, full + 40)).toBe("fully_charted");
      expect(deriveChartingDecision("charting", 5, pos, full - 1)).toBe("partial_chart");
    }
  });

  it("no longer counts games: Hawkins' 11 games and 81 of 125 runs then, 101 of 100 now", () => {
    expect(deriveChartingDecision("partial_chart", 11, "RB", 99)).toBe("partial_chart");
    expect(deriveChartingDecision("partial_chart", 11, "RB", 101)).toBe("fully_charted");
    expect(deriveChartingDecision("charting", 20, "RB")).toBe("partial_chart");
  });

  it("reads a stored Fully Charted under the full sample as Partial Chart", () => {
    // Picked by hand, or saved back from the old thresholds (39 WRs on 11/19).
    expect(deriveChartingDecision("fully_charted", 6, "WR", 152)).toBe("partial_chart");
    expect(deriveChartingDecision("fully_charted", 6, "QB", 165)).toBe("partial_chart");
    expect(deriveChartingDecision("fully_charted", 0, "TE", 0)).toBe("charting");
    expect(deriveChartingDecision("fully_charted", 9, "WR", 160)).toBe("fully_charted");
  });

  it("Undecided with no charted games stays Undecided", () => {
    expect(deriveChartingDecision("pending", 0, "WR", 0)).toBe("pending");
  });

  it("Not Charting is left alone, and Partial Chart isn't walked back", () => {
    expect(deriveChartingDecision("not_charting", 3, "WR", 200)).toBe("not_charting");
    expect(deriveChartingDecision("partial_chart", 1, "QB", 10)).toBe("partial_chart");
  });

  it("keeps 8 games for a position without a full sample, never demoted", () => {
    expect(deriveChartingDecision("charting", 8, "K")).toBe("fully_charted");
    expect(deriveChartingDecision("charting", 7, "K")).toBe("partial_chart");
    expect(deriveChartingDecision("fully_charted", 2, "K")).toBe("fully_charted");
  });

  it("names the full samples in the status pickers, which don't offer Fully Charted", () => {
    expect(FULLY_CHARTED_HINT).toBe(
      "Fully Charted is set by the Big Board's full sample: QB 180 graded throws, RB 100 runs, WR 160 routes, TE 140 routes",
    );
    for (const file of ["components/scouting/ProspectRosterSheet.tsx", "components/scouting/shared/ChartingBoard.tsx"]) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src).toMatch(/disabled=\{d\.value === "fully_charted"\}/);
      expect(src).toMatch(/title=\{FULLY_CHARTED_HINT\}/);
    }
  });
});

// Migration 102's view counts the plays the Big Board's sample dot counts
// (aboveExpected.ts isQBGradedThrow / isKnownRun / isRatedTERoute), so the
// Prospect board never needs the raw plays to agree with it.
describe("prospect_sample_counts (migration 102)", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/102_prospect_sample_counts.sql"), "utf8");
  const ae = readFileSync(join(process.cwd(), "lib/scouting/aboveExpected.ts"), "utf8");

  it("filters QB graded throws like isQBGradedThrow", () => {
    expect(ae).toMatch(/const isQBGradedThrow = \(pl: QBPlay\) =>[^;]*pl\.play_type !== "run" && pl\.accuracy != null && pl\.accuracy !== "tipped_ball";/);
    expect(sql).toMatch(/qp\.play_type <> 'run'\s+AND qp\.accuracy IS NOT NULL\s+AND qp\.accuracy <> 'tipped_ball'/);
  });

  it("filters RB known runs like isKnownRun", () => {
    expect(ae).toMatch(/RB_RUN_TYPES: RBRunType\[\] = \["outside_zone", "inside_zone", "outside_man_gap", "inside_man_gap"\];/);
    expect(ae).toMatch(/RB_RUN_TYPES\.includes\(pl\.run_type as RBRunType\) && pl\.success !== null;/);
    expect(sql).toMatch(/rp\.run_type IN \('outside_zone', 'inside_zone', 'outside_man_gap', 'inside_man_gap'\)\s+AND rp\.success IS NOT NULL/);
  });

  it("filters TE rated routes like isRatedTERoute", () => {
    expect(ae).toMatch(/isRatedTERoute = \(pl: TEPlay\) => pl\.play_type === "route_run" && pl\.was_open !== null;/);
    expect(sql).toMatch(/tp\.play_type = 'route_run'\s+AND tp\.was_open IS NOT NULL/);
  });

  it("is additive and readable by signed-in users", () => {
    expect(sql).toMatch(/WITH \(security_invoker = on\)/);
    expect(sql).toMatch(/GRANT SELECT ON public\.prospect_sample_counts TO authenticated;/);
    expect(sql.replace(/--[^\n]*/g, "")).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/i);
  });
});
