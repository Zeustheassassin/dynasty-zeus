// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { PffClient, PffParams } from "@/lib/pff/client";
import { importProspect } from "@/lib/pff/runImport";

type Call = { path: string; params: PffParams };

/** A PFF client answering from a handler, recording each call. */
function fakeClient(handler: (path: string, params: PffParams) => unknown): { client: PffClient; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      async get<T>(path: string, params: PffParams = {}) {
        calls.push({ path, params });
        return handler(path, params) as T;
      },
    },
  };
}

// The season schedule (seasonTeams caches per season, so each test uses its own).
const schedule = (games: { id: number; week: number }[]) => ({
  teams: [{ franchise_id: 260, abbreviation: "OHIOST", city: "Ohio State", nickname: "Buckeyes" }],
  games: games.map((g) => ({ ...g, home_franchise_id: 260, away_franchise_id: 311, start: "2025-09-01T00:00:00Z" })),
});

describe("importProspect (WR)", () => {
  const season = 2031;
  const { client, calls } = fakeClient((path, params) => {
    if (path === "/v1/teams") return schedule([{ id: 1, week: 1 }, { id: 2, week: 6 }, { id: 3, week: 9 }]);
    if (path === "/v1/player/receiving/summary") {
      return {
        receiving_summary: {
          // He has rows in games 1 and 2; PFF has nothing for game 3 yet.
          weeks: [
            { game_id: 1, week: 1, player_franchise_id: 260, position: "LWR", routes: 17, yards: 49, targets: 2, receptions: 2 },
            { game_id: 2, week: 6, player_franchise_id: 260, position: "LWR", routes: 30, yards: 120, targets: 8, receptions: 6 },
          ],
          week_totals: [{ grades_offense: 88.9, grades_pass_route: 89.6, avg_depth_of_target: 17, player_game_count: 2 }],
        },
      };
    }
    if (path === "/v1/player/offense/blocking") {
      return { blocking_summary: { weeks: [{ game_id: 1, snap_counts_offense: 46, grades_run_block: 60.9 }, { game_id: 2, snap_counts_offense: 50 }], week_totals: [{ grades_run_block: 58.5 }] } };
    }
    if (path === "/v1/player/receiving/depth") return { receiving_depth: [{ deep_targets: 3, deep_receptions: 2, deep_yards: 80 }] };
    if (path === "/v1/facet/receiving/scheme") {
      return { receiving_scheme: [{ player_id: 999, man_routes: 1 }, { player_id: 170273, man_routes: 12, zone_routes: 30, man_yards: 40, zone_yards: 120 }] };
    }
    if (path === "/v1/facet/passing/summary") return { passing_summary: [{ franchise_id: 260, dropbacks: 60 }, { franchise_id: 260, dropbacks: 2 }] };
    throw new Error(`unexpected ${path} ${JSON.stringify(params)}`);
  });

  const run = importProspect(client, "WR", 170273, [
    { id: "g1", season_year: season, pff_game_id: 1 },
    { id: "g2", season_year: season, pff_game_id: 2 },
    { id: "g3", season_year: season, pff_game_id: 3 },
    { id: "g9", season_year: season, pff_game_id: 999 }, // not on his team's schedule
  ]);

  it("reads only the charted weeks, never the whole season", async () => {
    await run;
    const weekly = calls.filter((c) => c.path.startsWith("/v1/player/receiving/summary") || c.path.startsWith("/v1/player/offense/blocking"));
    expect(weekly.map((c) => c.params.week)).toEqual(["1,6,9", "1,6,9"]);
    expect(calls.every((c) => c.path === "/v1/teams" || c.params.week != null)).toBe(true);
  });

  it("stores one row per charted game PFF has, and says why the others are missing", async () => {
    const imp = await run;
    expect(imp.games.map((g) => [g.gameId, g.week, g.stats.routes, g.stats.rec_yards, g.stats.snaps])).toEqual([
      ["g1", 1, 17, 49, 46],
      ["g2", 6, 30, 120, 50],
    ]);
    expect(imp.games[0].raw).toHaveProperty("receiving_summary");
    expect(imp.missing.map((m) => m.gameId).sort()).toEqual(["g3", "g9"]);
    expect(imp.missing.find((m) => m.gameId === "g3")!.reason).toMatch(/no stats/);
  });

  it("asks the aggregate-only reports and team facets for the imported weeks only", async () => {
    await run;
    const after = calls.filter((c) => ["/v1/player/receiving/depth", "/v1/facet/receiving/scheme", "/v1/facet/passing/summary"].includes(c.path));
    expect(after.map((c) => c.params.week)).toEqual(["1,6", "1,6", "1,6"]);
    expect(after.filter((c) => c.path.startsWith("/v1/facet")).every((c) => c.params.franchise_id === 260 && c.params.season === season)).toBe(true);
  });

  it("builds the season row from PFF's aggregates over exactly those games", async () => {
    const imp = await run;
    expect(imp.seasons).toHaveLength(1);
    const s = imp.seasons[0];
    expect([s.season, s.pffGameIds, s.weeks, s.franchiseIds]).toEqual([season, [1, 2], [1, 6], [260]]);
    expect([s.stats.grade_offense, s.stats.grade_pass_route, s.stats.rec_adot, s.stats.grade_run_block]).toEqual([88.9, 89.6, 17, 58.5]);
    expect([s.stats.deep_targets, s.stats.man_routes, s.stats.zone_yards, s.stats.team_dropbacks]).toEqual([3, 12, 120, 62]);
  });
});

