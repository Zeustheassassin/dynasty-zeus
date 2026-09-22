// ============================================================
// Shared, in-memory client store for FantasyCalc values, keyed by (numQbs, isDynasty).
// ============================================================
// Before this, every caller (useCalcValues, useAppState's several fetchFantasyCalcValues call
// sites, useSpyState) fetched /api/fc-values independently, and two callers
// (useRookieBoardState, useSpyState's global redraft load) hit FantasyCalc directly from the
// browser — uncached, no timeout (Sept 21 audit, Batch 5).
//
// Deliberately NOT built on cachedFetch (lib/clientFetch.ts): that layer persists to
// localStorage and retries 5xx responses, with no hook to reject an empty/invalid payload
// before caching it — but an empty response here means "FantasyCalc outage" and must NEVER be
// cached (fetchFantasyCalcValues's existing contract; caching it would latch the outage for the
// whole TTL instead of letting the next caller retry). An in-flight promise + a short in-memory
// TTL, validated before caching, is enough to kill the duplicate-request burst a single page
// load produces — the server itself already caches the real data for 24h.
// ============================================================

import { FC_VALUES_CLIENT_TTL_MS, FC_VALUES_CLIENT_TIMEOUT_MS } from "./constants";

function fcStoreKey(numQbs: number, isDynasty: boolean): string {
  return `${numQbs}:${isDynasty}`;
}

function fcUrl(numQbs: number, isDynasty: boolean): string {
  // Matches the URL shape every existing caller already used (isDynasty is the server's
  // default, so the dynasty case never sent the param).
  return isDynasty ? `/api/fc-values?numQbs=${numQbs}` : `/api/fc-values?numQbs=${numQbs}&isDynasty=false`;
}

const cache = new Map<string, { data: unknown[]; at: number }>();
const inflight = new Map<string, Promise<unknown[]>>();

/** Raw /api/fc-values array for (numQbs, isDynasty), shared across every caller in the tab.
 *  Throws on a non-OK or empty response — never cached, so the next call retries instead of
 *  latching an outage. Pass `force: true` to bypass the cache (still joins any in-flight
 *  request already running for the same key) — used by the manual "refresh trends" action. */
export async function getFcValuesRaw(
  numQbs: 1 | 2,
  isDynasty: boolean,
  opts?: { force?: boolean }
): Promise<unknown[]> {
  const key = fcStoreKey(numQbs, isDynasty);
  if (!opts?.force) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < FC_VALUES_CLIENT_TTL_MS) return cached.data;
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const load = (async (): Promise<unknown[]> => {
    try {
      const res = await fetch(fcUrl(numQbs, isDynasty), { signal: AbortSignal.timeout(FC_VALUES_CLIENT_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`fc-values ${res.status}`);
      const data: unknown = await res.json();
      if (!Array.isArray(data) || data.length === 0) throw new Error("fc-values returned no data");
      cache.set(key, { data, at: Date.now() });
      return data;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, load);
  return load;
}

/** Drops every cached/in-flight entry. Not used in app code — exists so tests get a clean
 *  store between cases instead of leaking a previous test's cached values across `it()`s. */
export function invalidateFcValuesCache(): void {
  cache.clear();
  inflight.clear();
}
