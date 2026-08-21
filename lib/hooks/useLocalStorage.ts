"use client";

import { useState, useCallback } from "react";
import { logger } from "@/lib/logger";

const log = logger("lib/hooks/useLocalStorage");

export function getLocalStorageItem<T>(key: string, defaultValue: T): T {
  if (typeof window === "undefined") return defaultValue;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: number };
  // Names/codes vary across browsers; cover the common ones.
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 ||
    e.code === 1014
  );
}

/** Free space by dropping TTL-cache entries — values that JSON-parse to an
 *  object with a numeric `expiresAt` (the clientFetch sleeperCache shape),
 *  oldest first. Plain values (tabs, sleeperUser, annotations) have no
 *  `expiresAt`, so they are never evicted. Returns how many keys were removed. */
function evictExpiringEntries(): number {
  const entries: { key: string; expiresAt: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { expiresAt?: unknown };
      if (parsed && typeof parsed.expiresAt === "number") {
        entries.push({ key: k, expiresAt: parsed.expiresAt });
      }
    } catch {
      // Not JSON / not a cache entry — leave it alone.
    }
  }
  if (!entries.length) return 0;
  entries.sort((a, b) => a.expiresAt - b.expiresAt);
  // Drop everything already expired, plus 25% of the total — whichever is more.
  const now = Date.now();
  const expiredCount = entries.filter((e) => e.expiresAt < now).length;
  const dropCount = Math.min(entries.length, Math.max(expiredCount, Math.ceil(entries.length / 4)));
  let dropped = 0;
  for (let i = 0; i < dropCount; i++) {
    try { localStorage.removeItem(entries[i].key); dropped++; } catch { /* ignore */ }
  }
  return dropped;
}

export function setLocalStorageItem<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  let payload: string;
  try {
    payload = JSON.stringify(value);
  } catch {
    log.warn("serialize failed — write skipped", { key });
    return;
  }
  // Try up to 3 times; each quota failure evicts a batch of TTL-cache entries
  // and retries, so a full Sleeper cache no longer wedges small writes (tabs,
  // user, annotations). Give up quietly if eviction frees nothing.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      localStorage.setItem(key, payload);
      return;
    } catch (err) {
      if (!isQuotaError(err) || evictExpiringEntries() === 0) {
        log.warn("quota exceeded — write skipped", { key });
        return;
      }
    }
  }
  log.warn("quota exceeded after eviction — write skipped", { key });
}

export function removeLocalStorageItem(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    // private browsing or sandboxed iframe
  }
}

/** Remove every localStorage key starting with `prefix` — for keys that embed
 *  a variable suffix (league id, board version) so an exact key isn't known
 *  up front, e.g. clearing all `draftPicks_<leagueId>_<year>` entries on sign-out. */
export function removeLocalStorageItemsByPrefix(prefix: string): void {
  if (typeof window === "undefined") return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {
    // private browsing or sandboxed iframe
  }
}

export function useLocalStorage<T>(
  key: string,
  defaultValue: T
): [T, (val: T) => void, () => void] {
  const [value, setValueState] = useState<T>(() =>
    getLocalStorageItem(key, defaultValue)
  );

  const setValue = useCallback(
    (val: T) => {
      setValueState(val);
      setLocalStorageItem(key, val);
    },
    [key]
  );

  const removeValue = useCallback(() => {
    setValueState(defaultValue);
    removeLocalStorageItem(key);
  }, [key, defaultValue]);

  return [value, setValue, removeValue];
}
