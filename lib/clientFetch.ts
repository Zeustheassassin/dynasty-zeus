// ============================================================
// Browser cache layer for proxied Sleeper calls
// ============================================================
// Sits in front of the `/api/sleeper/*` proxy routes (Phase M).
// The proxy routes already have a server-side Data Cache via
// `next: { revalidate }`; this layer adds a per-browser TTL cache
// in `localStorage` so repeat hub switches in the same session
// never hit the network at all.
//
// Usage:
//   import { cachedFetch } from "@/lib/clientFetch";
//   const rosters = await cachedFetch<SleeperRoster[]>(
//     `/api/sleeper/league/${leagueId}/rosters`,
//     { ttlMs: 120_000 }
//   );
// ============================================================

import { logger } from "./logger";
import { withRetry } from "./withRetry";

const log = logger("clientFetch");

const CACHE_PREFIX = "sleeperCache:";

/** HTTP error the caller should NOT retry (deterministic 4xx, e.g. bad param / not found). */
class NonRetryableHttpError extends Error {
  constructor(public status: number, url: string) {
    super(`cachedFetch ${status} — ${url}`);
    this.name = "NonRetryableHttpError";
  }
}

// In-flight request coalescing: concurrent callers for the same fetch URL share a
// single network request instead of each firing their own on a cold cache. Prevents
// a "cache stampede" (e.g. several tabs/hooks requesting the same league at once),
// which both wastes requests and pushes the per-IP proxy rate limiter.
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Fetch + JSON-parse with bounded retry. Retries transient failures (network
 * error, 429, 5xx) with exponential back-off; throws immediately on a
 * deterministic 4xx so we don't burn retries on a request that can't succeed.
 */
async function fetchAndParse<T>(url: string): Promise<T> {
  return withRetry<T>(
    async () => {
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw new NonRetryableHttpError(res.status, url);
        }
        throw new Error(`cachedFetch ${res.status} — ${url}`);
      }
      return (await res.json()) as T;
    },
    3,
    (err) => !(err instanceof NonRetryableHttpError),
  );
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

interface CachedFetchOpts {
  ttlMs: number;
  cacheKey?: string;
  bypass?: boolean;
}

function readCache<T>(key: string): { hit: true; data: T } | { hit: false } {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { hit: false };
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (typeof entry?.expiresAt !== "number" || Date.now() >= entry.expiresAt) {
      window.localStorage.removeItem(key);
      return { hit: false };
    }
    return { hit: true, data: entry.data };
  } catch {
    // Corrupt entry or read failure — drop it and treat as a miss
    try { window.localStorage.removeItem(key); } catch { /* ignore */ }
    return { hit: false };
  }
}

function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: number };
  // Names/codes vary across browsers; cover the common ones
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 ||
    e.code === 1014
  );
}

/** Drops sleeperCache entries (oldest expiresAt first) to free space.
 *  Only touches keys with our prefix — never evicts unrelated localStorage data. */
function evictOldEntries(): number {
  const entries: { key: string; expiresAt: number }[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (!k || !k.startsWith(CACHE_PREFIX)) continue;
    let expiresAt = 0;
    try {
      const raw = window.localStorage.getItem(k);
      if (raw) {
        const parsed = JSON.parse(raw) as CacheEntry<unknown>;
        if (typeof parsed?.expiresAt === "number") expiresAt = parsed.expiresAt;
      }
    } catch { /* corrupt entry — leave expiresAt = 0 so it sorts first */ }
    entries.push({ key: k, expiresAt });
  }
  if (entries.length === 0) return 0;
  entries.sort((a, b) => a.expiresAt - b.expiresAt);

  // Drop everything already expired, plus 25% of the total — whichever is more.
  const now = Date.now();
  const firstLiveIndex = entries.findIndex((e) => e.expiresAt >= now);
  const expiredCount = firstLiveIndex === -1 ? entries.length : firstLiveIndex;
  const dropCount = Math.max(expiredCount, Math.ceil(entries.length / 4));
  let dropped = 0;
  for (let i = 0; i < dropCount; i++) {
    try { window.localStorage.removeItem(entries[i].key); dropped++; } catch { /* ignore */ }
  }
  return dropped;
}

function writeCache<T>(key: string, data: T, ttlMs: number): void {
  const entry: CacheEntry<T> = { data, expiresAt: Date.now() + ttlMs };
  let payload: string;
  try {
    payload = JSON.stringify(entry);
  } catch (err) {
    log.warn("localStorage serialize failed", {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Try up to 4 times; each quota failure triggers one round of eviction.
  // Without this, a single oversized cache (many leagues × rosters/drafts) wedges
  // every subsequent write and floods the console with quota errors.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      window.localStorage.setItem(key, payload);
      return;
    } catch (err) {
      if (!isQuotaExceededError(err)) {
        log.warn("localStorage write failed", {
          key,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      const dropped = evictOldEntries();
      if (dropped === 0) {
        log.warn("localStorage write failed (nothing to evict)", { key });
        return;
      }
    }
  }
  log.warn("localStorage write failed after eviction retries", { key });
}

export async function cachedFetch<T>(url: string, opts: CachedFetchOpts): Promise<T> {
  // SSR: no window → no cache layer, but still retry transient failures.
  if (typeof window === "undefined") {
    return fetchAndParse<T>(url);
  }

  const key = CACHE_PREFIX + (opts.cacheKey ?? url);

  if (!opts.bypass) {
    const cached = readCache<T>(key);
    if (cached.hit) return cached.data;
  }

  // Coalesce on the fetch URL (which already includes any ?bypass param) so a
  // bypass refresh and a normal read don't accidentally share one promise.
  const existing = inFlight.get(url);
  if (existing) return existing as Promise<T>;

  const request = (async (): Promise<T> => {
    const data = await fetchAndParse<T>(url);
    writeCache(key, data, opts.ttlMs);
    return data;
  })();
  inFlight.set(url, request);
  try {
    return await request;
  } finally {
    inFlight.delete(url);
  }
}
