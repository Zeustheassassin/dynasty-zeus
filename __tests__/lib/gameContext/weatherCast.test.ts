// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  archiveReady, archiveUrl, kickoffMs, summarizeWindow, windowDates, weatherCodeLabel, type HourlyWeather,
} from "@/lib/weather/openMeteo";
import { isLineman, teamCast, trimOffenseRows } from "@/lib/pff/cast";
import { fillWeather } from "@/lib/gameContext/runContext";
import type { CfdGameWithWeather } from "@/lib/cfd/types";

const hours = (start: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(start) + i * 3_600_000).toISOString().slice(0, 16));

describe("Open-Meteo game-window weather", () => {
  const hourly: HourlyWeather = {
    time: hours("2025-11-29T00:00:00Z", 48),
    temperature_2m: Array.from({ length: 48 }, (_, i) => 30 + i),
    wind_speed_10m: Array.from({ length: 48 }, () => 10),
    wind_gusts_10m: Array.from({ length: 48 }, (_, i) => (i === 18 ? 31 : 20)),
    precipitation: Array.from({ length: 48 }, (_, i) => (i >= 17 && i <= 20 ? 0.1 : 0)),
    snowfall: Array.from({ length: 48 }, () => 0),
    relative_humidity_2m: Array.from({ length: 48 }, () => 80),
    weather_code: Array.from({ length: 48 }, (_, i) => (i === 19 ? 63 : 3)),
  };

  it("averages the kickoff hour and three more; sums rain; takes the worst gust and code", () => {
    const s = summarizeWindow(hourly, Date.parse("2025-11-29T17:30:00Z"))!;
    expect(s).toEqual({ temperature_f: 48.5, wind_mph: 10, humidity: 80, gust_mph: 31, precip_in: 0.4, snow_in: 0, weather_code: 63 });
    expect(weatherCodeLabel(s.weather_code)).toBe("Rain");
  });

  it("returns null when the archive doesn't cover the window yet", () => {
    const late = { ...hourly, temperature_2m: hourly.temperature_2m!.map((v, i) => (i === 19 ? null : v)) };
    expect(summarizeWindow(late, Date.parse("2025-11-29T17:00:00Z"))).toBeNull();
    expect(summarizeWindow(undefined, Date.parse("2025-11-29T17:00:00Z"))).toBeNull();
    expect(summarizeWindow(hourly, Date.parse("2025-11-30T22:00:00Z"))).toBeNull(); // runs past the series
  });

  it("reads a TBD kickoff at 18:00 UTC and spans midnight when it must", () => {
    expect(new Date(kickoffMs("2025-09-06T04:00:00.000Z", true)!).toISOString()).toBe("2025-09-06T18:00:00.000Z");
    expect(kickoffMs("not a date", false)).toBeNull();
    expect(windowDates(Date.parse("2025-09-07T02:30:00Z"))).toEqual({ start: "2025-09-07", end: "2025-09-07" });
    expect(windowDates(Date.parse("2025-09-06T23:30:00Z"))).toEqual({ start: "2025-09-06", end: "2025-09-07" });
  });

  it("waits out the archive's lag and asks in the app's units", () => {
    const k = Date.parse("2026-10-01T18:00:00Z");
    expect(archiveReady(k, k + 5 * 86_400_000)).toBe(false);
    expect(archiveReady(k, k + 6 * 86_400_000)).toBe(true);
    const u = new URL(archiveUrl([{ latitude: 40.00123, longitude: -83.01987 }, { latitude: 33, longitude: -84 }], "2025-09-06", "2025-09-07"));
    expect(u.searchParams.get("latitude")).toBe("40.0012,33");
    expect(u.searchParams.get("temperature_unit")).toBe("fahrenheit");
    expect(u.searchParams.get("wind_speed_unit")).toBe("mph");
    expect(u.searchParams.get("timezone")).toBe("GMT");
  });
});

