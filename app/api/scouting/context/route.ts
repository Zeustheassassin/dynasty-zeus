// POST /api/scouting/context  { prospectIds: string[] }  (Authorization: Bearer <access token>)
//
// Fills the automatic game context for a few of the caller's prospects
// (tape-grading expansion, Stage 5): each charted game's CollegeFootballData
// game (venue, kickoff, opponent), its weather (Open-Meteo archive) and his
// supporting cast (PFF's offense facet for that game). The shared CFD cache is
// refreshed only when stale (lib/cfd/cache.ts); the per-user rows
// (scouting_game_context, pff_game_offense) are written as the caller under
// their own RLS. The Scouting → PFF Links panel calls it in small batches,
// after matching and imports and when it opens; PFF's per-minute read budget
// is paced inside the client.

import { NextRequest, NextResponse } from "next/server";
import { apiError } from "../../../../lib/apiHelpers";
import { getCfdReader } from "../../../../lib/cfd/client";
import { CONTEXT_FILL_BATCH, type ContextFillResponse } from "../../../../lib/gameContext/api";
import { fillGameContext } from "../../../../lib/gameContext/runContext";
import { logger } from "../../../../lib/logger";
import { getPffClient, PffError } from "../../../../lib/pff/client";
import { checkRateLimit } from "../../../../lib/rateLimit";
import { requireUser } from "../../../../lib/server/requireUser";

export const maxDuration = 300;

const log = logger("api/scouting/context");

// Start no new PFF read after this long, so a run that waits out a PFF budget
// reset still finishes inside maxDuration.
const TIME_BUDGET_MS = 200_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIGRATION_HINT = "Apply migration 065 (supabase/migrations/065_game_context.sql) first.";

// PostgREST reports a table that doesn't exist yet as PGRST205 (or 42P01).
const missingTable = (msg: string) => /PGRST205|42P01|cfd_|scouting_game_context|pff_game_offense/.test(msg) && /exist|schema cache|relation/i.test(msg);

export async function POST(req: NextRequest) {
  const rl = await checkRateLimit(req, 30, 60_000, "scouting-context");
  if (!rl.allowed) return rl.response;

  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { supabase, user } = auth;

  const body = (await req.json().catch(() => null)) as { prospectIds?: unknown } | null;
  const ids = Array.isArray(body?.prospectIds) ? body.prospectIds : null;
  if (!ids || ids.length === 0 || ids.length > CONTEXT_FILL_BATCH || !ids.every((id) => typeof id === "string" && UUID_RE.test(id))) {
    return apiError(`prospectIds must be 1–${CONTEXT_FILL_BATCH} prospect ids`, 400, "INVALID_PROSPECTS");
  }

  try {
    const run = await fillGameContext({
      supabase, userId: user.id, pff: getPffClient(), cfd: getCfdReader(),
      deadline: Date.now() + TIME_BUDGET_MS,
    }, ids as string[]);
    if (run.cfdFetched.length) log.info("CollegeFootballData lists fetched", { lists: run.cfdFetched, remaining: run.cfdRemaining });
    return NextResponse.json<ContextFillResponse>({ ...run, retryAfterMs: null });
  } catch (err) {
    if (err instanceof PffError && err.status === 429) {
      return NextResponse.json<ContextFillResponse>({
        results: (ids as string[]).map((id) => ({ prospectId: id, games: 0, error: "Not reached this batch; run again" })),
        cfdFetched: [], cfdRemaining: null, retryAfterMs: err.retryAfterMs ?? 60_000,
      });
    }
    const msg = err instanceof Error ? err.message : String(err);
    log.error("context fill failed", { err: msg });
    return apiError(missingTable(msg) ? MIGRATION_HINT : msg, 500, missingTable(msg) ? "MIGRATION_MISSING" : "CONTEXT_FAILED");
  }
}
