// GET /api/nfl/situation  (Authorization: Bearer <access token>)
//
// Every NFL QB / RB / WR / TE's contract situation for the coming season and
// every team's rooms, cap and odds of new competition (lib/contractSituation.ts,
// contracts plan stage 7). Built from shared, public football data and held in
// the Data Cache for 6 hours, so it's the same for every user; the user's own
// stays / goes calls (nfl_contract_overrides, migration 097) are applied in the
// browser. Signed-in users only: a cold build spends two PFF reads.

import { NextRequest, NextResponse } from "next/server";
import { apiError } from "../../../../lib/apiHelpers";
import { logger } from "../../../../lib/logger";
import { checkRateLimit } from "../../../../lib/rateLimit";
import { requireUser } from "../../../../lib/server/requireUser";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { cachedContractSituation } from "../../../../lib/server/contractSituation";
import type { ContractSituationResponse } from "../../../../lib/contractSituation";

export const maxDuration = 60;

const log = logger("api/nfl/situation");

export async function GET(req: NextRequest) {
  const rl = await checkRateLimit(req, 20, 60_000, "nfl-situation");
  if (!rl.allowed) return rl.response;

  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  try {
    // The service role where it's configured (production); the caller's own client otherwise (nfl_contracts
    // is readable by any signed-in user, so the answer is the same).
    const situation = await cachedContractSituation(getSupabaseAdmin() ?? auth.supabase);
    return NextResponse.json<ContractSituationResponse>(situation);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("contract situation failed", { err: msg });
    return apiError(msg, 502, "SITUATION_FAILED");
  }
}
