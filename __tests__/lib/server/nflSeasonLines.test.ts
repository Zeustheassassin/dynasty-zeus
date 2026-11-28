import { describe, it, expect, vi, beforeEach } from "vitest";
import { gzipSync } from "node:zlib";
import { MIN_SEASON_LINES, clearSeasonLinesMemo, getSeasonLines, weeklyStatsUrl } from "../../../lib/server/nflSeasonLines";
import { MIN_GAMES } from "../../../lib/helpers/positionalValue";

// Positional value per league, stage 1: the three seasons read from nflverse's
// gzipped weekly files, all or nothing, kept a day on a warm instance.

/** A season's weekly file with `players` WRs, each with MIN_GAMES games, plus one short-season WR. */
function weeklyGz(season: number, players: number): Buffer {
  const rows = ["player_id,position,season,week,season_type,receptions,receiving_yards"];
  for (let p = 0; p < players; p++) {
    for (let w = 1; w <= MIN_GAMES; w++) rows.push(`p${p},WR,${season},${w},REG,5,60`);
  }
  rows.push(`short,WR,${season},1,REG,9,150`);
  return gzipSync(rows.join("\n"));
}

const ok = (body: Buffer) => new Response(new Uint8Array(body), { status: 200 });

beforeEach(() => clearSeasonLinesMemo());

describe("getSeasonLines", () => {
  it("reads every season's gzipped file and keeps lines with MIN_GAMES+ games", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const season = Number(String(url).match(/week_(\d{4})/)![1]);
      return ok(weeklyGz(season, MIN_SEASON_LINES));
    }) as unknown as typeof fetch;
    const lines = await getSeasonLines([2024, 2025], fetchFn);
    expect(lines).toHaveLength(2 * MIN_SEASON_LINES);
    expect(lines[0]).toMatchObject({ pos: "WR", games: MIN_GAMES, stats: expect.objectContaining({ rec: 5 * MIN_GAMES }) });
    expect(vi.mocked(fetchFn).mock.calls.map((c) => c[0])).toEqual([weeklyStatsUrl(2024), weeklyStatsUrl(2025)]);
  });

  it("keeps the result a day on a warm instance", async () => {
    const fetchFn = vi.fn(async () => ok(weeklyGz(2025, MIN_SEASON_LINES))) as unknown as typeof fetch;
    const t = Date.parse("2026-11-27T12:00:00Z");
    await getSeasonLines([2025], fetchFn, t);
    await getSeasonLines([2025], fetchFn, t + 60 * 60 * 1000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await getSeasonLines([2025], fetchFn, t + 25 * 60 * 60 * 1000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("fails as a whole when a season can't be read or looks truncated", async () => {
    const missing = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("2025") ? new Response("nope", { status: 404 }) : ok(weeklyGz(2024, MIN_SEASON_LINES))) as unknown as typeof fetch;
    await expect(getSeasonLines([2024, 2025], missing)).rejects.toThrow(/2025 weekly stats answered 404/);
    const thin = vi.fn(async () => ok(weeklyGz(2025, 10))) as unknown as typeof fetch;
    await expect(getSeasonLines([2025], thin)).rejects.toThrow(/only 10 season lines/);
  });
});
