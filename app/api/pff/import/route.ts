// POST /api/pff/import  { prospectIds: string[] }  (Authorization: Bearer <access token>)
//
// Imports PFF's stats for a few of the caller's prospects: one row per
// matched charted game (prospect_game_pff) and PFF's aggregate over exactly
// the charted weeks of each season (prospect_season_pff), both migration 063,
// written as the caller under their own RLS. Only games linked auto /
// confirmed in Stage 1 are read; PFF season totals never are. The Scouting →
// PFF Links panel and each charting board's Games tab call it in small
// batches; PFF's per-minute read budget (100) is paced inside the client, so
// a batch can pause up to a minute. A refresh re-reads and overwrites.

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { apiError } from "../../../../lib/apiHelpers";
import { logger } from "../../../../lib/logger";
import { PFF_IMPORT_BATCH, type PffImportResponse, type PffImportResult } from "../../../../lib/pff/api";
import { getPffClient, PffError } from "../../../../lib/pff/client";
import { importProspect, type GameToImport, type ProspectImport } from "../../../../lib/pff/runImport";
import { GAME_AVERAGE_KEYS, GAME_STAT_KEYS, SEASON_AVERAGE_KEYS, SEASON_STAT_KEYS, pffPos } from "../../../../lib/pff/stats";
import { checkRateLimit } from "../../../../lib/rateLimit";
import { requireUser } from "../../../../lib/server/requireUser";

export const maxDuration = 300;

const log = logger("api/pff/import");

// Start no new prospect after this long, so the one in flight (which may wait
// out a PFF budget reset) still finishes inside maxDuration.
const TIME_BUDGET_MS = 230_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINKED = new Set(["auto", "confirmed"]);
const MIGRATION_HINT = "Apply migration 063 (supabase/migrations/063_pff_game_stats.sql) first.";

interface ProspectRow { id: string; position: string; pff_player_id: number | null; pff_match_status: string | null }
interface GameRow extends GameToImport { prospect_id: string; pff_match_status: string | null }

