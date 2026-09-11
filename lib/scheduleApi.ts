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

/** Fetch this week's per-team kickoff/live/final status. Returns {} on any error. */
async function getNflScoreboard(week: number): Promise<Record<string, TeamGameState>> {
  try {
    return await cachedFetch<Record<string, TeamGameState>>(
      `${PROXY_BASE}?week=${week}`,
      { ttlMs: TTL_MS }
    );
  } catch {
    return {};
  }
}

export const scheduleApi = { getNflScoreboard };
