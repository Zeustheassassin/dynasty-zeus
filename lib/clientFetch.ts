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

const log = logger("clientFetch");

const CACHE_PREFIX = "sleeperCache:";

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

function writeCache<T>(key: string, data: T, ttlMs: number): void {
  try {
    const entry: CacheEntry<T> = { data, expiresAt: Date.now() + ttlMs };
    window.localStorage.setItem(key, JSON.stringify(entry));
  } catch (err) {
    // QuotaExceededError or other write failure — non-fatal, caller still gets data
    log.warn("localStorage write failed", {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function cachedFetch<T>(url: string, opts: CachedFetchOpts): Promise<T> {
  // SSR: no window → no cache layer, always go straight to network
  if (typeof window === "undefined") {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`cachedFetch ${res.status} — ${url}`);
    return res.json() as Promise<T>;
  }

  const key = CACHE_PREFIX + (opts.cacheKey ?? url);

  if (!opts.bypass) {
    const cached = readCache<T>(key);
    if (cached.hit) return cached.data;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`cachedFetch ${res.status} — ${url}`);
  const data = (await res.json()) as T;
  writeCache(key, data, opts.ttlMs);
  return data;
}
