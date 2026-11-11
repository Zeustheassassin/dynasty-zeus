import { describe, it, expect } from "vitest";
import { COLLEGE_ZONE_ACCURACY, COLLEGE_ZONE_SHARE, qbFullSeasons, qbStyleValues } from "@/lib/scouting/qbStyle";
import { DEPTH_ZONES, SEASON_DEPTH_SELECT, SEASON_DEPTH_SELECT_NO_POCKET, type PffSeasonDepthRow } from "@/lib/scouting/middleUsage";
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
    expect(f.pocket).toBeNull(); // no pocket row imported
  });

  it("sums the time-in-pocket rows (migration 093): held share, time to sack and scramble by count, accuracy by aimed passes", () => {
    const rows = [
      season(2024, 10, { }),
      { ...season(2025, 10, {}), fp_dropbacks: 300, fp_held: 120, fp_ttt_sacks: 3.5, fp_less_sacks: 2, fp_more_sacks: 8, fp_ttt_scrambles: 5, fp_less_scrambles: 1, fp_more_scrambles: 9, fp_less_acc: 80, fp_less_aimed: 150, fp_more_acc: 60, fp_more_aimed: 100 },
      { ...season(2026, 10, {}), fp_dropbacks: 100, fp_held: 60, fp_ttt_sacks: 4.0, fp_less_sacks: 0, fp_more_sacks: 5, fp_ttt_scrambles: null, fp_less_scrambles: 0, fp_more_scrambles: 0, fp_less_acc: 70, fp_less_aimed: 50, fp_more_acc: 50, fp_more_aimed: 50 },
    ];
    const pk = qbFullSeasons(rows).get("Q")!.pocket!;
    expect(pk.seasons).toEqual([2025, 2026]); // 2024 has no pocket row
    expect(pk.heldPct).toBeCloseTo((100 * 180) / 400, 12);
    expect([pk.sacks, pk.heldSacks, pk.scrambles]).toEqual([15, 13, 10]);
    expect(pk.timeToSack).toBeCloseTo((3.5 * 10 + 4.0 * 5) / 15, 12);
    expect(pk.timeToScramble).toBeCloseTo(5, 12);
    expect(pk.quickAccuracy).toBeCloseTo((80 * 150 + 70 * 50) / 200, 12);
    expect(pk.heldAccuracy).toBeCloseTo((60 * 100 + 50 * 50) / 150, 12);
    expect(qbStyleValues(qbFullSeasons(rows).get("Q"), undefined)).toMatchObject({ pff_qs_held: 45, pff_qs_held_n: 400 });
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
    expect(SEASON_DEPTH_SELECT).toContain("fp_held:pocket->more_dropbacks");
    // Before migration 093 the client falls back to a select with no pocket column.
    expect(SEASON_DEPTH_SELECT_NO_POCKET).not.toContain("pocket");
    expect(SEASON_DEPTH_SELECT.startsWith(SEASON_DEPTH_SELECT_NO_POCKET)).toBe(true);
  });
});

describe("the Big Board's QB style values", () => {
  it("are the raw middle 10+ share and the charted read rate, each with its sample", () => {
    const f = qbFullSeasons([season(2025, 10, {})]).get("Q")!;
    expect(qbStyleValues(f, { num: 30, den: 60 })).toEqual({
      pff_qs_mid10: (100 * f.middleRaw.middle) / f.middleRaw.pastLos, pff_qs_mid10_n: f.middleRaw.pastLos,
      pff_qs_reads: 50, pff_qs_reads_n: 60, pff_qs_held: null, pff_qs_held_n: null,
    });
    expect(qbStyleValues(undefined, undefined)).toEqual({ pff_qs_mid10: null, pff_qs_mid10_n: null, pff_qs_reads: null, pff_qs_reads_n: null, pff_qs_held: null, pff_qs_held_n: null });
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
