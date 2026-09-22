// ============================================================
// Shared FantasyCalc values loader — SERVER-ONLY.
// ============================================================
// One code path for "the current FantasyCalc values", used by the /api/fc-values route AND the crons
// (player-value-history, simulation-history). Before this, only a user request ever refreshed the
// cache: the crons just read whatever row was there, so once cache writes broke (audit Sept 21 2026)
// player_value_history kept stamping the SAME frozen payload every day and the weekly simulation ran
// on a five-month-old map.
//
// Order: fresh cache -> live fetch (with a timeout, validated, written back with the service role)
// -> stale cache (optional) -> null. Callers decide what null means: the route answers 502; the
// history cron writes nothing rather than stamp a fake data point.
// ============================================================

import { supabase } from "../supabaseclient";
import { upsertCacheRow, type CacheTable } from "../supabaseAdmin";
import { afterResponse } from "../afterResponse";
import {
  FANTASYCALC_BASE_URL,
  FC_VALUES_TTL_MS,
  FC_FETCH_TIMEOUT_MS,
  FC_MIN_VALID_ENTRIES,
} from "../constants";
import { logger } from "../logger";

const log = logger("lib/server/fcValues");

/** One entry of FantasyCalc's raw /values/current response (fc_values_cache stores it verbatim). */
export interface FcRawEntry {
  player?: {
    position?: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    sleeperId?: string | number;
  };
  value?: number;
}

export type FcSource = "cache" | "live" | "stale";

export interface FcValuesResult {
  data: FcRawEntry[];
  /** cache = fresh cached row; live = just fetched from FantasyCalc; stale = expired cache served
   *  because FantasyCalc was unavailable */
  source: FcSource;
  /** ISO time the payload was fetched from FantasyCalc (the cache row's cached_at for cache/stale) */
  fetchedAt: string;
}

export interface FcValuesOptions {
  /** How old a cached row may be and still count as fresh. Default: FC_VALUES_TTL_MS (24h). */
  maxAgeMs?: number;
  /** Serve an expired cached row when FantasyCalc can't be reached. Default: true. A caller that
   *  must not treat old data as current (the daily history snapshot) passes false. */
  allowStale?: boolean;
}

/** True for a payload that looks like real FantasyCalc values — an array with a plausible number of
 *  valued entries. An error body, `[]` or a truncated response is NOT usable, so it is never cached
 *  and never served as data. */
export function isUsableFcPayload(data: unknown): data is FcRawEntry[] {
  if (!Array.isArray(data)) return false;
  let valued = 0;
  for (const entry of data) {
    if (typeof entry?.value === "number" && entry.value > 0 && ++valued >= FC_MIN_VALID_ENTRIES) return true;
  }
  return false;
}

export function fcCacheTable(isDynasty: boolean): CacheTable {
  return isDynasty ? "fc_values_cache" : "fc_redraft_values_cache";
}

// In-flight dedup: concurrent callers with the SAME (table, numQbs, maxAgeMs, allowStale) join
// one shared load instead of each independently reading the cache and, on a miss, each hitting
// FantasyCalc directly. maxAgeMs/allowStale are part of the key (not just table/numQbs) because
// different callers ask for different freshness guarantees — player-value-history's 6h/no-stale
// window must never be satisfied by a result another caller computed under the 24h/stale-ok
// default (Sept 22 code-review P2 finding #6; see lib/fcValuesStore.ts for the client-side
// equivalent of this pattern).
const inFlight = new Map<string, Promise<FcValuesResult | null>>();

function fcInFlightKey(table: CacheTable, numQbs: number, maxAgeMs: number, allowStale: boolean): string {
  return `${table}:${numQbs}:${maxAgeMs}:${allowStale}`;
}

// numTeams/ppr only apply to the dynasty query shape (matches prior direct-fetch behavior); the
// redraft shape was always queried without them.
function fcUrl(numQbs: number, isDynasty: boolean): string {
  return isDynasty
    ? `${FANTASYCALC_BASE_URL}/values/current?isDynasty=true&numQbs=${numQbs}&numTeams=12&ppr=1`
    : `${FANTASYCALC_BASE_URL}/values/current?isDynasty=false&numQbs=${numQbs}`;
}

async function readCache(table: CacheTable, numQbs: number): Promise<{ data: FcRawEntry[]; cachedAt: string } | null> {
  try {
    const { data: row } = await supabase
      .from(table)
      .select("data, cached_at")
      .eq("num_qbs", numQbs)
      .single();
    if (!row || !isUsableFcPayload(row.data)) return null;
    return { data: row.data, cachedAt: String(row.cached_at) };
  } catch {
    return null; // cache read failed — treat as a miss
  }
}

async function fetchLive(numQbs: number, isDynasty: boolean): Promise<FcRawEntry[] | null> {
  try {
    const res = await fetch(fcUrl(numQbs, isDynasty), { signal: AbortSignal.timeout(FC_FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      log.warn("FantasyCalc responded non-OK", { status: res.status, numQbs, isDynasty });
      return null;
    }
    const data: unknown = await res.json();
    if (!isUsableFcPayload(data)) {
      log.warn("FantasyCalc returned an unusable payload", { numQbs, isDynasty });
      return null;
    }
    return data;
  } catch (err) {
    log.warn("FantasyCalc fetch failed", { err: String(err), numQbs, isDynasty });
    return null;
  }
}

/** The current FantasyCalc values for a format, or null when there is nothing usable to give. */
export async function getFcValues(
  numQbs: 1 | 2,
  isDynasty: boolean,
  { maxAgeMs = FC_VALUES_TTL_MS, allowStale = true }: FcValuesOptions = {}
): Promise<FcValuesResult | null> {
  const table = fcCacheTable(isDynasty);
  const key = fcInFlightKey(table, numQbs, maxAgeMs, allowStale);

  const existing = inFlight.get(key);
  if (existing) return existing;

  const load = (async (): Promise<FcValuesResult | null> => {
    const cached = await readCache(table, numQbs);
    const cachedAgeMs = cached ? Date.now() - new Date(cached.cachedAt).getTime() : Infinity;
    if (cached && cachedAgeMs < maxAgeMs) {
      return { data: cached.data, source: "cache", fetchedAt: cached.cachedAt };
    }

    const live = await fetchLive(numQbs, isDynasty);
    if (live) {
      const fetchedAt = new Date().toISOString();
      // Written with the service role after the response — the cache tables are SELECT-only for anon.
      afterResponse(() => upsertCacheRow(table, { num_qbs: numQbs, data: live, cached_at: fetchedAt }));
      return { data: live, source: "live", fetchedAt };
    }

    if (cached && allowStale) {
      log.warn("FantasyCalc unavailable — serving the expired cache", {
        table, numQbs, ageHours: Math.round(cachedAgeMs / 3_600_000),
      });
      return { data: cached.data, source: "stale", fetchedAt: cached.cachedAt };
    }

    log.error("FantasyCalc unavailable and no usable cache", { table, numQbs, hadCache: !!cached });
    return null;
  })();

  inFlight.set(key, load);
  try {
    return await load;
  } finally {
    inFlight.delete(key);
  }
}
