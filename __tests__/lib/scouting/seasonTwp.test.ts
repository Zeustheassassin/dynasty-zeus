import { describe, expect, it } from "vitest";
import { seasonTwpCounts } from "@/lib/scouting/seasonTwp";
import { SEASON_DEPTH_SELECT, type PffSeasonDepthRow } from "@/lib/scouting/middleUsage";

const row = (prospect_id: string, season: number, f: Record<string, number>): PffSeasonDepthRow =>
  ({ prospect_id, season, pff_player_id: 1, team_name: null, zone_attempts: {}, fetched_at: "", ...f }) as PffSeasonDepthRow;

// 100 dropbacks: 10 behind the line, 60 short, 20 medium, 10 deep (rates in %).
const shortThrower = (id: string, twp: number, shortRate: number) => row(id, 2026, {
  fs_all_dropbacks: 100, fs_twp: twp,
  fs_behind_los_dropbacks: 10, fs_behind_los_twp_rate: 0,
  fs_short_dropbacks: 60, fs_short_twp_rate: shortRate,
  fs_medium_dropbacks: 20, fs_medium_twp_rate: 0,
  fs_deep_dropbacks: 10, fs_deep_twp_rate: 0,
});
// 100 dropbacks: 10 behind the line, 20 short, 30 medium, 40 deep.
const deepThrower = (id: string, twp: number, deepRate: number) => row(id, 2026, {
  fs_all_dropbacks: 100, fs_twp: twp,
  fs_behind_los_dropbacks: 10, fs_behind_los_twp_rate: 0,
  fs_short_dropbacks: 20, fs_short_twp_rate: 0,
  fs_medium_dropbacks: 30, fs_medium_twp_rate: 0,
  fs_deep_dropbacks: 40, fs_deep_twp_rate: deepRate,
});

describe("seasonTwpCounts", () => {
  it("judges each season against the pool's TWP rate at his depths", () => {
    // Same 4 TWPs on 100 dropbacks each; the pool says deep balls are the risky ones.
    const rows = [shortThrower("a", 4, 100 * 4 / 60), deepThrower("b", 4, 10), deepThrower("c", 4, 10), shortThrower("d", 0, 0)];
    const res = seasonTwpCounts(rows, () => true);
    const rate = (id: string) => { const c = res.counts.find((x) => x.prospectId === id)!; return c.num / c.den; };
    expect(res.pool).toBeCloseTo(12 / 400, 6);
    // The short thrower's 4 TWPs come where the pool rarely throws one: worse than the deep throwers' 4.
    expect(rate("a")).toBeGreaterThan(rate("b"));
    // Counts sum back to the pool's TWPs: the adjustment only moves them between QBs.
    expect(res.counts.reduce((s, c) => s + c.num, 0)).toBeCloseTo(12, 6);
  });

  it("puts dropbacks without a depth (sacks, scrambles) in their own band", () => {
    const r = row("a", 2026, { fs_all_dropbacks: 120, fs_twp: 3, fs_short_dropbacks: 100, fs_short_twp_rate: 2 });
    const res = seasonTwpCounts([r], () => true);
    expect(res.poolByBand.short).toBeCloseTo(2 / 100, 6);
    expect(res.poolByBand.other).toBeCloseTo(1 / 20, 6);
    // Alone, he is the pool: no adjustment.
    expect(res.counts[0].num).toBeCloseTo(3, 6);
    expect(res.games[0]).toEqual({ id: "a|2026", prospect_id: "a", season_year: 2026 });
  });

  it("skips prospects not included and seasons with no dropbacks", () => {
    const res = seasonTwpCounts([shortThrower("a", 2, 0), row("b", 2025, { fs_all_dropbacks: 0 }), shortThrower("wr", 9, 0)], (id) => id !== "wr");
    expect(res.counts.map((c) => c.prospectId)).toEqual(["a"]);
  });

  it("selects the TWP fields out of raw by name", () => {
    expect(SEASON_DEPTH_SELECT).toContain("fs_twp:raw->turnover_worthy_plays");
    expect(SEASON_DEPTH_SELECT).toContain("fs_all_dropbacks:raw->all_dropbacks");
    for (const b of ["behind_los", "short", "medium", "deep"]) {
      expect(SEASON_DEPTH_SELECT).toContain(`fs_${b}_dropbacks:raw->${b}_dropbacks`);
      expect(SEASON_DEPTH_SELECT).toContain(`fs_${b}_twp_rate:raw->${b}_twp_rate`);
    }
  });
});
