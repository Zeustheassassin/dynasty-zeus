import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import GradingChecks from "@/components/scouting/stats/GradingChecks";
import { tagCols, tagRow } from "@/components/scouting/stats/tagCols";
import { EMPTY_GRADING_DATA } from "@/lib/scouting/aeComponents";
import { TAG_STATS } from "@/lib/scouting/tagStats";
import type { Prospect, RBPlay, ScoutingGame } from "@/lib/types";

afterEach(cleanup);

describe("tag stat columns", () => {
  it("pair each stat with its own sample size", () => {
    for (const pos of ["QB", "RB", "WR", "TE"] as const) {
      const cols = tagCols(pos);
      expect(cols.length).toBe(TAG_STATS[pos].length * 2);
      for (const s of TAG_STATS[pos]) {
        const c = cols.find((x) => x.key === s.key)!;
        expect(c.weightBy).toBe(`${s.key}_n`);
        expect(cols.find((x) => x.key === `${s.key}_n`)).toBeDefined();
      }
    }
  });

  it("read — for a prospect charted before the tags, with n 0", () => {
    const row = tagRow("WR", undefined);
    expect(row.tag_wr_press).toBeNull();
    expect(row.tag_wr_press_n).toBe(0);
    expect(tagRow("WR", { tag_wr_press: { rate: 62.345, n: 14 } }).tag_wr_press).toBe(62.3);
  });
});

describe("Analysis → Grading", () => {
  it("shows the four checks, with every tag off and waiting on tagged plays", () => {
    const games = [{ id: "g", prospect_id: "r", season_year: 2025, created_at: "2026-06-01T00:00:00Z" }] as ScoutingGame[];
    const rbPlays = Array.from({ length: 20 }, (_, i) => ({ game_id: "g", run_type: "inside_zone", formation: "gun", success: i % 2 === 0, loaded_box: false, unblocked_defender: false })) as RBPlay[];
    render(
      <GradingChecks
        prospects={[{ id: "r", position: "RB" } as Prospect]}
        games={games} qbPlays={[]} rbPlays={rbPlays} tePlays={[]}
        gameRouteCells={null} gradingData={EMPTY_GRADING_DATA}
      />,
    );
    for (const h of ["Difficulty tags (tag correction)", "Garbage time", "Era scale check", "AE Score components"]) {
      expect(screen.getByRole("heading", { name: h })).toBeTruthy();
    }
    expect(screen.getAllByText(/^Off: needs/).length).toBeGreaterThan(5);
    expect(screen.getAllByText("YPRR").length).toBeGreaterThan(0);
  });
});
