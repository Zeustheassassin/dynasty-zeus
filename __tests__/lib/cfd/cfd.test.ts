// @vitest-environment node
import { describe, it, expect } from "vitest";
import { toCfdGameRow, toCfdTeamSeasonRows, toCfdVenueRow, type CfdGameRow } from "@/lib/cfd/types";
import { matchCfdGame, type CfdMatchInput } from "@/lib/cfd/match";
import { currentSeason, isStale, CURRENT_SEASON_REFRESH_MS, UNMATCHED_RETRY_MS } from "@/lib/cfd/cache";

const game = (id: number, home: string, away: string, start: string, extra: Partial<CfdGameRow> = {}): CfdGameRow => ({
  id, season: 2025, week: 1, season_type: "regular", start_date: start, start_time_tbd: false, completed: true,
  neutral_site: false, venue_id: 1, venue: "V", home_team: home, home_classification: "fbs", home_points: 30,
  away_team: away, away_classification: "fbs", away_points: 20, ...extra,
});

describe("CFD normalizers", () => {
  it("maps a /games row and drops one without teams", () => {
    expect(toCfdGameRow({
      id: 401, season: 2025, week: 3, seasonType: "regular", startDate: "2025-09-13T19:30:00.000Z", startTimeTBD: false,
      completed: true, neutralSite: false, venueId: 3504, venue: "Ohio Stadium", homeTeam: "Ohio State",
      homeClassification: "fbs", homePoints: 70, awayTeam: "Ohio", awayClassification: "fbs", awayPoints: 9,
    })).toEqual({
      id: 401, season: 2025, week: 3, season_type: "regular", start_date: "2025-09-13T19:30:00.000Z", start_time_tbd: false,
      completed: true, neutral_site: false, venue_id: 3504, venue: "Ohio Stadium", home_team: "Ohio State",
      home_classification: "fbs", home_points: 70, away_team: "Ohio", away_classification: "fbs", away_points: 9,
    });
    expect(toCfdGameRow({ id: 1, season: 2025, homeTeam: "A" })).toBeNull();
  });

  it("maps a venue", () => {
    expect(toCfdVenueRow({ id: 7, name: "Dome", latitude: 33.7, longitude: -84.4, dome: true, city: "Atlanta" }))
      .toMatchObject({ id: 7, latitude: 33.7, longitude: -84.4, dome: true, city: "Atlanta", state: null });
  });

  it("maps SP+ and drops the national averages row", () => {
    const rows = toCfdTeamSeasonRows([
      { team: "Indiana", conference: "Big Ten", rating: 32.4, ranking: 1, offense: { rating: 40.8 }, defense: { rating: 9.9, ranking: 2 } },
      { team: "nationalAverages", rating: 0.7, offense: { rating: 27 }, defense: { rating: 27 } },
    ], 2025);
    expect(rows).toEqual([{ season: 2025, school: "Indiana", conference: "Big Ten", sp_rating: 32.4, sp_offense: 40.8, sp_defense: 9.9, sp_ranking: 1, sp_defense_ranking: 2 }]);
  });
});

describe("matchCfdGame", () => {
  const season = [
    game(1, "Ohio State", "Michigan", "2025-11-29T17:00:00Z"),
    game(2, "Michigan", "Ohio State", "2025-12-06T20:00:00Z", { season_type: "regular", neutral_site: true }), // title-game rematch
    game(3, "Ohio State", "Youngstown State", "2025-09-06T16:00:00Z", { away_classification: "fcs" }),
    game(4, "Michigan State", "Iowa", "2025-11-15T17:00:00Z"),
  ];
  const base: CfdMatchInput = { season: 2025, chartedOpponentSchool: "Michigan", chartedPostseason: false, teamSchool: "Ohio State", pff: null };

  it("takes the PFF game's teams and kickoff, so a rematch is told apart by date", () => {
    const m = matchCfdGame({ ...base, pff: { homeSchool: "Michigan", awaySchool: "Ohio State", start: "2025-12-06T20:00:00Z" } }, season);
    expect(m).toMatchObject({ status: "auto", cfdGameId: 2, teamSchool: "Ohio State", opponentSchool: "Michigan" });
  });

  it("uses the PFF game's opponent even when the charted one is wrong", () => {
    const m = matchCfdGame({
      ...base, teamSchool: "Iowa", chartedOpponentSchool: "Mississippi State",
      pff: { homeSchool: "Michigan State", awaySchool: "Iowa", start: "2025-11-15T17:00:00Z" },
    }, season);
    expect(m).toMatchObject({ cfdGameId: 4, teamSchool: "Iowa", opponentSchool: "Michigan State" });
  });

  it("falls back to the known team's game that day when PFF's other team isn't a CFD name", () => {
    const m = matchCfdGame({ ...base, chartedOpponentSchool: null, pff: { homeSchool: "Ohio State", awaySchool: null, start: "2025-09-06T16:00:00Z" } }, season);
    expect(m).toMatchObject({ status: "auto", cfdGameId: 3, opponentSchool: "Youngstown State" });
  });

  it("without PFF: one meeting matches, a rematch needs its label", () => {
    expect(matchCfdGame({ ...base, chartedOpponentSchool: "Youngstown State" }, season)).toMatchObject({ status: "auto", cfdGameId: 3 });
    expect(matchCfdGame(base, season)).toMatchObject({ status: "no_match" });
    const post = [season[0], { ...season[1], season_type: "postseason" }];
    expect(matchCfdGame({ ...base, chartedPostseason: true }, post)).toMatchObject({ status: "auto", cfdGameId: 2 });
    expect(matchCfdGame(base, post)).toMatchObject({ status: "auto", cfdGameId: 1 });
  });

  it("says why it can't match", () => {
    expect(matchCfdGame({ ...base, season: 2030 }, season).note).toMatch(/No CollegeFootballData schedule/);
    expect(matchCfdGame({ ...base, chartedOpponentSchool: null }, season).note).toMatch(/isn't a recognized team/);
    expect(matchCfdGame({ ...base, teamSchool: null }, season).note).toMatch(/His team/);
  });
});

describe("CFD cache staleness", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  it("knows the season being played", () => {
    expect(currentSeason(now)).toBe(2026);
    expect(currentSeason(Date.parse("2027-01-10T00:00:00Z"))).toBe(2026);
    expect(currentSeason(Date.parse("2027-08-20T00:00:00Z"))).toBe(2027);
  });
  it("fetches a finished season once; refreshes the current one weekly, or daily when a game wasn't found", () => {
    expect(isStale(2025, null, now)).toBe(true);
    expect(isStale(2025, now - 400 * 86_400_000, now)).toBe(false);
    expect(isStale(2026, now - CURRENT_SEASON_REFRESH_MS + 1000, now)).toBe(false);
    expect(isStale(2026, now - CURRENT_SEASON_REFRESH_MS - 1000, now)).toBe(true);
    expect(isStale(2026, now - UNMATCHED_RETRY_MS - 1000, now)).toBe(false);
    expect(isStale(2026, now - UNMATCHED_RETRY_MS - 1000, now, { unmatched: true })).toBe(true);
  });
});
