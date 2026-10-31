// ============================================================
// Shared, in-memory client store for Sleeper's per-week projections, keyed by (season, week).
// ============================================================
// The season simulator reads every remaining regular-season week (see
// lib/helpers/weeklyProjections.ts), for the user's own leagues (useAppState) and for a scouted
// user's (useSpyState). Same shape as fcValuesStore: an in-flight promise so both callers share
// one request, and a short in-memory TTL — not cachedFetch's localStorage, since seven trimmed
// weeks (~100 KB each) would crowd out the caches that need to survive a reload. An empty or
// failed week is never cached, so the next caller retries it.
// ============================================================

import { SLEEPER_WEEKLY_PROJECTIONS_TTL_MS, FC_VALUES_CLIENT_TIMEOUT_MS } from "./constants";
import type { WeeklyProjectionWeek } from "./helpers/weeklyProjections";

const cache = new Map<string, { data: WeeklyProjectionWeek; at: number }>();
const inflight = new Map<string, Promise<WeeklyProjectionWeek>>();

/** One trimmed week from /api/projections/sleeper-week. Throws on a non-OK or empty answer. */
export async function getWeeklyProjections(season: string, week: number): Promise<WeeklyProjectionWeek> {
  const key = `${season}:${week}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < SLEEPER_WEEKLY_PROJECTIONS_TTL_MS) return cached.data;

  const existing = inflight.get(key);
  if (existing) return existing;

  const load = (async (): Promise<WeeklyProjectionWeek> => {
    try {
      const res = await fetch(`/api/projections/sleeper-week?season=${season}&week=${week}`, {
        signal: AbortSignal.timeout(FC_VALUES_CLIENT_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`sleeper-week ${res.status}`);
      const data: unknown = await res.json();
      if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
        throw new Error("sleeper-week returned no players");
      }
      cache.set(key, { data: data as WeeklyProjectionWeek, at: Date.now() });
      return data as WeeklyProjectionWeek;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, load);
  return load;
}

/** Every week in `weeks`, settled together: the weeks that loaded, keyed by week. A week that
 *  failed is simply absent — simulateLeague only uses weekly availability when every week it
 *  plays is present. */
export async function getWeeklyProjectionsRange(
  season: string,
  weeks: readonly number[],
): Promise<Record<number, WeeklyProjectionWeek>> {
  const settled = await Promise.allSettled(weeks.map((week) => getWeeklyProjections(season, week)));
  const out: Record<number, WeeklyProjectionWeek> = {};
  settled.forEach((result, idx) => {
    if (result.status === "fulfilled") out[weeks[idx]] = result.value;
  });
  return out;
}

/** Test-only: forget every cached and in-flight week. */
export function resetWeeklyProjectionsStore(): void {
  cache.clear();
  inflight.clear();
}
