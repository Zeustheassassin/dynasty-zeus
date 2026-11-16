// POST /api/scouting/forty-times  { year, position }  (Authorization: Bearer <access token>)
//
// Fill 40s on the Prospect Data sheet: one class year and position's 40s from
// both sources, the combine's official times with weigh-ins (null until that
// year's combine is out) and WalterFootball's projections
// (lib/server/fortyTimes.ts). Nothing is stored: the sheet matches the rows to
// the caller's prospects (lib/scouting/fortyFill.ts), shows what would change,
// and saves the ticked ones under the caller's own RLS. One source failing
// still returns the other.

import { NextRequest, NextResponse } from "next/server";
import { apiError } from "../../../../lib/apiHelpers";
import { logger } from "../../../../lib/logger";
import { checkRateLimit } from "../../../../lib/rateLimit";
import { isFortyPos, type FortyTimesResponse } from "../../../../lib/scouting/fortyFill";
import { fetchCombinePosition, fetchProjectedPosition } from "../../../../lib/server/fortyTimes";
import { requireUser } from "../../../../lib/server/requireUser";

const log = logger("api/scouting/forty-times");

// Two reads (one page, one CSV), each with a 20 s timeout.
export const maxDuration = 60;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function POST(req: NextRequest) {
  const rl = await checkRateLimit(req, 12, 60_000, "scouting-forty-times");
  if (!rl.allowed) return rl.response;

  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => null)) as { year?: unknown; position?: unknown } | null;
  const year = body?.year;
  const position = body?.position;
  const thisYear = new Date().getUTCFullYear();
  if (typeof year !== "number" || !Number.isInteger(year) || year < 2000 || year > thisYear + 4) {
    return apiError(`year must be a draft class from 2000 to ${thisYear + 4}`, 400, "INVALID_YEAR");
  }
  if (typeof position !== "string" || !isFortyPos(position)) {
    return apiError("position must be QB, RB, WR or TE", 400, "INVALID_POSITION");
  }

  // A class's combine is held in the spring of its draft year: nothing to read before then.
  const [combine, projected] = await Promise.allSettled([
    year <= thisYear ? fetchCombinePosition(year, position) : Promise.resolve(null),
    fetchProjectedPosition(year, position),
  ]);
  const out: FortyTimesResponse = {
    year, position,
    combine: combine.status === "fulfilled" ? combine.value : null,
    projected: projected.status === "fulfilled" ? projected.value : [],
  };
  if (combine.status === "rejected") {
    out.combineError = message(combine.reason);
    log.warn("combine 40s failed", { year, position, err: out.combineError });
  }
  if (projected.status === "rejected") {
    out.projectedError = message(projected.reason);
    log.warn("projected 40s failed", { year, position, err: out.projectedError });
  }
  return NextResponse.json<FortyTimesResponse>(out);
}
