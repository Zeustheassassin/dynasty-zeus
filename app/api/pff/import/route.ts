// POST /api/pff/import  { prospectIds: string[] }  (Authorization: Bearer <access token>)
//
// Imports PFF's stats for a few of the caller's prospects: one row per
// matched charted game (prospect_game_pff) and PFF's aggregate over exactly
// the charted weeks of each season (prospect_season_pff), both migration 063,
// written as the caller under their own RLS. QBs also get PFF's full-season
// passing depth for each college season (prospect_season_pff_depth,
// migration 092; the middle-of-the-field adjustment, middleUsage.ts), the
// one place a whole season is read. Only games linked auto /
// confirmed in Stage 1 are read; PFF season totals never are. The Scouting →
// PFF Links panel and each charting board's Games tab call it in small
// batches; PFF's per-minute read budget (100) is paced inside the client, so
// a batch can pause up to a minute. A refresh re-reads and overwrites.

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { apiError } from "../../../../lib/apiHelpers";
import { logger } from "../../../../lib/logger";
import { PFF_IMPORT_BATCH, type PffImportResponse, type PffImportResult } from "../../../../lib/pff/api";
import { getPffClient, PffError, type PffClient } from "../../../../lib/pff/client";
import { leagueTimeInPocket, playerSeasonDepth, playerSeasonRushing, type PffStatRow } from "../../../../lib/pff/ncaa";
import { importProspect, type GameToImport, type ProspectImport } from "../../../../lib/pff/runImport";
import { depthSeasonsFor, zoneAttemptsFrom } from "../../../../lib/scouting/middleUsage";
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
const DEPTH_MIGRATION_HINT = "Full-season depth needs migration 092 (supabase/migrations/092_prospect_season_pff_depth.sql)";
const POCKET_MIGRATION_HINT = "Pocket times need migration 093 (supabase/migrations/093_season_pff_depth_pocket.sql); depth saved without them";
const RUSHING_MIGRATION_HINT = "Full-season rushing needs migration 094 (supabase/migrations/094_season_pff_depth_rushing.sql); depth saved without it";

interface ProspectRow { id: string; position: string; pff_player_id: number | null; pff_match_status: string | null; draft_class_year: number | null }
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
    supabase.from("prospects").select("id,position,pff_player_id,pff_match_status,draft_class_year").in("id", ids),
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
  // PFF's time-in-pocket report comes league-wide per season (~1,300
  // passers), so each season is read once per batch and shared by its QBs.
  const pocketBySeason = new Map<number, Promise<Map<number, PffStatRow>>>();
  const pocketFor = (season: number) => {
    let hit = pocketBySeason.get(season);
    if (!hit) {
      hit = leagueTimeInPocket(client, season).then((rows) => new Map(rows.map((r) => [Number(r.player_id), r])));
      pocketBySeason.set(season, hit);
    }
    return hit;
  };

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
    // QBs also get PFF's full-season passing depth (migration 092), linked
    // games or not: the middle-of-the-field adjustment reads whole seasons.
    if (linked.length === 0 && pos !== "QB") { results.push({ prospectId: p.id, imported: 0, note: "No charted games linked to PFF" }); continue; }
    try {
      let imp: ProspectImport | null = null;
      let saveErr: string | null = null;
      if (linked.length > 0) {
        imp = await importProspect(client, pos, p.pff_player_id, linked);
        saveErr = await save(supabase, user.id, p.id, p.pff_player_id, imp);
      }
      const depth = pos === "QB"
        ? await importSeasonDepth(supabase, client, pocketFor, user.id, p.id, p.pff_player_id,
          depthSeasonsFor(p.draft_class_year, games.filter((g) => g.prospect_id === p.id).map((g) => g.season_year), new Date()))
        : null;
      const notes = [linked.length === 0 && "No charted games linked to PFF", depth?.note].filter(Boolean).join("; ");
      results.push({
        prospectId: p.id,
        imported: imp?.games.length ?? 0,
        ...(imp ? { seasons: imp.seasons.length, missing: imp.missing } : {}),
        ...(depth ? { depthSeasons: depth.saved } : {}),
        ...(notes ? { note: notes } : {}),
        ...(saveErr ?? depth?.error ? { error: (saveErr ?? depth?.error)! } : {}),
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

/**
 * A QB's full-season passing depth for each season he threw (migration 092),
 * one PFF read per season, with his row of that season's time-in-pocket
 * report beside it (migration 093; `pocketFor` reads each season once per
 * batch). Before 092 is applied it says so in a note and leaves the rest of
 * the import alone; before 093, it saves the depth without the pocket times.
 */
async function importSeasonDepth(
  supabase: SupabaseClient, client: PffClient, pocketFor: (season: number) => Promise<Map<number, PffStatRow>>,
  userId: string, prospectId: string, playerId: number, seasons: readonly number[],
): Promise<{ saved: number; note?: string; error?: string }> {
  const fetchedAt = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  for (const season of seasons) {
    const row = await playerSeasonDepth(client, playerId, season);
    if (!row) continue;
    const pocket = (await pocketFor(season)).get(playerId) ?? null;
    const rushing = await playerSeasonRushing(client, playerId, season);
    rows.push({
      user_id: userId, prospect_id: prospectId, season, pff_player_id: playerId,
      team_name: typeof row.team_name === "string" ? row.team_name : null,
      zone_attempts: zoneAttemptsFrom(row), raw: row, pocket, rushing, fetched_at: fetchedAt,
    });
  }
  if (!rows.length) return { saved: 0 };
  const upsert = (list: Record<string, unknown>[]) =>
    supabase.from("prospect_season_pff_depth").upsert(list, { onConflict: "prospect_id,season" });
  // A column a migration hasn't added yet (094 rushing, then 093 pocket) is
  // dropped and the save retried, so the depth always lands.
  let { error } = await upsert(rows);
  const notes: string[] = [];
  for (const [col, hint] of [["rushing", RUSHING_MIGRATION_HINT], ["pocket", POCKET_MIGRATION_HINT]] as const) {
    if (!error || !missingColumn(error)) break;
    for (const r of rows) delete r[col];
    ({ error } = await upsert(rows));
    notes.push(hint);
  }
  const note = notes.length ? notes.join("; ") : undefined;
  if (!error) return { saved: rows.length, ...(note ? { note } : {}) };
  if (missingTable(error)) return { saved: 0, note: DEPTH_MIGRATION_HINT };
  log.error("season depth save failed", { prospectId, err: error.message });
  return { saved: 0, error: `Couldn't save full-season depth: ${error.message}` };
}

// PostgREST reports a column it doesn't know (093 not applied) as PGRST204 (or 42703).
const missingColumn = (e: { code?: string }) => e.code === "PGRST204" || e.code === "42703";