describe("fillWeather", () => {
  const g = (id: number, venue: number | null, start: string, status: CfdGameWithWeather["weather_status"] = null): CfdGameWithWeather => ({
    id, season: 2025, week: 1, season_type: "regular", start_date: start, start_time_tbd: false, completed: true, neutral_site: false,
    venue_id: venue, venue: null, home_team: "A", home_classification: "fbs", home_points: 1, away_team: "B", away_classification: "fbs", away_points: 0,
    weather_status: status,
  });
  const venues = new Map([
    [1, { latitude: 40, longitude: -83, dome: false }],
    [2, { latitude: 33, longitude: -84, dome: true }],
    [3, { latitude: null, longitude: null, dome: false }],
  ]);
  const now = Date.parse("2026-10-05T12:00:00Z");

  it("skips domes, marks missing venues and recent games, and reads the rest in one request per window", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      const time = hours("2025-09-06T00:00:00Z", 48);
      const flat = (v: number) => time.map(() => v);
      return new Response(JSON.stringify([{ hourly: { time, temperature_2m: flat(70), wind_speed_10m: flat(5), precipitation: flat(0), snowfall: flat(0) } }]));
    }) as unknown as typeof fetch;
    const out = await fillWeather([
      g(10, 1, "2025-09-06T17:00:00Z"),
      g(11, 2, "2025-09-06T17:00:00Z"),
      g(12, 3, "2025-09-06T17:00:00Z"),
      g(13, 1, "2026-10-03T17:00:00Z"),
      g(14, 1, "2025-09-06T17:00:00Z", "ok"),
    ], venues, now, fetchImpl);
    const by = new Map(out.map((u) => [u.id, u.patch]));
    expect(by.get(10)).toMatchObject({ weather_status: "ok", temperature_f: 70, wind_mph: 5 });
    expect(by.get(11)).toMatchObject({ weather_status: "dome" });
    expect(by.get(12)).toMatchObject({ weather_status: "no_location" });
    expect(by.get(13)).toMatchObject({ weather_status: "pending" });
    expect(by.has(14)).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("leaves a game pending when the archive call fails", async () => {
    const fetchImpl = (async () => new Response("down", { status: 500 })) as unknown as typeof fetch;
    expect(await fillWeather([g(10, 1, "2025-09-06T17:00:00Z")], venues, now, fetchImpl)).toEqual([]);
  });
});

describe("supporting cast from PFF's game facet", () => {
  const raw = [
    { player_id: 1, player: "Left Tackle", position: "LT", franchise_id: 260, snap_counts_total: 60, snap_counts_pass_block: 30, grades_pass_block: 80, snap_counts_run_block: 30, grades_run_block: 60 },
    { player_id: 2, player: "Center", position: "C", franchise_id: 260, snap_counts_total: 62, snap_counts_pass_block: 30, grades_pass_block: 60, snap_counts_run_block: 30, grades_run_block: 70 },
    { player_id: 3, player: "Backup Guard", position: "RG", franchise_id: 260, snap_counts_total: 4, snap_counts_pass_block: 4, grades_pass_block: 0, snap_counts_run_block: 0 },
    { player_id: 4, player: "Starter QB", position: "QB", franchise_id: 260, snap_counts_total: 60, snap_counts_pass: 34, grades_pass: 72.3 },
    { player_id: 5, player: "Backup QB", position: "QB", franchise_id: 260, snap_counts_total: 2, snap_counts_pass: 2, grades_pass: 50 },
    { player_id: 6, player: "Their QB", position: "QB", franchise_id: 311, snap_counts_total: 70, snap_counts_pass: 40, grades_pass: 90 },
    { player: "No id", position: "WR", franchise_id: 260 },
  ];
  const rows = trimOffenseRows(raw);

  it("keeps players with an id and a team", () => {
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ id: 1, pos: "LT", team: 260, pb: 30, g_pb: 80, rb: 30, g_rb: 60 });
  });

  it("knows the linemen's game spots", () => {
    expect(["LT", "LG", "C", "RG", "RT", "T", "G", "OL"].every(isLineman)).toBe(true);
    expect(["TE-L", "QB", "HB", "LWR"].some(isLineman)).toBe(false);
  });

  it("weights the line's grades by snaps (a 0 on a few snaps is PFF's ungraded), takes his QB, and the team's snaps", () => {
    expect(teamCast(rows, 260)).toEqual({
      teamSnaps: 62, olPassBlock: 70, olPassBlockSnaps: 60, olRunBlock: 65, olRunBlockSnaps: 60,
      qbPassGrade: 72.3, qbName: "Starter QB", qbPlayerId: 4, qbDropbacks: 34,
    });
  });

  it("never names the prospect as his own QB", () => {
    expect(teamCast(rows, 260, 4)).toMatchObject({ qbPlayerId: 5, qbPassGrade: 50 });
  });
});
