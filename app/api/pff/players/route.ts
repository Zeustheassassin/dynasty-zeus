// GET /api/pff/players?name=…  (Authorization: Bearer <access token>)
//
// PFF NCAA directory search for the Scouting → PFF Links panel, when the user
// picks a different player than the matcher did. Signed-in users only, since
// every call spends the PFF account's read budget.

import { NextRequest, NextResponse } from "next/server";
import { apiError } from "../../../../lib/apiHelpers";
import { logger } from "../../../../lib/logger";
import type { PffCandidate } from "../../../../lib/pff/api";
import { getPffClient } from "../../../../lib/pff/client";
import { searchPlayers } from "../../../../lib/pff/ncaa";
import { checkRateLimit } from "../../../../lib/rateLimit";
import { requireUser } from "../../../../lib/server/requireUser";

const log = logger("api/pff/players");

export async function GET(req: NextRequest) {
  const rl = await checkRateLimit(req, 30, 60_000, "pff-players");
  if (!rl.allowed) return rl.response;

  const name = req.nextUrl.searchParams.get("name")?.trim() ?? "";
  if (name.length < 2 || name.length > 80) return apiError("name must be 2–80 characters", 400, "INVALID_NAME");

  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const client = getPffClient();
  if (!client) return apiError("PFF_API_KEY not configured", 500, "MISSING_PFF_KEY");

  try {
    const players: PffCandidate[] = (await searchPlayers(client, name)).map((p) => ({
      id: p.id,
      name: `${p.first_name} ${p.last_name}`,
      position: p.position,
      team: p.team?.city ?? null,
      dob: p.dob,
      height: p.height ? `${Math.floor(p.height / 100)}'${p.height % 100}"` : null,
      weight: p.weight,
      currentClass: p.current_class,
    }));
    return NextResponse.json({ players });
  } catch (err) {
    log.error("search failed", { err: String(err) });
    return apiError("PFF search failed", 502, "PFF_ERROR");
  }
}
