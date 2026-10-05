"use client";
// Browser side of the game context (migration 065): load the user's context
// rows with the shared CFD rows they point at, and run /api/scouting/context
// in batches. Shared by the Scouting hub's load and the PFF Links tab.

import type { CfdGameWithWeather, CfdTeamSeasonRow } from "../../../lib/cfd/types";
import { CONTEXT_FILL_BATCH, type ContextFillResponse } from "../../../lib/gameContext/api";
import { logger } from "../../../lib/logger";
import { fetchAllRows } from "../../../lib/scouting/fetchPlays";
import {
  CFD_GAME_SELECT, CONTEXT_ROW_SELECT, TEAM_SEASON_SELECT,
  type GameContextData, type GameContextRow,
} from "../../../lib/scouting/gameContext";
import { supabase } from "../../../lib/supabaseclient";
import { pffAuthHeader } from "../pff/pffClient";

const log = logger("scouting/context/contextClient");

export const CONTEXT_MIGRATION_HINT =
  "Game context needs migration 065 (supabase/migrations/065_game_context.sql). Apply it, then reload.";

/** True when a load failed because migration 065 isn't applied yet. */
export function isMissingContextTables(err: unknown): boolean {
  const s = String(err instanceof Error ? err.message : err);
  return /(scouting_game_context|cfd_|pff_game_offense|played_hurt|trait_grades|left_early)/.test(s) && /(schema cache|does not exist|not find)/i.test(s);
}

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** The user's context rows (all, or one prospect's), their CFD games and the SP+ of those seasons. Throws on error. */
export async function fetchGameContextData(prospectId?: string): Promise<GameContextData> {
  const rows = await fetchAllRows<GameContextRow>((from, to) => {
    let q = supabase.from("scouting_game_context").select(CONTEXT_ROW_SELECT);
    if (prospectId) q = q.eq("prospect_id", prospectId);
    return q.order("game_id").range(from, to) as unknown as Page<GameContextRow>;
  });
  const ids = [...new Set(rows.map((r) => r.cfd_game_id).filter((id): id is number => id != null))];
  const cfdGames: CfdGameWithWeather[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("cfd_games").select(CFD_GAME_SELECT).in("id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    cfdGames.push(...((data ?? []) as CfdGameWithWeather[]));
  }
  const seasons = [...new Set(cfdGames.map((g) => g.season))];
  const teamSeasons = seasons.length
    ? await fetchAllRows<CfdTeamSeasonRow>((from, to) =>
      supabase.from("cfd_team_seasons").select(TEAM_SEASON_SELECT).in("season", seasons).order("season").order("school").range(from, to) as unknown as Page<CfdTeamSeasonRow>)
    : [];
  return { rows, cfdGames, teamSeasons };
}

export interface ContextFillProgress {
  done: number;
  total: number;
  failed: number;
  note: string | null;
}

export interface ContextFillOutcome {
  /** Prospects that failed: prospect id → the error. */
  errors: Map<string, string>;
  /** Games the run couldn't match to a CollegeFootballData game: game id → why. */
  unmatched: Map<string, string>;
  /** CollegeFootballData lists fetched (most runs: none), and the calls left. */
  cfdFetched: string[];
  cfdRemaining: number | null;
  cancelled: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Fill the game context for these prospects, a batch at a time, waiting out
 * PFF's read budget when the route says to. A hard failure throws.
 */
export async function runContextFill(
  ids: readonly string[],
  opts: { onProgress?: (p: ContextFillProgress) => void; isCancelled?: () => boolean } = {},
): Promise<ContextFillOutcome> {
  const outcome: ContextFillOutcome = { errors: new Map(), unmatched: new Map(), cfdFetched: [], cfdRemaining: null, cancelled: false };
  const queue = [...ids];
  let done = 0;
  const report = (note: string | null) => opts.onProgress?.({ done, total: ids.length, failed: outcome.errors.size, note });
  report(null);
  while (queue.length > 0) {
    if (opts.isCancelled?.()) { outcome.cancelled = true; break; }
    const batch = queue.splice(0, CONTEXT_FILL_BATCH);
    const res = await fetch("/api/scouting/context", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await pffAuthHeader()) },
      body: JSON.stringify({ prospectIds: batch }),
    });
    const body = (await res.json().catch(() => null)) as (ContextFillResponse & { error?: string }) | null;
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
      for (const u of r.unmatched ?? []) outcome.unmatched.set(u.gameId, u.reason);
      if (r.error) { outcome.errors.set(r.prospectId, r.error); log.warn("game context failed for a prospect", { prospectId: r.prospectId, err: r.error }); }
    }
    outcome.cfdFetched.push(...body.cfdFetched);
    if (body.cfdRemaining != null) outcome.cfdRemaining = body.cfdRemaining;
    done += batch.length - unreached.length;
    queue.unshift(...unreached);
    const wait = body.retryAfterMs;
    report(wait ? "PFF read budget used up, waiting for it to reset…" : null);
    if (wait) await sleep(Math.min(wait, 65_000));
  }
  return outcome;
}
