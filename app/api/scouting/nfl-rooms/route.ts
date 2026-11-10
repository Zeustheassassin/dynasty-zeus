// POST /api/scouting/nfl-rooms  { year }  (Authorization: Bearer <access token>)
//
// Every NFL team's QB / RB / WR / TE room on PFF's live depth chart, with the
// prior season's grades, snap shares and pass rates (lib/pff/nflRooms.ts), for
// the Big Board's Post-Draft tab. Nothing is stored here: the tab saves each
// drafted prospect's own room on his row (prospects.landing_inputs, migration
// 091), under the user's RLS. About 35 PFF reads per call, so signed-in users
// only and a tight rate limit.

import { NextRequest, NextResponse } from "next/server";
import { apiError } from "../../../../lib/apiHelpers";
import { logger } from "../../../../lib/logger";
import type { NflRoomsResponse } from "../../../../lib/nflRooms";
import { getPffClient, PffError } from "../../../../lib/pff/client";
import { loadNflRooms } from "../../../../lib/pff/nflRooms";
import { checkRateLimit } from "../../../../lib/rateLimit";
import { requireUser } from "../../../../lib/server/requireUser";

export const maxDuration = 300;

const log = logger("api/scouting/nfl-rooms");

export async function POST(req: NextRequest) {
  const rl = await checkRateLimit(req, 3, 60_000, "scouting-nfl-rooms");
  if (!rl.allowed) return rl.response;

  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => null)) as { year?: unknown } | null;
  const year = body?.year;
  const thisYear = new Date().getUTCFullYear();
  if (typeof year !== "number" || !Number.isInteger(year) || year < 2000 || year > thisYear) {
    return apiError(`year must be a draft year from 2000 to ${thisYear}`, 400, "INVALID_YEAR");
  }

  const client = getPffClient();
  if (!client) return apiError("PFF_API_KEY not configured", 500, "MISSING_PFF_KEY");

  try {
    const rooms = await loadNflRooms(client, year);
    log.info("NFL rooms read from PFF", { year, teams: rooms.teams.length, missing: rooms.missing.length });
    return NextResponse.json<NflRoomsResponse>(rooms);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("NFL rooms load failed", { year, err: msg });
    if (err instanceof PffError && err.status === 429) {
      return apiError("PFF's read budget is spent for this minute; try again shortly.", 429, "PFF_RATE_LIMITED");
    }
    return apiError(msg, 502, "PFF_ERROR");
  }
}
