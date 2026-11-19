// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  coverageByAlignment, coverageSnapsAt, defenseUnits, defenseWithoutGame, frontSevenRunDefense, gameSettledBy, gradeWithout,
  isDefender, isFrontSeven, missedTackleRate, runBlockingWithoutGame, trimGameDefenseRows,
  MIN_SEASON_GAMES, olRunBlock, reportGames, seasonReportFinal, seasonReportStale, trimDefenseRows, trimRunBlockingRows,
} from "@/lib/pff/teamUnits";
import { trimOffenseRows } from "@/lib/pff/cast";
import {
  opponentFranchise, reportKey, reportsFor, seasonUnitColumns, type StoredReport, type UnitGame,
} from "@/lib/gameContext/runContext";
import { isMissingSeasonUnitColumns, needsSeasonUnits } from "@/lib/scouting/gameContext";

// Shaped like PFF's /v1/facet/defense/summary rows (2025 Maryland, checked 2026-11-19).
const D = (o: Record<string, unknown>) => ({ franchise_id: 215, ...o });
const rawDefense = [
  D({ player_id: 1, player: "Cam Rice", position: "DI", player_game_count: 12, snap_counts_defense: 566, snap_counts_run_defense: 274, grades_run_defense: 67.4,
    snap_counts_coverage: 6, grades_coverage_defense: 57.3, snap_counts_corner: 0, snap_counts_slot: 0, snap_counts_box: 0, snap_counts_fs: 0, snap_counts_dl: 566,
    missed_tackles: 5, tackles: 19, assists: 16, missed_tackle_rate: 12.5 }),
  D({ player_id: 2, player: "Jamare Glasker", position: "CB", snap_counts_defense: 616, snap_counts_run_defense: 293, grades_run_defense: 68.4,
    snap_counts_coverage: 322, grades_coverage_defense: 62.8, snap_counts_corner: 530, snap_counts_slot: 32, snap_counts_box: 46, snap_counts_fs: 8, snap_counts_dl: 0,
    missed_tackles: 7, tackles: 30, assists: 7 }),
  D({ player_id: 3, player: "Linebacker", position: "LB", snap_counts_defense: 500, snap_counts_run_defense: 250, grades_run_defense: 80,
    snap_counts_coverage: 200, grades_coverage_defense: 70, snap_counts_corner: 0, snap_counts_slot: 50, snap_counts_box: 450, snap_counts_fs: 0, snap_counts_dl: 0,
    missed_tackles: 4, tackles: 50, assists: 10 }),
  D({ player_id: 4, player: "Stray Receiver", position: "WR", snap_counts_defense: 1, snap_counts_run_defense: 1, grades_run_defense: 60, snap_counts_coverage: 0, tackles: 1, missed_tackles: 0, assists: 0 }),
  D({ player_id: 5, player: "Ungraded Edge", position: "ED", snap_counts_defense: 10, snap_counts_run_defense: 5, grades_run_defense: 0 }),
  D({ player_id: 6, player: "Safety", position: "S", snap_counts_defense: 600, snap_counts_run_defense: 200, grades_run_defense: 60,
    snap_counts_coverage: 350, grades_coverage_defense: 75, snap_counts_corner: 0, snap_counts_slot: 100, snap_counts_box: 200, snap_counts_fs: 300, snap_counts_dl: 0,
    missed_tackles: 10, tackles: 40, assists: 10 }),
  D({ player_id: 7, player: "Other Team", position: "LB", franchise_id: 999, snap_counts_run_defense: 400, grades_run_defense: 30 }),
  D({ player: "No id", position: "CB" }),
];
const defense = trimDefenseRows(rawDefense, 215);

// Shaped like /v1/facet/offense/run_blocking rows (2025 Virginia Tech).
const rawRunBlocking = [
  { player_id: 11, player: "Kyle Altuner", position: "C", franchise_id: 337, player_game_count: 12, snap_counts_run_block: 379, grades_run_block: 64,
    gap_snap_counts_run_block: 129, gap_grades_run_block: 65.4, zone_snap_counts_run_block: 232, zone_grades_run_block: 61.7 },
  { player_id: 12, player: "Tomas Rimac", position: "G", franchise_id: 337, snap_counts_run_block: 374, grades_run_block: 53.9 },
  { player_id: 13, player: "Ungraded Tackle", position: "T", franchise_id: 337, snap_counts_run_block: 100, grades_run_block: 0 },
  { player_id: 14, player: "Blocking TE", position: "TE", franchise_id: 337, snap_counts_run_block: 200, grades_run_block: 70 },
];
const runBlocking = trimRunBlockingRows(rawRunBlocking, 337);

