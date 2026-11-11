// POST /api/pff/qb-pocket  { season }  (Authorization: Bearer <access token>)
//
// Fills PFF's time-in-pocket row (migration 093) into the caller's QB season
// rows (prospect_season_pff_depth, migration 092) for ONE season. PFF's report
// comes only league-wide (~1,300 passers, ~2.5 MB) and takes 10–65 s, so it's
// one read per request with a long timeout (getSlowPffClient), never inside
// the per-prospect import (that ran past the default 20 s timeout and failed
// whole batches on 2026-11-10). The PFF Links panel's Refresh QB stats runs the
// import first, then this once per season its QBs have. Written as the caller
// under their own RLS; a refresh overwrites.

import { NextRequest, NextResponse } from "next/server";
import { apiError } from "../../../../lib/apiHelpers";
import { logger } from "../../../../lib/logger";
import type { QbPocketResponse } from "../../../../lib/pff/api";
import { getSlowPffClient, PffError } from "../../../../lib/pff/client";
import { leagueTimeInPocket } from "../../../../lib/pff/ncaa";
import { checkRateLimit } from "../../../../lib/rateLimit";
import { requireUser } from "../../../../lib/server/requireUser";

export const maxDuration = 300;

const log = logger("api/pff/qb-pocket");

export async function POST(req: NextRequest) {
  const rl = await checkRateLimit(req, 20, 60_000, "pff-qb-pocket");
  if (!rl.allowed) return rl.response;

  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { supabase } = auth;

  const client = getSlowPffClient();
  if (!client) return apiError("PFF_API_KEY not configured", 500, "MISSING_PFF_KEY");

  const body = (await req.json().catch(() => null)) as { season?: unknown } | null;
  const season = typeof body?.season === "number" && Number.isInteger(body.season) ? body.season : null;
  if (season == null || season < 2008 || season > 2100) return apiError("season must be a year", 400, "INVALID_SEASON");

  const { data, error } = await supabase.from("prospect_season_pff_depth").select("prospect_id,pff_player_id").eq("season", season);
  if (error) {
    log.error("load failed", { err: error.message, code: error.code });
    return apiError(error.message, 500, "DB_ERROR");
  }
  const rows = (data ?? []) as { prospect_id: string; pff_player_id: number }[];
  if (rows.length === 0) return NextResponse.json<QbPocketResponse>({ season, updated: 0, missing: 0, retryAfterMs: null });

  let league: Map<number, Record<string, unknown>>;
  try {
    league = new Map((await leagueTimeInPocket(client, season)).map((r) => [Number(r.player_id), r]));
  } catch (err) {
    if (err instanceof PffError && err.status === 429) {
      return NextResponse.json<QbPocketResponse>({ season, updated: 0, missing: 0, retryAfterMs: err.retryAfterMs ?? 60_000 });
    }
    if (err instanceof PffError && (err.status === 401 || err.status === 403)) {
      return apiError(`PFF refused the API key (${err.code ?? err.status})`, 502, "PFF_AUTH");
    }
    log.error("PFF read failed", { season, err: String(err) });
    return apiError(`PFF's time-in-pocket report for ${season} failed: ${err instanceof Error ? err.message : String(err)}`, 502, "PFF_READ");
  }

  let updated = 0, missing = 0;
  const errors: string[] = [];
  for (const r of rows) {
    const pocket = league.get(r.pff_player_id) ?? null;
    if (!pocket) missing++;
    const { error: upErr } = await supabase.from("prospect_season_pff_depth")
      .update({ pocket }).eq("prospect_id", r.prospect_id).eq("season", season);
    if (upErr) errors.push(upErr.message);
    else if (pocket) updated++;
  }
  if (errors.length) {
    log.error("pocket save failed", { season, errors: errors.slice(0, 3) });
    return apiError(`Couldn't save pocket times: ${errors[0]}`, 500, "DB_ERROR");
  }
  return NextResponse.json<QbPocketResponse>({ season, updated, missing, retryAfterMs: null });
}
