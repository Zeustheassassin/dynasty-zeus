// POST /api/scouting/combine-sizes  { year }  (Authorization: Bearer <access token>)
//
// Measured sizes on the Prospect Data sheet: one draft year's combine heights
// and weights for every QB / RB / WR / TE, from nflverse's combine.csv (the
// file Fill 40s reads; lib/server/fortyTimes.ts). rows is null until that
// year's combine is in the file (early March of the draft year). Nothing is
// stored: the sheet matches the rows to the caller's prospects
// (lib/scouting/measuredSize.ts), shows what would change, and saves the
// ticked ones under the caller's own RLS.

import { NextRequest, NextResponse } from "next/server";
import { apiError } from "../../../../lib/apiHelpers";
import { logger } from "../../../../lib/logger";
import { checkRateLimit } from "../../../../lib/rateLimit";
import type { CombineSizesResponse } from "../../../../lib/scouting/measuredSize";
import { fetchCombineSizes } from "../../../../lib/server/fortyTimes";
import { requireUser } from "../../../../lib/server/requireUser";

const log = logger("api/scouting/combine-sizes");

// One CSV read with a 20 s timeout.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const rl = await checkRateLimit(req, 12, 60_000, "scouting-combine-sizes");
  if (!rl.allowed) return rl.response;

  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => null)) as { year?: unknown } | null;
  const year = body?.year;
  const thisYear = new Date().getUTCFullYear();
  if (typeof year !== "number" || !Number.isInteger(year) || year < 2000 || year > thisYear + 4) {
    return apiError(`year must be a draft class from 2000 to ${thisYear + 4}`, 400, "INVALID_YEAR");
  }

  // A class's combine is held in the spring of its draft year: nothing to read before then.
  if (year > thisYear) return NextResponse.json<CombineSizesResponse>({ year, rows: null });
  try {
    return NextResponse.json<CombineSizesResponse>({ year, rows: await fetchCombineSizes(year) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("combine sizes failed", { year, err: msg });
    return apiError(`The combine data couldn't be read: ${msg}`, 502, "COMBINE_READ_FAILED");
  }
}