describe("trimming PFF's season reports", () => {
  it("keeps this team's players with an id, in short keys", () => {
    expect(defense.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(defense[1]).toMatchObject({ pos: "CB", snaps: 616, cov: 322, g_cov: 62.8, corner: 530, slot: 32, box: 46, fs: 8, dl: 0, mt: 7, tk: 30, ast: 7 });
    expect(runBlocking[0]).toEqual({ id: 11, name: "Kyle Altuner", pos: "C", gp: 12, rb: 379, g_rb: 64, gap: 129, g_gap: 65.4, zone: 232, g_zone: 61.7 });
  });

  it("knows the front seven and the defenders", () => {
    expect(["DI", "ED", "LB", "dt", "OLB"].every(isFrontSeven)).toBe(true);
    expect(["CB", "S", "WR"].some(isFrontSeven)).toBe(false);
    expect(["CB", "S", "DI"].every(isDefender)).toBe(true);
    expect(["WR", "HB", "G"].some(isDefender)).toBe(false);
  });
});

describe("season units", () => {
  it("weights the line's run-block grades by snaps, skipping ungraded linemen and non-linemen", () => {
    expect(olRunBlock(runBlocking)).toEqual({ grade: 59, snaps: 753 });
  });

  it("weights the front seven's run defense by run-defense snaps (DI + ED + LB only)", () => {
    expect(frontSevenRunDefense(defense)).toEqual({ grade: 73.4, snaps: 524 });
  });

  it("splits his coverage snaps by where he lined up", () => {
    expect(coverageSnapsAt(defense[1], "outside")).toBeCloseTo((322 * 530) / 616, 6);
    expect(coverageSnapsAt(defense[0], "box")).toBe(0); // a DI: on the line, not in the box
    expect(coverageByAlignment(defense)).toEqual({
      outside: { grade: 62.8, snaps: 277 },
      slot: { grade: 71.8, snaps: 95 },
      box: { grade: 71.3, snaps: 321 },
    });
  });

  it("rates missed tackles over every defender, PFF's formula", () => {
    expect(missedTackleRate(defense.slice(0, 1))).toEqual({ rate: 12.5, attempts: 40 }); // PFF said 12.5
    expect(missedTackleRate(defense)).toEqual({ rate: 12.5, attempts: 208 });
    expect(missedTackleRate([])).toEqual({ rate: null, attempts: 0 });
  });

  it("counts the games behind a report (the most any player played)", () => {
    expect(reportGames(defense)).toBe(12);
    expect(reportGames(runBlocking)).toBe(12);
    expect(reportGames([])).toBeNull();
    expect(MIN_SEASON_GAMES).toBe(6);
  });

  it("gives nulls for an empty report", () => {
    expect(defenseUnits([])).toEqual({
      frontSeven: { grade: null, snaps: 0 },
      coverage: { outside: { grade: null, snaps: 0 }, slot: { grade: null, snaps: 0 }, box: { grade: null, snaps: 0 } },
      missedTackles: { rate: null, attempts: 0 },
    });
  });
});

describe("when to read a season report again", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  it("treats a copy read after the bowls as final", () => {
    expect(seasonReportFinal(2025, "2026-02-01T00:00:00Z")).toBe(true);
    expect(seasonReportFinal(2025, "2026-01-20T00:00:00Z")).toBe(false);
    expect(seasonReportStale(2025, "2026-03-01T00:00:00Z", now)).toBe(false);
  });
  it("re-reads the season in progress once its copy is a week old", () => {
    expect(seasonReportStale(2026, "2026-11-15T00:00:00Z", now)).toBe(false);
    expect(seasonReportStale(2026, "2026-11-10T00:00:00Z", now)).toBe(true);
    expect(seasonReportStale(2026, null, now)).toBe(true);
  });
});

