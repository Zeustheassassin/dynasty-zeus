// ============================================================
// NFL season lines: read nflverse's weekly player stats (SERVER-ONLY)
// ============================================================
// Positional value per league (stage 1, lib/helpers/positionalValue.ts) scores
// real NFL seasons with each league's own rules. The seasons come from
// nflverse's weekly player stats, a public GitHub release (~1.2 MB gzipped per
// season), so this costs no Sleeper calls. The files are gunzipped and
// reduced here (lib/helpers/nflSeasonLines.ts) to ~1,100 QB / RB / WR / TE
// season lines for the three seasons, which /api/nfl-season-lines sends with a
// day-long CDN cache. A warm instance also keeps the result for a day, so a
// cold CDN miss reads GitHub once per instance.
// ============================================================

import { gunzipSync } from "node:zlib";
import { MIN_GAMES } from "../helpers/positionalValue";
import { seasonLinesFromWeeklyCsv, type SeasonLine } from "../helpers/nflSeasonLines";

export const weeklyStatsUrl = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv.gz`;
const USER_AGENT = "dynastyzeus-season-lines/1.0 (positional value for a private dynasty app, read on request)";
const FETCH_TIMEOUT_MS = 30_000;
/** How long a warm instance keeps the lines. */
export const SEASON_LINES_MEMO_MS = 24 * 60 * 60 * 1000;
/** Fewer lines than this in a season means a truncated or changed file (2023–25 had ~380 each), not a real season. */
export const MIN_SEASON_LINES = 200;

const memo = new Map<string, { at: number; lines: SeasonLine[] }>();

/** One season's lines (MIN_GAMES+ games). Not put in the Data Cache: the route's CDN cache holds the small result instead. */
async function fetchSeason(season: number, fetchFn: typeof fetch): Promise<SeasonLine[]> {
  const res = await fetchFn(weeklyStatsUrl(season), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/gzip" },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`nflverse ${season} weekly stats answered ${res.status}`);
  const csv = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");
  const lines = seasonLinesFromWeeklyCsv(csv, season, MIN_GAMES);
  if (lines.length < MIN_SEASON_LINES) throw new Error(`nflverse ${season} weekly stats had only ${lines.length} season lines`);
  return lines;
}

/** Every season's lines, all or nothing (a missing season would tilt the averages). */
export async function getSeasonLines(seasons: readonly number[], fetchFn: typeof fetch = fetch, now = Date.now()): Promise<SeasonLine[]> {
  const key = seasons.join(",");
  const hit = memo.get(key);
  if (hit && now - hit.at < SEASON_LINES_MEMO_MS) return hit.lines;
  const lines = (await Promise.all(seasons.map((s) => fetchSeason(s, fetchFn)))).flat();
  memo.set(key, { at: now, lines });
  return lines;
}

/** Tests only. */
export function clearSeasonLinesMemo(): void {
  memo.clear();
}
