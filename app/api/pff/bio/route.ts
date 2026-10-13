// POST /api/pff/bio  { prospectIds: string[] }  (Authorization: Bearer <access token>)
//
// PFF's height, weight, birthday and eligible-thru year (the last draft he
// can enter) for a few of the caller's prospects, next to what they have on
// file, for the Roster sheet's "Fill from PFF" review (lib/scouting/pffBio.ts
// decides the changes; the sheet saves the ones the user keeps, under their
// own RLS). Read-only: nothing is written here. Needs migration 071.
// One PFF read per prospect with a sure link (auto or confirmed); the rest
// cost nothing and come back with why. PFF's per-minute budget is paced in
// the client; when it runs out, the rest of the batch comes back "Not
// reached" with retryAfterMs, as /api/pff/match does.

import { NextRequest, NextResponse } from "next/server";
import { apiError } from "../../../../lib/apiHelpers";
import { logger } from "../../../../lib/logger";
import { PFF_BIO_BATCH, type PffBioResponse, type PffBioResult } from "../../../../lib/pff/api";
import { getPffClient, PffError } from "../../../../lib/pff/client";
import { getPlayer } from "../../../../lib/pff/ncaa";
import { checkRateLimit } from "../../../../lib/rateLimit";
import { readPffBio } from "../../../../lib/scouting/pffBio";
import { requireUser } from "../../../../lib/server/requireUser";
import type { PffPlayerMatchStatus } from "../../../../lib/types";

export const maxDuration = 300;

const log = logger("api/pff/bio");

// Start no new read after this long, so one in flight (which may wait out a
// PFF budget reset) still finishes inside maxDuration.
const TIME_BUDGET_MS = 230_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_REACHED = "Not reached this batch; run again";

const MIGRATION_HINT = "Apply migration 071 (supabase/migrations/071_prospect_eligible_thru.sql) first.";

const UNLINKED_NOTE: Record<string, string> = {
  review: "His PFF match is waiting on you in PFF Links",
  not_found: "Not found in PFF",
  none: "You marked him as not in PFF",
};

interface ProspectRow {
  id: string;
  name: string;
  height: string | null;
  weight: number | null;
  birthday: string | null;
  eligible_thru_year: number | null;
  pff_player_id: number | null;
  pff_match_status: PffPlayerMatchStatus | null;
}

export async function POST(req: NextRequest) {
  const rl = await checkRateLimit(req, 30, 60_000, "pff-bio");
  if (!rl.allowed) return rl.response;

  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { supabase } = auth;

  const client = getPffClient();
  if (!client) return apiError("PFF_API_KEY not configured", 500, "MISSING_PFF_KEY");

  const body = (await req.json().catch(() => null)) as { prospectIds?: unknown } | null;
  const ids = Array.isArray(body?.prospectIds) ? body.prospectIds : null;
  if (!ids || ids.length === 0 || ids.length > PFF_BIO_BATCH || !ids.every((id) => typeof id === "string" && UUID_RE.test(id))) {
    return apiError(`prospectIds must be 1–${PFF_BIO_BATCH} prospect ids`, 400, "INVALID_PROSPECTS");
  }

  // The caller's own rows only (RLS); ids that aren't theirs just don't come back.
  const { data, error } = await supabase.from("prospects")
    .select("id,name,height,weight,birthday,eligible_thru_year,pff_player_id,pff_match_status")
    .in("id", ids);
  if (error) {
    log.error("load failed", { err: error.message, code: error.code });
    return apiError(error.code === "42703" ? MIGRATION_HINT : error.message, 500, "DB_ERROR");
  }

  const started = Date.now();
  const results: PffBioResult[] = [];
  let retryAfterMs: number | null = null;

  for (const p of (data ?? []) as ProspectRow[]) {
    const base = {
      prospectId: p.id,
      name: p.name,
      current: { height: p.height ?? "", weight: p.weight, birthday: p.birthday, eligibleThru: p.eligible_thru_year },
      pff: null,
    };
    const status = p.pff_match_status ?? "";
    if (p.pff_player_id == null || (status !== "auto" && status !== "confirmed")) {
      results.push({ ...base, note: UNLINKED_NOTE[status] ?? "Not linked to PFF yet" });
      continue;
    }
    if (retryAfterMs != null || Date.now() - started > TIME_BUDGET_MS) {
      results.push({ ...base, error: NOT_REACHED });
      continue;
    }
    try {
      const player = await getPlayer(client, p.pff_player_id);
      results.push(player
        ? { ...base, pff: readPffBio(player) }
        : { ...base, note: `PFF has no player ${p.pff_player_id} (his link); re-check him in PFF Links` });
    } catch (err) {
      if (err instanceof PffError && err.status === 429) {
        retryAfterMs = err.retryAfterMs ?? 60_000;
        results.push({ ...base, error: NOT_REACHED });
        continue;
      }
      if (err instanceof PffError && (err.status === 401 || err.status === 403)) {
        log.error("PFF refused the key", { status: err.status, code: err.code });
        return apiError(`PFF refused the API key (${err.code ?? err.status})`, 502, "PFF_AUTH");
      }
      log.error("PFF read failed", { prospectId: p.id, err: String(err) });
      results.push({ ...base, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json<PffBioResponse>({ results, retryAfterMs });
}
