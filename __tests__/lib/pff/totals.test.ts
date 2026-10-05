import { describe, it, expect } from "vitest";
import { buildPffTotals, currentGameRow, gameAsTotals, pffValues, seasonIsCurrent } from "@/lib/pff/totals";
import { GAME_STAT_KEYS, SEASON_STAT_KEYS, type PffGameRow, type PffSeasonRow } from "@/lib/pff/stats";

const blankGame = Object.fromEntries(GAME_STAT_KEYS.map((k) => [k, null])) as Record<(typeof GAME_STAT_KEYS)[number], null>;
const blankSeason = Object.fromEntries(SEASON_STAT_KEYS.map((k) => [k, null])) as Record<(typeof SEASON_STAT_KEYS)[number], null>;

function gameRow(game_id: string, pff_game_id: number, season: number, stats: Partial<PffGameRow>): PffGameRow {
  return {
    ...blankGame, game_id, prospect_id: "p1", pff_player_id: 170273, pff_game_id, season, week: 1,
    franchise_id: 260, pff_position: "LWR", fetched_at: "2026-10-05T00:00:00Z", ...stats,
  };
}
function seasonRow(season: number, pff_game_ids: number[], stats: Partial<PffSeasonRow>): PffSeasonRow {
  return { ...blankSeason, prospect_id: "p1", pff_player_id: 170273, season, pff_game_ids, weeks: [], fetched_at: "2026-10-05T00:00:00Z", ...stats };
}
const linked = (id: string, pff_game_id: number | null, status: "auto" | "confirmed" | "none" | null = "auto") =>
  ({ id, prospect_id: "p1", pff_game_id, pff_match_status: status });

describe("currentGameRow / seasonIsCurrent", () => {
  it("uses a game's row only while the game is linked to that same PFF game", () => {
    const row = gameRow("g1", 100, 2025, {});
    expect(currentGameRow(linked("g1", 100), row)).toBe(row);
    expect(currentGameRow(linked("g1", 101), row)).toBeNull(); // re-linked to another PFF game
    expect(currentGameRow(linked("g1", null, "none"), row)).toBeNull(); // the user said no PFF game
  });

  it("treats a season aggregate as current only for exactly the same games", () => {
    const games = [gameRow("g1", 100, 2025, {}), gameRow("g2", 200, 2025, {})];
    expect(seasonIsCurrent(seasonRow(2025, [200, 100], {}), games)).toBe(true);
    expect(seasonIsCurrent(seasonRow(2025, [100], {}), games)).toBe(false);
    expect(seasonIsCurrent(undefined, games)).toBe(false);
  });
});

describe("buildPffTotals", () => {
  // Two charted games: 7 routes / 70 yds and 3 routes / 0 yds.
  const rows = [
    gameRow("g1", 100, 2025, { routes: 7, rec_yards: 70, targets: 3, receptions: 2, drops: 1, snaps: 30, grade_offense: 90 }),
    gameRow("g2", 200, 2025, { routes: 3, rec_yards: 0, targets: 1, receptions: 0, drops: 0, snaps: 10, grade_offense: 50 }),
  ];
  const games = [linked("g1", 100), linked("g2", 200), linked("g3", 300), linked("g4", null, null)];

  it("sums counts over the imported charted games and computes rates from the sums", () => {
    const t = buildPffTotals(games, rows, [seasonRow(2025, [100, 200], { grade_offense: 84.1, team_dropbacks: 40 })]).get("p1")!;
    expect([t.linked, t.games]).toEqual([3, 2]); // g3 linked but not imported, g4 not linked
    const v = pffValues(t);
    expect(v.pff_routes).toBe(10);
    expect(v.pff_recyds).toBe(70);
    // YPRR = Σ yards ÷ Σ routes = 7.00 — not the mean of 10.0 and 0.0.
    expect(v.pff_yprr).toBe(7);
    expect(v.pff_tprr).toBe(40);
    expect(v.pff_drop_pct).toBe(33.3);
    expect(v.pff_rte_part).toBe(25); // 10 routes ÷ 40 team dropbacks
    expect(v.pff_tshare).toBe(10);
    // The grade is PFF's over the games, not the snap-weighted 80.
    expect(v.pff_gr_off).toBe(84.1);
  });

  it("blanks every aggregate value while a season aggregate covers other games", () => {
    const t = buildPffTotals(games, rows, [seasonRow(2025, [100], { grade_offense: 88 })]).get("p1")!;
    expect([t.seasons, t.seasonsCurrent]).toEqual([1, 0]);
    const v = pffValues(t);
    expect(v.pff_gr_off).toBeNull();
    expect(v.pff_routes).toBe(10); // counts still add up
  });

  it("combines two seasons' grades weighted by the plays behind them, and adds their splits", () => {
    const two = [
      gameRow("g1", 100, 2024, { routes: 100, targets: 10, snaps: 100 }),
      gameRow("g2", 200, 2025, { routes: 300, targets: 30, snaps: 300 }),
    ];
    const t = buildPffTotals([linked("g1", 100), linked("g2", 200)], two, [
      seasonRow(2024, [100], { grade_pass_route: 60, rec_adot: 10, man_routes: 20, man_yards: 40 }),
      seasonRow(2025, [200], { grade_pass_route: 80, rec_adot: 14, man_routes: 30, man_yards: 110 }),
    ]).get("p1")!;
    const v = pffValues(t);
    expect(v.pff_gr_route).toBe(75); // (60·100 + 80·300) ÷ 400 routes
    expect(v.pff_radot).toBe(13); // (10·10 + 14·30) ÷ 40 targets
    expect(v.pff_man_rte).toBe(50);
    expect(v.pff_man_yprr).toBe(3); // 150 ÷ 50
  });

  it("computes the QB rates the way PFF does", () => {
    const qb = [gameRow("g1", 100, 2025, {
      dropbacks: 27, all_dropbacks: 27, attempts: 23, all_attempts: 23, aimed_passes: 23, completions: 21, rec_drops: 0,
      pass_yards: 267, btt: 1, twp: 0, sacks: 2, pressures_faced: 9, ttt_total: 60.9, rush_att: 5, scrambles: 2,
    })];
    const v = pffValues(buildPffTotals([linked("g1", 100)], qb, []).get("p1"));
    expect(v.pff_adj).toBe(91.3); // (21 + 0) ÷ 23 aimed
    expect(v.pff_ypa).toBe(11.6);
    expect(v.pff_ttt).toBe(2.26); // 60.9 s ÷ 27 dropbacks
    expect(v.pff_btt_pct).toBe(4.3);
    expect(v.pff_p2s).toBe(22.2);
    expect(v.pff_dsgn).toBe(3); // 5 runs − 2 scrambles
  });

  it("leaves prospects without a linked game out", () => {
    expect(buildPffTotals([linked("g4", null, null)], [], []).size).toBe(0);
    expect(pffValues(undefined)).toEqual({});
  });
});

describe("gameAsTotals", () => {
  it("shows one game's own grade and aDOT", () => {
    const v = pffValues(gameAsTotals(gameRow("g1", 100, 2025, { routes: 17, rec_yards: 49, grade_offense: 72.7, rec_adot: 24 })));
    expect([v.pff_gr_off, v.pff_radot, v.pff_yprr]).toEqual([72.7, 24, 2.88]);
  });
});