describe("importProspect (QB)", () => {
  it("reads passing, rushing and snaps per game, and play action / blitz as aggregates, with no team facets", async () => {
    const season = 2032;
    const { client, calls } = fakeClient((path) => {
      if (path === "/v1/teams") return schedule([{ id: 7, week: 4 }]);
      if (path === "/v1/player/passing/summary") return { passing_summary: { weeks: [{ game_id: 7, dropbacks: 27, completions: 21 }], week_totals: [{ grades_pass: 84 }] } };
      if (path === "/v1/player/rushing/summary") return { rushing_summary: { weeks: [{ game_id: 7, attempts: 5, scrambles: 2 }], week_totals: [{ grades_run: 64.6 }] } };
      if (path === "/v1/player/offense/summary") return { offense_summary: { weeks: [{ game_id: 7, snap_counts_total: 60 }], week_totals: [{ grades_offense: 84.2 }] } };
      if (path === "/v1/player/passing/concept") return { passing_concept: [{ pa_dropbacks: 11 }] };
      if (path === "/v1/player/passing/pressure") return { passing_pressure: [{ blitz_dropbacks: 11 }] };
      throw new Error(`unexpected ${path}`);
    });
    const imp = await importProspect(client, "QB", 158323, [{ id: "q1", season_year: season, pff_game_id: 7 }]);
    expect(calls.map((c) => c.path)).toEqual([
      "/v1/teams", "/v1/player/passing/summary", "/v1/player/rushing/summary", "/v1/player/offense/summary",
      "/v1/player/passing/concept", "/v1/player/passing/pressure",
    ]);
    expect([imp.games[0].stats.dropbacks, imp.games[0].stats.scrambles, imp.games[0].stats.snaps]).toEqual([27, 2, 60]);
    const s = imp.seasons[0].stats;
    expect([s.grade_offense, s.grade_pass, s.grade_run, s.pa_dropbacks, s.blitz_dropbacks]).toEqual([84.2, 84, 64.6, 11, 11]);
    expect(s.team_dropbacks).toBeNull();
  });

  it("treats a 404 report as no rows, and writes no season row without imported games", async () => {
    const season = 2033;
    const { PffError } = await import("@/lib/pff/client");
    const { client } = fakeClient((path) => {
      if (path === "/v1/teams") return schedule([{ id: 8, week: 2 }]);
      throw new PffError("not found", 404, "not_found");
    });
    const imp = await importProspect(client, "RB", 1, [{ id: "r1", season_year: season, pff_game_id: 8 }]);
    expect(imp.games).toEqual([]);
    expect(imp.seasons).toEqual([]);
    expect(imp.missing).toEqual([{ gameId: "r1", reason: "PFF has no stats for him in this game yet" }]);
  });
});
