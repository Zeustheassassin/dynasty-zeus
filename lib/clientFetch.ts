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
import type { RequestQueue } from "./requestQueue";

const log = logger("clientFetch");

const CACHE_PREFIX = "sleeperCache:";

/** HTTP error the caller should NOT retry (deterministic 4xx, e.g. bad param / not found). */
class NonRetryableHttpError extends Error {
  constructor(public status: number, url: string) {
    super(`cachedFetch ${status} — ${url}`);
    this.name = "NonRetryableHttpError";
  }
}

/** A 429 on a queued request. The queue is already paused for its Retry-After by the time this is
 *  thrown, so the retry waits on the queue rather than on withRetry's back-off. */
class RateLimitedError extends Error {
  constructor(public retryAfterMs: number, url: string) {
    super(`cachedFetch 429 — ${url} (retry after ${retryAfterMs}ms)`);
    this.name = "RateLimitedError";
  }
}

/** Pause when a 429 carries no usable Retry-After. Our own limiter always sends one; this covers a
 *  429 from somewhere that doesn't (Sleeper itself, read cross-origin, can't expose the header). */
export const RETRY_AFTER_DEFAULT_MS = 5_000;
/** Floor, so a "Retry-After: 0" from a window that is just rolling over can't spin a hot loop. */
export const RETRY_AFTER_MIN_MS = 1_000;
/** Ceiling — the server's Sleeper bucket is a 60s window, so nothing legitimate asks for longer. */
export const RETRY_AFTER_MAX_MS = 60_000;

/** Retry-After as a wait in ms: delta-seconds or an HTTP date (RFC 9110 §10.2.3), clamped to
 *  [RETRY_AFTER_MIN_MS, RETRY_AFTER_MAX_MS]; RETRY_AFTER_DEFAULT_MS when missing or unparseable. */
export function parseRetryAfterMs(header: string | null, now = Date.now()): number {
  const clamp = (ms: number) => Math.min(RETRY_AFTER_MAX_MS, Math.max(RETRY_AFTER_MIN_MS, ms));
  const value = header?.trim();
  if (!value) return RETRY_AFTER_DEFAULT_MS;
  if (/^\d+$/.test(value)) return clamp(Number(value) * 1000);
  // An HTTP date always spells out its day/month names. Without letters, V8's lenient Date.parse
  // would read junk like "-5" or "1.5" as a year.
  const at = /[a-z]/i.test(value) ? Date.parse(value) : NaN;
  return Number.isNaN(at) ? RETRY_AFTER_DEFAULT_MS : clamp(at - now);
}

// In-flight request coalescing: concurrent callers for the same fetch URL share a
// single network request instead of each firing their own on a cold cache. Prevents
// a "cache stampede" (e.g. several tabs/hooks requesting the same league at once),
// which both wastes requests and pushes the per-IP proxy rate limiter.
const inFlight = new Map<string, Promise<unknown>>();

interface FetchJsonOpts {
  /** Aborts the underlying fetch after this many ms (each retry attempt gets its own timer). Omit for no timeout. */
  timeoutMs?: number;
  /** Total attempts (first try + retries) on a retryable failure. Defaults to 3 — lower this for
   *  a caller where timeoutMs is already generous, so attempts*timeoutMs doesn't compound into an
   *  unexpectedly long worst case (a caller migrating off a single-attempt raw fetch(), say). */
  retries?: number;
  /** Runs every attempt through this queue (lib/sleeperApi.ts's `sleeperRequestQueue`): each
   *  attempt waits for a slot and a token, and a 429 pauses the WHOLE queue for the response's
   *  Retry-After — the server answers every Sleeper route from one per-IP bucket, so the requests
   *  waiting behind it would hit the same wall. Without a queue a 429 is retried on the plain
   *  200/400ms back-off like any other transient failure. */
  queue?: RequestQueue;
}

/**
 * Fetch + JSON-parse with bounded retry. Retries transient failures (network
 * error, 429, 5xx) with exponential back-off — or, for a 429 on a queued
 * request, after the queue's Retry-After pause; throws immediately on a
 * deterministic 4xx so we don't burn retries on a request that can't succeed.
 */
async function fetchAndParse<T>(url: string, opts: FetchJsonOpts): Promise<T> {
  const { timeoutMs, retries = 3, queue } = opts;
  const attempt = async (): Promise<T> => {
    const res = timeoutMs != null
      ? await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      : await fetch(url);
    if (!res.ok) {
      if (res.status === 429 && queue) {
        const retryAfterMs = parseRetryAfterMs(res.headers.get("Retry-After"));
        queue.pauseFor(retryAfterMs);
        throw new RateLimitedError(retryAfterMs, url);
      }
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new NonRetryableHttpError(res.status, url);
      }
      throw new Error(`cachedFetch ${res.status} — ${url}`);
    }
    return (await res.json()) as T;
  };
  return withRetry<T>(
    queue ? () => queue.run(attempt) : attempt,
    retries,
    (err) => !(err instanceof NonRetryableHttpError),
    (err, i) => (err instanceof RateLimitedError ? 0 : 200 * 2 ** i),
  );
}

/** The uncached half of cachedFetch — same retry policy and optional queue, but no localStorage
 *  and no in-flight coalescing. For a call that is deliberately never cached (sleeperApi's ADP). */
export function fetchJson<T>(url: string, opts: FetchJsonOpts = {}): Promise<T> {
  return fetchAndParse<T>(url, opts);
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

interface CachedFetchOpts extends FetchJsonOpts {
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
    return fetchAndParse<T>(url, opts);
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
    const data = await fetchAndParse<T>(url, opts);
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