describe("leaving his game out", () => {
  it("takes a game back out of a season grade's snap-weighted mean", () => {
    expect(gradeWithout(100, 70, 20, 50)).toBe(75);
    expect(gradeWithout(100, 70, 0, null)).toBe(70); // he didn't play that game
    expect(gradeWithout(100, 70, 20, 0)).toBe(70); // a 0 is "not graded"
    expect(gradeWithout(20, 70, 20, 50)).toBeNull(); // nothing left
    expect(gradeWithout(100, 98, 90, 10)).toBe(100); // clamped
  });

  it("subtracts the opponent's game from its season, player by player", () => {
    const game = trimGameDefenseRows([
      { player_id: 1, franchise_id: 215, position: "DRT", snap_counts_defense: 60, snap_counts_run_defense: 30, grades_run_defense: 40,
        snap_counts_dl: 60, missed_tackles: 3, tackles: 2, assists: 1 },
      { player_id: 99, franchise_id: 337, position: "LE", snap_counts_defense: 50 },
      { franchise_id: 215, position: "LB" },
    ]);
    expect(game.map((r) => [r.id, r.team])).toEqual([[1, 215], [99, 337]]);
    const out = defenseWithoutGame(defense, game.filter((r) => r.team === 215));
    // Cam Rice: 274 run snaps at 67.4 minus 30 at 40 → 244 at 70.8; misses 5 → 2 of 40 → 34 attempts.
    expect(out[0]).toMatchObject({ gp: 11, snaps: 506, rd: 244, mt: 2, tk: 17, ast: 15, dl: 506 });
    expect(out[0].g_rd).toBeCloseTo((274 * 67.4 - 30 * 40) / 244, 6);
    expect(out[1]).toBe(defense[1]); // not in the game: unchanged
    expect(missedTackleRate(out).attempts).toBe(208 - 6);
    expect(reportGames(out)).toBe(11);
  });

  it("subtracts his own line's game from its season run blocking", () => {
    const off = trimOffenseRows([{ player_id: 11, franchise_id: 337, position: "C", snap_counts_total: 70, snap_counts_run_block: 30, grades_run_block: 90 }]);
    const out = runBlockingWithoutGame(runBlocking, off);
    expect(out[0]).toMatchObject({ gp: 11, rb: 349 });
    expect(out[0].g_rb).toBeCloseTo((379 * 64 - 30 * 90) / 349, 6);
    expect(olRunBlock(out).grade).toBeLessThan(olRunBlock(runBlocking).grade!);
  });

  it("waits for PFF's grading of a game to settle before taking it out", () => {
    expect(gameSettledBy("2026-11-01T17:00:00Z", "2026-11-12T00:00:00Z")).toBe(true);
    expect(gameSettledBy("2026-11-08T17:00:00Z", "2026-11-12T00:00:00Z")).toBe(false);
    expect(gameSettledBy(null, "2026-11-12T00:00:00Z")).toBe(true); // no kickoff known: an old game
  });
});