export async function POST(req: NextRequest) {
  const rl = await checkRateLimit(req, 30, 60_000, "pff-import");
  if (!rl.allowed) return rl.response;

  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const { supabase, user } = auth;

  const client = getPffClient();
  if (!client) return apiError("PFF_API_KEY not configured", 500, "MISSING_PFF_KEY");

  const body = (await req.json().catch(() => null)) as { prospectIds?: unknown } | null;
  const ids = Array.isArray(body?.prospectIds) ? body.prospectIds : null;
  if (!ids || ids.length === 0 || ids.length > PFF_IMPORT_BATCH || !ids.every((id) => typeof id === "string" && UUID_RE.test(id))) {
    return apiError(`prospectIds must be 1–${PFF_IMPORT_BATCH} prospect ids`, 400, "INVALID_PROSPECTS");
  }

  const [prospectsRes, gamesRes] = await Promise.all([
    supabase.from("prospects").select("id,position,pff_player_id,pff_match_status").in("id", ids),
    supabase.from("scouting_games").select("id,prospect_id,season_year,pff_game_id,pff_match_status").in("prospect_id", ids),
  ]);
  const loadErr = prospectsRes.error ?? gamesRes.error;
  if (loadErr) {
    log.error("load failed", { err: loadErr.message, code: loadErr.code });
    return apiError(loadErr.message, 500, "DB_ERROR");
  }
  const prospects = (prospectsRes.data ?? []) as ProspectRow[];
  const games = (gamesRes.data ?? []) as GameRow[];

  const started = Date.now();
  const results: PffImportResult[] = [];
  let retryAfterMs: number | null = null;

  for (const p of prospects) {
    if (retryAfterMs != null || Date.now() - started > TIME_BUDGET_MS) {
      results.push({ prospectId: p.id, error: "Not reached this batch; run again" });
      continue;
    }
    const pos = pffPos(p.position);
    if (!pos) { results.push({ prospectId: p.id, imported: 0, note: `PFF stats aren't imported for ${p.position}s` }); continue; }
    if (p.pff_player_id == null || !LINKED.has(p.pff_match_status ?? "")) {
      results.push({ prospectId: p.id, imported: 0, note: "Not linked to a PFF player" });
      continue;
    }
    const linked = games.filter((g) => g.prospect_id === p.id && g.pff_game_id != null && LINKED.has(g.pff_match_status ?? ""));
    if (linked.length === 0) { results.push({ prospectId: p.id, imported: 0, note: "No charted games linked to PFF" }); continue; }
    try {
      const imp = await importProspect(client, pos, p.pff_player_id, linked);
      const saveErr = await save(supabase, user.id, p.id, p.pff_player_id, imp);
      results.push({
        prospectId: p.id,
        imported: imp.games.length,
        seasons: imp.seasons.length,
        missing: imp.missing,
        ...(saveErr ? { error: saveErr } : {}),
      });
    } catch (err) {
      if (err instanceof PffError && err.status === 429) retryAfterMs = err.retryAfterMs ?? 60_000;
      if (err instanceof PffError && (err.status === 401 || err.status === 403)) {
        log.error("PFF refused the key", { status: err.status, code: err.code });
        return apiError(`PFF refused the API key (${err.code ?? err.status})`, 502, "PFF_AUTH");
      }
      log.error("import failed", { prospectId: p.id, err: String(err) });
      results.push({
        prospectId: p.id,
        error: retryAfterMs != null ? "Not reached this batch; run again" : err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json<PffImportResponse>({ results, retryAfterMs });
}

// PostgREST reports a table that doesn't exist yet as PGRST205 (or 42P01).
const missingTable = (e: { code?: string }) => e.code === "PGRST205" || e.code === "42P01";

// Counts are integer columns; grades, aDOT and time-to-throw keep decimals.
const toInt = (v: number | null) => (v == null ? null : Math.round(v));

/** Writes one prospect's rows; returns an error message, or null. */
async function save(
  supabase: SupabaseClient, userId: string, prospectId: string, playerId: number, imp: ProspectImport,
): Promise<string | null> {
  const fetchedAt = new Date().toISOString();
  const gameRows = imp.games.map((g) => {
    const row: Record<string, unknown> = {
      game_id: g.gameId, user_id: userId, prospect_id: prospectId, pff_player_id: playerId,
      pff_game_id: g.pffGameId, season: g.season, week: g.week, franchise_id: g.franchiseId,
      pff_position: g.position, fetched_at: fetchedAt, raw: g.raw,
    };
    for (const k of GAME_STAT_KEYS) row[k] = GAME_AVERAGE_KEYS.has(k) || k === "ttt_total" ? g.stats[k] : toInt(g.stats[k]);
    return row;
  });
  const averages = new Set<string>(SEASON_AVERAGE_KEYS);
  const seasonRows = imp.seasons.map((s) => {
    const row: Record<string, unknown> = {
      user_id: userId, prospect_id: prospectId, pff_player_id: playerId, season: s.season,
      pff_game_ids: s.pffGameIds, weeks: s.weeks, franchise_ids: s.franchiseIds, fetched_at: fetchedAt, raw: s.raw,
    };
    for (const k of SEASON_STAT_KEYS) row[k] = averages.has(k) ? s.stats[k] : toInt(s.stats[k]);
    return row;
  });

  const errors: string[] = [];
  if (gameRows.length) {
    const { error } = await supabase.from("prospect_game_pff").upsert(gameRows, { onConflict: "game_id" });
    if (error) errors.push(missingTable(error) ? MIGRATION_HINT : error.message);
  }
  if (seasonRows.length && errors.length === 0) {
    const { error } = await supabase.from("prospect_season_pff").upsert(seasonRows, { onConflict: "prospect_id,season" });
    if (error) errors.push(missingTable(error) ? MIGRATION_HINT : error.message);
  }
  if (errors.length) log.error("save failed", { prospectId, errors });
  return errors.length ? `Couldn't save: ${errors[0]}` : null;
}
