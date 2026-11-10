// POST /api/scouting/nfl-draft  { year }  (Authorization: Bearer <access token>)
//
// Every NFL pick of a draft year, for the Big Board's Post-Draft tab and
// Dynasty+ rookie competition. Served from the shared cfd_draft_picks cache
// (migration 090) and fetched from CollegeFootballData only when the stored
// list is unfinished (lib/cfd/draftPicks.ts). The tab then matches the picks
// to the caller's prospects and writes their round / pick / team itself.

import { NextRequest, NextResponse } from "next/server";
import { apiError } from "../../../../lib/apiHelpers";
import { getCfdReader } from "../../../../lib/cfd/client";
import { loadDraftYear } from "../../../../lib/cfd/draftPicks";
import { logger } from "../../../../lib/logger";
import type { NflDraftResponse } from "../../../../lib/nflDraft";
import { checkRateLimit } from "../../../../lib/rateLimit";
import { requireUser } from "../../../../lib/server/requireUser";

const log = logger("api/scouting/nfl-draft");
const MIGRATION_HINT = "Apply migration 090 (supabase/migrations/090_cfd_draft_picks.sql) first.";
const missingTable = (msg: string) => /PGRST205|42P01|cfd_draft_picks|cfd_fetch_log/.test(msg) && /exist|schema cache|relation/i.test(msg);

export async function POST(req: NextRequest) {
  const rl = await checkRateLimit(req, 10, 60_000, "scouting-nfl-draft");
  if (!rl.allowed) return rl.response;

  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => null)) as { year?: unknown } | null;
  const year = body?.year;
  const thisYear = new Date().getUTCFullYear();
  if (typeof year !== "number" || !Number.isInteger(year) || year < 2000 || year > thisYear) {
    return apiError(`year must be a draft year from 2000 to ${thisYear}`, 400, "INVALID_YEAR");
  }

  try {
    const run = await loadDraftYear(auth.supabase, getCfdReader(), year);
    if (run.fetched) log.info("NFL draft fetched from CollegeFootballData", { year, picks: run.picks.length, remaining: run.remaining });
    return NextResponse.json<NflDraftResponse>(run);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("NFL draft load failed", { year, err: msg });
    return apiError(missingTable(msg) ? MIGRATION_HINT : msg, 500, missingTable(msg) ? "MIGRATION_MISSING" : "DRAFT_FAILED");
  }
}
