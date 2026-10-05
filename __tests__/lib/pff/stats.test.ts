import { describe, it, expect } from "vitest";
import { extractGameStats, extractSeasonStats, GAME_STAT_KEYS, SEASON_STAT_KEYS } from "@/lib/pff/stats";

// Real rows (trimmed) from PFF on 2026-10-05.
// Carnell Tate (WR) vs Texas, 2025 week 1, game 28802.
const TATE_REC = {
  game_id: 28802, week: 1, player_franchise_id: 260, position: "LWR",
  targets: 2, receptions: 2, yards: 49, routes: 17, pass_plays: 20, yards_after_catch: 1, avoided_tackles: 0, drops: 0,
  contested_targets: 2, contested_receptions: 2, touchdowns: 1, avg_depth_of_target: 24, slot_snaps: 2, wide_snaps: 18,
  inline_snaps: 0, fumbles: 0, grades_offense: 72.7, grades_pass_route: 73.1, grades_hands_drop: 70.7, yprr: 2.88,
};
const TATE_BLK = {
  game_id: 28802, snap_counts_offense: 46, snap_counts_block: 26, snap_counts_run_block: 26, snap_counts_pass_block: 0,
  pressures_allowed: 0, sacks_allowed: 0, grades_run_block: 60.9, grades_offense: 72.7,
};
// Fernando Mendoza (QB) vs Illinois, 2025 week 4, game 29007.
const MENDOZA_PASS = {
  game_id: 29007, dropbacks: 27, all_dropbacks: 27, attempts: 23, all_attempts: 23, aimed_passes: 23, completions: 21,
  yards: 267, touchdowns: 5, interceptions: 0, big_time_throws: 1, turnover_worthy_plays: 0, sacks: 2, thrown_aways: 0,
  drops: 0, def_gen_pressures: 9, ttt_total_time: 60.899993896484375, avg_depth_of_target: 6.4,
  grades_offense: 84.2, grades_pass: 84, grades_run: 64.6,
};
const MENDOZA_RUSH = {
  game_id: 29007, attempts: 5, yards: 18, designed_yards: 11, scrambles: 2, scramble_yards: 7, yards_after_contact: 6,
  avoided_tackles: 1, breakaway_attempts: 0, breakaway_yards: 0, explosive: 0, gap_attempts: 0, zone_attempts: 3,
  touchdowns: 0, fumbles: 0, grades_run: 64.6, grades_offense: 84.2,
};

describe("extractGameStats", () => {
  it("maps a WR's receiving and blocking rows onto the stored columns", () => {
    const s = extractGameStats({ receiving_summary: TATE_REC, blocking_summary: TATE_BLK });
    expect([s.snaps, s.routes, s.pass_plays, s.targets, s.receptions, s.rec_yards, s.yac]).toEqual([46, 17, 20, 2, 2, 49, 1]);
    expect([s.contested_targets, s.contested_receptions, s.rec_td, s.rec_adot]).toEqual([2, 2, 1, 24]);
    expect([s.block_snaps, s.run_block_snaps, s.pass_block_snaps, s.pressures_allowed]).toEqual([26, 26, 0, 0]);
    expect([s.grade_offense, s.grade_pass_route, s.grade_hands_drop, s.grade_run_block]).toEqual([72.7, 73.1, 70.7, 60.9]);
    // Reports he doesn't have stay NULL rather than 0.
    expect([s.dropbacks, s.rush_att, s.grade_pass]).toEqual([null, null, null]);
    expect(s.fumbles).toBe(0);
  });

  it("maps a QB's passing and rushing rows, including scrambles and time to throw", () => {
    const s = extractGameStats({ passing_summary: MENDOZA_PASS, rushing_summary: MENDOZA_RUSH });
    expect([s.dropbacks, s.attempts, s.aimed_passes, s.completions, s.pass_yards, s.pass_td]).toEqual([27, 23, 23, 21, 267, 5]);
    expect([s.btt, s.twp, s.sacks, s.rec_drops, s.pressures_faced]).toEqual([1, 0, 2, 0, 9]);
    expect(s.ttt_total).toBeCloseTo(60.9, 1);
    expect([s.rush_att, s.scrambles, s.designed_yards, s.scramble_yards, s.rush_mtf]).toEqual([5, 2, 11, 7, 1]);
    expect([s.grade_offense, s.grade_pass, s.grade_run]).toEqual([84.2, 84, 64.6]);
  });

  it("adds fumbles as a runner and as a receiver", () => {
    const s = extractGameStats({ rushing_summary: { fumbles: 1 }, receiving_summary: { fumbles: 1 } });
    expect(s.fumbles).toBe(2);
    expect(extractGameStats({}).fumbles).toBeNull();
  });

  it("fills every stored column", () => {
    const s = extractGameStats({ receiving_summary: TATE_REC });
    expect(Object.keys(s).sort()).toEqual([...GAME_STAT_KEYS].sort());
  });
});

describe("extractSeasonStats", () => {
  it("takes grades and aDOT from PFF's aggregate, not from the games", () => {
    // Tate's 7 charted 2025 games: PFF grades them 88.9 together, though the
    // same games average 76.4 by snaps.
    const s = extractSeasonStats({ receiving_summary: { grades_offense: 88.9, grades_pass_route: 89.6, avg_depth_of_target: 17 } });
    expect([s.grade_offense, s.grade_pass_route, s.rec_adot]).toEqual([88.9, 89.6, 17]);
  });

  it("reads the play-action and blitz splits by PFF's prefixes", () => {
    const s = extractSeasonStats({
      passing_concept: { pa_dropbacks: 39, pa_attempts: 34, pa_aimed_passes: 33, pa_completions: 29, pa_drops: 0, pa_yards: 324, pa_big_time_throws: 0, pa_turnover_worthy_plays: 0, pa_sacks: 1, npa_dropbacks: 79 },
      passing_pressure: { blitz_dropbacks: 11, blitz_aimed_passes: 10, no_blitz_dropbacks: 16, no_blitz_turnover_worthy_plays: 0 },
    });
    expect([s.pa_dropbacks, s.pa_attempts, s.pa_aimed, s.pa_completions, s.pa_yards, s.pa_sacks, s.npa_dropbacks]).toEqual([39, 34, 33, 29, 324, 1, 79]);
    expect([s.blitz_dropbacks, s.blitz_aimed, s.no_blitz_dropbacks, s.no_blitz_twp]).toEqual([11, 10, 16, 0]);
    expect(s.npa_attempts).toBeNull();
  });

  it("sums man / zone over franchises and the team's dropbacks over every passer", () => {
    const s = extractSeasonStats(
      { receiving_depth: { deep_targets: 13, deep_receptions: 9, deep_yards: 364 } },
      [{ man_routes: 32, zone_routes: 104, man_targets: 9, zone_targets: 22, man_yards: 121, zone_yards: 386 }],
      [{ dropbacks: 206 }, { dropbacks: 1 }, { dropbacks: 1 }],
    );
    expect([s.deep_targets, s.deep_receptions, s.deep_yards]).toEqual([13, 9, 364]);
    expect([s.man_routes, s.zone_routes, s.man_yards, s.zone_yards]).toEqual([32, 104, 121, 386]);
    expect(s.team_dropbacks).toBe(208);
    expect(Object.keys(s).sort()).toEqual([...SEASON_STAT_KEYS].sort());
  });

  it("leaves man / zone and team dropbacks NULL without the facets", () => {
    const s = extractSeasonStats({});
    expect([s.man_routes, s.team_dropbacks]).toEqual([null, null]);
  });
});
