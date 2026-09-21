// ============================================================
// NFL live scoreboard client
// ============================================================
// Routes through /api/nfl-scoreboard (server-side Next.js Data
// Cache) and adds a short per-browser localStorage TTL cache via
// the same `cachedFetch` helper lib/sleeperApi.ts uses — live
// scores need a much shorter TTL than any Sleeper roster/league
// data, since kickoff/live/final status changes constantly during
// games.
// ============================================================

import { cachedFetch } from "./clientFetch";
import type { TeamGameState } from "./types";

const PROXY_BASE = "/api/nfl-scoreboard";
const TTL_MS = 45_000;

/** Fetch this week's per-team game state. Returns {} on any error.
 *
 *  `bypass` skips the browser TTL cache only (live polling would otherwise get
 *  the same 45s-old answer every other tick). The server keeps its own 30s
 *  cache, which is short enough for live use and keeps ESPN traffic bounded. */
async function getNflScoreboard(week: number, bypass?: boolean): Promise<Record<string, TeamGameState>> {
  try {
    return await cachedFetch<Record<string, TeamGameState>>(
      `${PROXY_BASE}?week=${week}`,
      { ttlMs: TTL_MS, bypass }
    );
  } catch {
    return {};
  }
}

export const scheduleApi = { getNflScoreboard };
