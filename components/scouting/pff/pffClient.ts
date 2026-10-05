"use client";
// Browser side of the PFF stats (migration 063): load the user's stored rows
// (never the raw JSON) and run /api/pff/import in batches. Shared by the PFF
// Links tab, the charting boards' Games tab and the Scouting hub's load.

import { logger } from "../../../lib/logger";
import { PFF_IMPORT_BATCH, type PffImportResponse } from "../../../lib/pff/api";
import { GAME_ROW_SELECT, SEASON_ROW_SELECT, type PffGameRow, type PffSeasonRow } from "../../../lib/pff/stats";
import { fetchAllRows } from "../../../lib/scouting/fetchPlays";
import { supabase } from "../../../lib/supabaseclient";

const log = logger("scouting/pff/pffClient");

export const PFF_STATS_MIGRATION_HINT =
  "PFF stats need migration 063 (supabase/migrations/063_pff_game_stats.sql). Apply it, then reload.";

/** True when a load failed because migration 063 isn't applied yet. */
export function isMissingPffTables(err: unknown): boolean {
  return /prospect_(game|season)_pff/.test(String(err)) && /(schema cache|does not exist|not find)/i.test(String(err));
}

export async function pffAuthHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${session.access_token}` };
}

export interface PffRows {
  games: PffGameRow[];
  seasons: PffSeasonRow[];
}

/** The user's stored PFF rows, all of them or one prospect's. Throws on error. */
export async function fetchPffRows(prospectId?: string): Promise<PffRows> {
  const [games, seasons] = await Promise.all([
    fetchAllRows<PffGameRow>((from, to) => {
      let q = supabase.from("prospect_game_pff").select(GAME_ROW_SELECT);
      if (prospectId) q = q.eq("prospect_id", prospectId);
      return q.order("game_id").range(from, to) as unknown as PromiseLike<{ data: PffGameRow[] | null; error: { message: string } | null }>;
    }),
    fetchAllRows<PffSeasonRow>((from, to) => {
      let q = supabase.from("prospect_season_pff").select(SEASON_ROW_SELECT);
      if (prospectId) q = q.eq("prospect_id", prospectId);
      return q.order("prospect_id").order("season").range(from, to) as unknown as PromiseLike<{ data: PffSeasonRow[] | null; error: { message: string } | null }>;
    }),
  ]);
  return { games, seasons };
}

export interface PffImportProgress {
  done: number;
  total: number;
  failed: number;
  note: string | null;
}

export interface PffImportOutcome {
  /** Games PFF had nothing for this run: game id → why. */
  missing: Map<string, string>;
  /** Prospects skipped: prospect id → why (not linked, no linked games). */
  notes: Map<string, string>;
  /** Prospects that failed: prospect id → the error. */
  errors: Map<string, string>;
  failed: number;
  cancelled: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Import PFF stats for these prospects, a batch at a time, waiting out PFF's
 * read budget when the route says to. Resolves when done, stopped or failed
 * (a hard failure throws).
 */
export async function runPffImport(
  ids: readonly string[],
  opts: { onProgress?: (p: PffImportProgress) => void; isCancelled?: () => boolean } = {},
): Promise<PffImportOutcome> {
  const outcome: PffImportOutcome = { missing: new Map(), notes: new Map(), errors: new Map(), failed: 0, cancelled: false };
  const queue = [...ids];
  let done = 0;
  const report = (note: string | null) => opts.onProgress?.({ done, total: ids.length, failed: outcome.failed, note });
  report(null);
  while (queue.length > 0) {
    if (opts.isCancelled?.()) { outcome.cancelled = true; break; }
    const batch = queue.splice(0, PFF_IMPORT_BATCH);
    const res = await fetch("/api/pff/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await pffAuthHeader()) },
      body: JSON.stringify({ prospectIds: batch }),
    });
    const body = (await res.json().catch(() => null)) as (PffImportResponse & { error?: string }) | null;
    if (!res.ok || !body) {
      if (res.status === 429) {
        queue.unshift(...batch);
        report("Rate limited, waiting a minute…");
        await sleep(60_000);
        continue;
      }
      throw new Error(body?.error ?? `HTTP ${res.status}`);
    }
    const unreached = body.results.filter((r) => r.error?.startsWith("Not reached")).map((r) => r.prospectId);
    for (const r of body.results) {
      if (r.error?.startsWith("Not reached")) continue;
      for (const m of r.missing ?? []) outcome.missing.set(m.gameId, m.reason);
      if (r.error) { outcome.failed++; outcome.errors.set(r.prospectId, r.error); log.warn("PFF import failed for a prospect", { prospectId: r.prospectId, err: r.error }); }
      else if (r.note) outcome.notes.set(r.prospectId, r.note);
    }
    done += batch.length - unreached.length;
    queue.unshift(...unreached);
    const wait = body.retryAfterMs;
    report(wait ? "PFF read budget used up, waiting for it to reset…" : null);
    if (wait) await sleep(Math.min(wait, 65_000));
  }
  return outcome;
}
