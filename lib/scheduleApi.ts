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
import { firstKickoff } from "./helpers/draftClass";
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

// A season's Week 1 kickoffs are set months ahead, so an hour per browser is
// plenty; a failed lookup (the proxy answers {}) is retried after that.
const WEEK1_TTL_MS = 60 * 60_000;

/** The first Week 1 kickoff (ms) of an NFL season, or null when ESPN has no
 *  schedule for it yet or the lookup failed. For the draft board's class
 *  (lib/helpers/draftClass.ts). */
async function getWeek1Kickoff(season: number): Promise<number | null> {
  try {
    const games = await cachedFetch<Record<string, TeamGameState>>(
      `${PROXY_BASE}?week=1&season=${season}`,
      { ttlMs: WEEK1_TTL_MS }
    );
    return firstKickoff(games, season);
  } catch {
    return null;
  }
}

export const scheduleApi = { getNflScoreboard, getWeek1Kickoff };