describe("season units per charted game", () => {
  const offense = trimOffenseRows([
    { player_id: 1, position: "HB", franchise_id: 337 },
    { player_id: 2, position: "QB", franchise_id: 215 },
  ]);

  it("finds the opponent from the game facet, else PFF's schedule", () => {
    expect(opponentFranchise(337, offense, undefined)).toBe(215);
    expect(opponentFranchise(337, offense.slice(0, 1), { home_franchise_id: 215, away_franchise_id: 337 })).toBe(215);
    expect(opponentFranchise(337, [], { home_franchise_id: 337, away_franchise_id: 40 })).toBe(40);
    expect(opponentFranchise(500, offense, undefined)).toBeNull(); // he isn't in the facet
    expect(opponentFranchise(null, offense, undefined)).toBeNull();
  });

  const game = (o: Partial<UnitGame>): UnitGame => ({ prospectId: "p", season: 2025, position: "RB", linked: true, franchise: 337, opponent: 215, ...o });

  it("asks an RB's own line and the opponent's defense; a WR / TE the defense; a QB nothing", () => {
    expect(reportsFor(game({}))).toEqual([
      { season: 2025, franchiseId: 337, report: "run_blocking" },
      { season: 2025, franchiseId: 215, report: "defense" },
    ]);
    expect(reportsFor(game({ position: "WR" }))).toEqual([{ season: 2025, franchiseId: 215, report: "defense" }]);
    expect(reportsFor(game({ position: "QB" }))).toEqual([]);
    expect(reportsFor(game({ linked: false }))).toEqual([]);
    expect(reportsFor(game({ opponent: null }))).toEqual([]);
  });

  const reports = new Map<string, StoredReport>([
    [reportKey(2025, 337, "run_blocking"), { rows: runBlocking, fetchedAt: "2026-03-01T00:00:00.000Z" }],
    [reportKey(2025, 215, "defense"), { rows: defense, fetchedAt: "2026-02-15T00:00:00.000Z" }],
    [reportKey(2025, 40, "defense"), { rows: [], fetchedAt: "2026-02-20T00:00:00.000Z" }],
  ]);

  it("fills an RB game from both reports, dated by the older one", () => {
    expect(seasonUnitColumns(game({}), reports, true)).toEqual({
      opp_pff_franchise_id: 215,
      ol_run_block_season: 59, ol_run_block_season_snaps: 753,
      opp_front7_run_def: 73.4, opp_front7_run_def_snaps: 524,
      opp_cov_outside: 62.8, opp_cov_outside_snaps: 277,
      opp_cov_slot: 71.8, opp_cov_slot_snaps: 95,
      opp_cov_box: 71.3, opp_cov_box_snaps: 321,
      opp_mt_rate: 12.5, opp_tackle_attempts: 208,
      opp_season_games: 12, team_season_games: 12,
      season_units_status: "ok", season_units_at: "2026-02-15T00:00:00.000Z",
    });
  });

  it("takes the game out once it has settled and the report was read after", () => {
    const gameDef = trimGameDefenseRows([{ player_id: 3, franchise_id: 215, position: "MLB", snap_counts_defense: 70, snap_counts_run_defense: 40, grades_run_defense: 95 }]);
    const settled = seasonUnitColumns(game({ kickoff: "2025-10-01T17:00:00Z", pffGameId: 7 }), reports, true, { defense: gameDef });
    const fresh = seasonUnitColumns(game({ kickoff: "2026-02-10T17:00:00Z", pffGameId: 7 }), reports, true, { defense: gameDef });
    // The linebacker's 95 game comes out: his 80 on 250 snaps → 77.1 on 210, the front seven 73.4 → 71.6.
    expect(settled.opp_front7_run_def as number).toBeLessThan(73.4);
    expect(fresh.opp_front7_run_def).toBe(73.4); // the report (read 2026-02-15) predates the game settling
  });

  it("gives a WR no line grade, and says why when it can't fill", () => {
    expect(seasonUnitColumns(game({ position: "WR" }), reports, true)).toMatchObject({ ol_run_block_season: null, opp_cov_slot: 71.8, season_units_status: "ok" });
    expect(seasonUnitColumns(game({ position: "TE", opponent: 40 }), reports, true)).toMatchObject({ opp_cov_slot: null, season_units_status: "no_data", season_units_at: "2026-02-20T00:00:00.000Z" });
    expect(seasonUnitColumns(game({ position: "QB" }), reports, true)).toMatchObject({ season_units_status: "n/a", opp_front7_run_def: null });
    expect(seasonUnitColumns(game({ linked: false }), reports, true)).toMatchObject({ season_units_status: "no_pff" });
    expect(seasonUnitColumns(game({}), reports, false)).toMatchObject({ season_units_status: "no_pff" });
    expect(seasonUnitColumns(game({ opponent: null }), reports, true)).toMatchObject({ season_units_status: "no_team", opp_pff_franchise_id: null });
  });
});

describe("queueing the season units fill", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  it("fills a game never looked up, and refreshes a week-old copy of the season in progress", () => {
    expect(needsSeasonUnits({ season_units_status: null, season_units_at: null }, 2025, now)).toBe(true);
    expect(needsSeasonUnits({ season_units_status: "n/a", season_units_at: null }, 2026, now)).toBe(false);
    expect(needsSeasonUnits({ season_units_status: "ok", season_units_at: "2026-11-16T00:00:00Z" }, 2026, now)).toBe(false);
    expect(needsSeasonUnits({ season_units_status: "ok", season_units_at: "2026-11-01T00:00:00Z" }, 2026, now)).toBe(true);
    expect(needsSeasonUnits({ season_units_status: "no_data", season_units_at: "2026-11-01T00:00:00Z" }, 2026, now)).toBe(true);
    expect(needsSeasonUnits({ season_units_status: "ok", season_units_at: "2026-03-01T00:00:00Z" }, 2025, now)).toBe(false);
  });

  it("tells a missing 103 column from a missing 065 table", () => {
    expect(isMissingSeasonUnitColumns(new Error("column scouting_game_context.opp_pff_franchise_id does not exist"))).toBe(true);
    expect(isMissingSeasonUnitColumns(new Error("relation \"public.scouting_game_context\" does not exist"))).toBe(false);
  });
});
