// POST /api/pff/match  { prospectIds: string[] }  (Authorization: Bearer <access token>)
//
// Links a few of the caller's prospects to PFF players and their charted games
// to PFF games (lib/pff/runMatch.ts), and saves the result on prospects /
// scouting_games (migration 062) as the caller, under their own RLS. The
// Scouting → PFF Links panel calls it in small batches and shows progress;
// one batch is a handful of PFF reads per prospect, and PFF's per-minute read
// budget (100) is paced inside the client, so a batch can pause up to a
// minute. The user's own calls (confirmed / none) are never overwritten,
// even if they land while a batch is running.

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { apiError } from "../../../../lib/apiHelpers";
import { withConcurrency } from "../../../../lib/concurrency";
import { logger } from "../../../../lib/logger";
import { PFF_MATCH_BATCH, type PffMatchResponse, type PffMatchResult } from "../../../../lib/pff/api";
import { getPffClient, PffError } from "../../../../lib/pff/client";
import type { ChartedGame } from "../../../../lib/pff/match";
import { matchProspect, type ProspectMatch, type ProspectToMatch } from "../../../../lib/pff/runMatch";
import { checkRateLimit } from "../../../../lib/rateLimit";
import { fetchLearnedOpponentNames } from "../../../../lib/scouting/learnedOpponentNames";
import { requireUser } from "../../../../lib/server/requireUser";

export const maxDuration = 300;

const log = logger("api/pff/match");

// Start no new prospect after this long, so the one in flight (which may wait
// out a PFF budget reset) still finishes inside maxDuration.
const TIME_BUDGET_MS = 230_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Rows the user decided are left alone, including mid-batch.
const NOT_USER_DECIDED = "pff_match_status.is.null,pff_match_status.not.in.(confirmed,none)";

const MIGRATION_HINT = "Apply migration 062 (supabase/migrations/062_play_tags_and_pff_links.sql) first.";

export async function POST(req: NextRequest) {
  const rl = await checkRateLimit(req, 30, 60_000, "pff-match");
  if (!rl.allowed) return rl.response;

  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { supabase } = auth;

  const client = getPffClient();
  if (!client) return apiError("PFF_API_KEY not configured", 500, "MISSING_PFF_KEY");

  const body = (await req.json().catch(() => null)) as { prospectIds?: unknown } | null;
  const ids = Array.isArray(body?.prospectIds) ? body.prospectIds : null;
  if (!ids || ids.length === 0 || ids.length > PFF_MATCH_BATCH || !ids.every((id) => typeof id === "string" && UUID_RE.test(id))) {
    return apiError(`prospectIds must be 1–${PFF_MATCH_BATCH} prospect ids`, 400, "INVALID_PROSPECTS");
  }

  const [prospectsRes, gamesRes, snapsRes, learned] = await Promise.all([
    supabase.from("prospects").select("id,name,position,school,birthday,pff_player_id,pff_match_status").in("id", ids),
    supabase.from("scouting_games")
      .select("id,prospect_id,season_year,opponent,game_type,game_slot,created_at,pff_game_id,pff_match_status")
      .in("prospect_id", ids),
    // Plays charted per game: tells a rematch's two PFF games apart.
    supabase.from("prospect_game_snap_stats").select("game_id,snaps_charted").in("prospect_id", ids),
    // Opponent names the user taught by linking other games; without them, those names go to the user again.
    fetchLearnedOpponentNames(supabase).catch((err: unknown) => {
      log.warn("learned opponent names unavailable", { err: String(err) });
      return new Map<string, string>();
    }),
  ]);
  const loadErr = prospectsRes.error ?? gamesRes.error;
  if (loadErr) {
    log.error("load failed", { err: loadErr.message, code: loadErr.code });
    return apiError(loadErr.code === "42703" ? MIGRATION_HINT : loadErr.message, 500, "DB_ERROR");
  }
  // Without the counts, rematches just go to the user.
  if (snapsRes.error) log.warn("snap counts unavailable", { err: snapsRes.error.message });
  const snaps = new Map((snapsRes.data ?? []).map((r: { game_id: string; snaps_charted: number }) => [r.game_id, r.snaps_charted]));

  const prospects = (prospectsRes.data ?? []) as ProspectToMatch[];
  const games = ((gamesRes.data ?? []) as (ChartedGame & { prospect_id: string })[])
    .map((g) => ({ ...g, snaps_charted: snaps.get(g.id) ?? null }));
  const started = Date.now();
  const results: PffMatchResult[] = [];
  let retryAfterMs: number | null = null;

  for (const p of prospects) {
    if (retryAfterMs != null || Date.now() - started > TIME_BUDGET_MS) {
      results.push({ prospectId: p.id, error: "Not reached this batch; run again" });
      continue;
    }
    try {
      const m = await matchProspect(client, p, games.filter((g) => g.prospect_id === p.id), learned);
      const saveErr = await save(supabase, m);
      results.push({
        prospectId: p.id,
        playerStatus: m.player?.status ?? p.pff_match_status,
        playerNote: m.player?.note ?? null,
        games: m.games.reduce<Record<string, number>>((acc, g) => ({ ...acc, [g.status]: (acc[g.status] ?? 0) + 1 }), {}),
        ...(saveErr ? { error: saveErr } : {}),
      });
    } catch (err) {
      if (err instanceof PffError && err.status === 429) retryAfterMs = err.retryAfterMs ?? 60_000;
      if (err instanceof PffError && (err.status === 401 || err.status === 403)) {
        log.error("PFF refused the key", { status: err.status, code: err.code });
        return apiError(`PFF refused the API key (${err.code ?? err.status})`, 502, "PFF_AUTH");
      }
      log.error("match failed", { prospectId: p.id, err: String(err) });
      results.push({ prospectId: p.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json<PffMatchResponse>({ results, retryAfterMs });
}

/** Writes one prospect's decisions; returns an error message, or null. */
async function save(supabase: SupabaseClient, m: ProspectMatch): Promise<string | null> {
  const errors: string[] = [];
  if (m.player) {
    const { error } = await supabase.from("prospects")
      .update({ pff_player_id: m.player.playerId, pff_match_status: m.player.status, pff_match_note: m.player.note })
      .eq("id", m.prospectId)
      .or(NOT_USER_DECIDED);
    if (error) errors.push(error.message);
  }
  await withConcurrency(m.games, async (g) => {
    const { error } = await supabase.from("scouting_games")
      .update({ pff_game_id: g.pffGameId, pff_match_status: g.status, pff_match_note: g.note })
      .eq("id", g.gameId)
      .or(NOT_USER_DECIDED);
    if (error) errors.push(error.message);
  }, 6);
  if (errors.length) log.error("save failed", { prospectId: m.prospectId, errors: errors.slice(0, 3) });
  return errors.length ? `Saved with ${errors.length} error(s): ${errors[0]}` : null;
}
