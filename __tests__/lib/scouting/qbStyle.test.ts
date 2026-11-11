import { describe, it, expect } from "vitest";
import { COLLEGE_ZONE_ACCURACY, COLLEGE_ZONE_SHARE, qbFullSeasons, qbStyleValues } from "@/lib/scouting/qbStyle";
import { DEPTH_ZONES, SEASON_DEPTH_SELECT, type PffSeasonDepthRow } from "@/lib/scouting/middleUsage";
import { pastFirstRead } from "@/lib/scouting/chartedComponents";
import type { QBPlay } from "@/lib/types";

// A season: 10 attempts in every zone but center_medium (`mid`), plus PFF's
// season numbers as selected out of `raw` (fs_*).
const season = (season: number, mid: number, fs: Record<string, number>): PffSeasonDepthRow => ({
  prospect_id: "Q", season, pff_player_id: 1, team_name: season === 2025 ? "DUKE" : "TULANE", fetched_at: "",
  zone_attempts: Object.fromEntries(DEPTH_ZONES.map((z) => [z, z === "center_medium" ? mid : 10])),
  ...Object.fromEntries(Object.entries(fs).map(([k, v]) => [`fs_${k}`, v])),
});

describe("qbFullSeasons", () => {
  it("sums every season: attempts by zone, time per dropback, aDOT by attempts, sacks, pressures, scrambles", () => {
    const rows = [
      season(2024, 30, { dropbacks: 200, attempts: 140, ttt_total: 500, adot: 9, sacks: 10, pressures: 60, scrambles: 8, aimed_center_medium: 25, acc_center_medium: 60 }),
      season(2025, 10, { dropbacks: 150, attempts: 120, ttt_total: 360, adot: 7, sacks: 5, pressures: 40, scrambles: 4, aimed_center_medium: 8, acc_center_medium: 75 }),
    ];
    const f = qbFullSeasons(rows).get("Q")!;
    expect(f.seasons).toEqual([2024, 2025]);
    expect(f.teams).toBe("TULANE 2024 · DUKE 2025");
    expect(f.dropbacks).toBe(350);
    expect(f.ttt).toBeCloseTo(860 / 350, 12);
    expect(f.adot).toBeCloseTo((9 * 140 + 7 * 120) / 260, 12);
    expect([f.sacks, f.pressures, f.scrambles]).toEqual([15, 100, 12]);
    // 11 zones × 10 × 2 seasons + 40 center_medium.
    const total = 220 + 40;
    expect(f.zones.center_medium).toMatchObject({ attempts: 40, aimed: 33 });
    expect(f.zones.center_medium.share).toBeCloseTo((100 * 40) / total, 12);
    expect(f.zones.center_medium.accuracy).toBeCloseTo((60 * 25 + 75 * 8) / 33, 12);
    expect(f.zones.left_deep.accuracy).toBeNull(); // no aimed passes selected
    expect(f.behindLos).toBeCloseTo((100 * 60) / total, 12);
    expect(f.deep).toBeCloseTo((100 * 60) / total, 12);
    // Middle 10+ past the line: center_medium + center_deep over everything but behind the line.
    expect(f.middleRaw).toEqual({ middle: 40 + 20, pastLos: total - 60 });
    expect(f.middle).not.toBeNull();
  });

  it("leaves time and aDOT blank without PFF's season numbers, and skips a prospect with no attempts", () => {
    const f = qbFullSeasons([season(2025, 10, {})]).get("Q")!;
    expect(f.ttt).toBeNull();
    expect(f.adot).toBeNull();
    expect(f.attempts).toBe(120); // falls back to the zone attempts
    const empty = { ...season(2025, 0, {}), zone_attempts: {} };
    expect(qbFullSeasons([empty]).size).toBe(0);
  });

  it("carries a college line for every zone, and selects every field it reads", () => {
    for (const z of DEPTH_ZONES) {
      expect(COLLEGE_ZONE_SHARE[z]).toBeGreaterThan(0);
      expect(COLLEGE_ZONE_ACCURACY[z]).toBeGreaterThan(0);
      expect(SEASON_DEPTH_SELECT).toContain(`fs_aimed_${z}:raw->${z}_aimed_passes`);
    }
    expect(Object.values(COLLEGE_ZONE_SHARE).reduce((a, v) => a + v, 0)).toBeCloseTo(100, 0);
    expect(SEASON_DEPTH_SELECT).toContain("fs_ttt_total:raw->ttt_total_time");
  });
});

describe("the Big Board's QB style values", () => {
  it("are the raw middle 10+ share and the charted read rate, each with its sample", () => {
    const f = qbFullSeasons([season(2025, 10, {})]).get("Q")!;
    expect(qbStyleValues(f, { num: 30, den: 60 })).toEqual({
      pff_qs_mid10: (100 * f.middleRaw.middle) / f.middleRaw.pastLos, pff_qs_mid10_n: f.middleRaw.pastLos,
      pff_qs_reads: 50, pff_qs_reads_n: 60,
    });
    expect(qbStyleValues(undefined, undefined)).toEqual({ pff_qs_mid10: null, pff_qs_mid10_n: null, pff_qs_reads: null, pff_qs_reads_n: null });
  });
});

describe("pastFirstRead", () => {
  it("reads 2nd option and checkdown as past, 1st option as not, anything else as no read", () => {
    const pl = (timing: QBPlay["timing"], play_type: QBPlay["play_type"] = "pass") => ({ timing, play_type });
    expect(pastFirstRead(pl("second_option"))).toBe(true);
    expect(pastFirstRead(pl("checkdown"))).toBe(true);
    expect(pastFirstRead(pl("first_option", "rpo"))).toBe(false);
    for (const t of ["extended_play", "scramble", "sack", "throw_away", null] as const) expect(pastFirstRead(pl(t))).toBeNull();
    expect(pastFirstRead(pl("second_option", "run"))).toBeNull();
  });
});
