// GET /api/nfl-season-lines
//
// The last three finished NFL regular seasons as QB / RB / WR / TE season
// lines under Sleeper's stat keys (lib/helpers/nflSeasonLines.ts), for
// positional value per league on the Draft Hub's League Formats tab
// (lib/helpers/positionalValue.ts). Read from nflverse's public weekly stats
// (lib/server/nflSeasonLines.ts): no Sleeper calls, nothing personal, nothing
// stored. The browser scores the lines with each league's own rules, since
// league settings live only there. Cached a day at the CDN (the seasons only
// roll on February 1).

import { NextRequest, NextResponse } from "next/server";
import { apiError } from "../../../lib/apiHelpers";
import { logger } from "../../../lib/logger";
import { checkRateLimit } from "../../../lib/rateLimit";
import { finishedSeasons, toPayload, type SeasonLinesPayload } from "../../../lib/helpers/nflSeasonLines";
import { getSeasonLines } from "../../../lib/server/nflSeasonLines";

const log = logger("api/nfl-season-lines");

// Three ~1.2 MB downloads read side by side, each with a 30 s timeout.
export const maxDuration = 60;

const SEASON_LINES_CDN_MAX_AGE_S = 86_400;
const SEASON_LINES_CDN_STALE_S = 604_800;

export async function GET(req: NextRequest) {
  const rl = await checkRateLimit(req, 20, 60_000, "nfl-season-lines");
  if (!rl.allowed) return rl.response;

  const seasons = finishedSeasons(new Date());
  try {
    const lines = await getSeasonLines(seasons);
    return NextResponse.json<SeasonLinesPayload>(toPayload(seasons, lines), {
      headers: { "Cache-Control": `public, s-maxage=${SEASON_LINES_CDN_MAX_AGE_S}, stale-while-revalidate=${SEASON_LINES_CDN_STALE_S}` },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("season lines failed", { seasons, err: msg });
    return apiError(`The NFL season stats couldn't be read: ${msg}`, 502, "SEASON_LINES_FAILED");
  }
}
