// GET /api/pff/games?playerId=…&season=…  (Authorization: Bearer <access token>)
//
// One PFF player's games in a season (his own log, so transfers are right),
// for the Scouting → PFF Links panel when the user picks the PFF game for a
// charted game by hand. Signed-in users only (PFF read budget).

import { NextRequest, NextResponse } from "next/server";
import { apiError, parseIntParam } from "../../../../lib/apiHelpers";
import { logger } from "../../../../lib/logger";
import type { PffGameOption } from "../../../../lib/pff/api";
import { getPffClient } from "../../../../lib/pff/client";
import { hisGames } from "../../../../lib/pff/match";
import { offenseWeeks, seasonTeams } from "../../../../lib/pff/ncaa";
import { checkRateLimit } from "../../../../lib/rateLimit";
import { requireUser } from "../../../../lib/server/requireUser";

const log = logger("api/pff/games");

export async function GET(req: NextRequest) {
  const rl = await checkRateLimit(req, 30, 60_000, "pff-games");
  if (!rl.allowed) return rl.response;

  const playerId = parseIntParam(req.nextUrl.searchParams.get("playerId"), 1, 10_000_000);
  const season = parseIntParam(req.nextUrl.searchParams.get("season"), 2008, new Date().getFullYear() + 1);
  if (playerId == null || season == null) return apiError("playerId and season are required", 400, "INVALID_PARAMS");

  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const client = getPffClient();
  if (!client) return apiError("PFF_API_KEY not configured", 500, "MISSING_PFF_KEY");

  try {
    const [teams, rows] = await Promise.all([seasonTeams(client, season), offenseWeeks(client, playerId, season)]);
    const games: PffGameOption[] = hisGames(rows, season, teams.teams, teams.games)
      .sort((a, b) => a.start.localeCompare(b.start) || a.week - b.week)
      .map((h) => ({ pffGameId: h.pffGameId, week: h.week, start: h.start, opponent: h.opponent?.city ?? `team ${h.opponentId}` }));
    return NextResponse.json({ games });
  } catch (err) {
    log.error("game log failed", { playerId, season, err: String(err) });
    return apiError("PFF game log failed", 502, "PFF_ERROR");
  }
}
