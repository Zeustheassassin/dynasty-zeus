// ============================================================
// Sleeper API client
// ============================================================
// Single chokepoint for every Sleeper HTTP call.
//
// Routes through `/api/sleeper/*` proxies (server-side Next.js
// Data Cache via `next: { revalidate }`) and adds a per-browser
// localStorage TTL cache via `cachedFetch`. Repeat hub switches
// inside the TTL window never hit the network.
//
// All functions are async and return typed results. `get*`
// functions throw on non-OK responses; `getOrNull*` swallow errors
// and return null / [] so callers can short-circuit cleanly.
//
// Live drafts: pass `bypassCache: true` to `getDraftPicks` so an
// in-progress draft never serves stale picks from localStorage.
//
// Usage:
//   import { sleeperApi } from "@/lib/sleeperApi";
//   const user = await sleeperApi.getUserByUsername("john_doe");
// ============================================================

import { cachedFetch } from "./clientFetch";
import { withRetry } from "./withRetry";
import { SLEEPER_PROJECTIONS_BASE } from "./constants";
import { logger } from "./logger";

const log = logger("lib/sleeperApi");
import type {
  SleeperUser,
  SleeperLeague,
  SleeperRoster,
  SleeperMatchup,
  SleeperTransaction,
  SleeperDraft,
  SleeperDraftPick,
  SleeperTradedPick,
} from "./types";

// Proxy base — all routes mounted under app/api/sleeper/**
const PROXY_BASE = "/api/sleeper";

// ── Client-side TTLs (ms) ────────────────────────────────────
// These pair with the server-side `SLEEPER_*_REVALIDATE_S`
// constants in lib/constants.ts. The client TTL should always
// be ≤ the server revalidate window to avoid serving data the
// server has already discarded.
const TTL = {
  user:               3_600_000, //  60m  (server: 3600s)
  userLeagues:          600_000, //  10m  (server: 1800s)
  leagueRosters:        300_000, //   5m  (server:  600s)
  leagueMatchups:        60_000, //   1m  (server:  300s)
  leagueTransactions:   480_000, //   8m  (server:  900s)
  leagueTradedPicks:    600_000, //  10m  (server: 1800s)
  leagueDrafts:       1_800_000, //  30m  (server: 3600s)
  draftPicks:            30_000, //  30s  (server:   60s)
  leagueUsers:          600_000, //  10m  (server: 1800s)
  leagueInfo:         1_800_000, //  30m  (server: 3600s)
} as const;

// ---------------------------------------------------------------------------
// Internal helpers — wrap cachedFetch with the existing throw / null-on-error
// contracts so callers don't need to change error-handling shape.
// ---------------------------------------------------------------------------
async function cachedGet<T>(url: string, ttlMs: number, bypass?: boolean): Promise<T> {
  // When bypassing, append ?bypass=1 so the server proxy uses cache: 'no-store',
  // but keep the unsuffixed URL as the cacheKey so the fresh result populates
  // the same localStorage slot a non-bypass call would read from.
  const fetchUrl = bypass ? appendBypassParam(url) : url;
  return cachedFetch<T>(fetchUrl, { ttlMs, bypass, cacheKey: url });
}

async function cachedGetOrNull<T>(url: string, ttlMs: number, bypass?: boolean): Promise<T | null> {
  const fetchUrl = bypass ? appendBypassParam(url) : url;
  try {
    return await cachedFetch<T>(fetchUrl, { ttlMs, bypass, cacheKey: url });
  } catch (err) {
    // Callers of the getOrNull* functions treat this as "nothing yet" (empty array / null),
    // not an error — but that made a 429 or a genuine outage invisible (Sept 21 audit finding
    // #5). Logging here doesn't change the return contract, just makes failures observable.
    log.warn("request failed — returning null", { url, err: String(err) });
    return null;
  }
}

function appendBypassParam(url: string): string {
  return url.includes('?') ? `${url}&bypass=1` : `${url}?bypass=1`;
}

// ===========================================================================
// USER endpoints
// ===========================================================================

/** Fetch a Sleeper user by username. */
async function getUserByUsername(username: string): Promise<SleeperUser> {
  return cachedGet<SleeperUser>(
    `${PROXY_BASE}/user/${encodeURIComponent(username)}`,
    TTL.user,
  );
}

/** Fetch a Sleeper user by user_id. Sleeper accepts either username or user_id at the same path. */
async function getUserById(userId: string): Promise<SleeperUser | null> {
  return cachedGetOrNull<SleeperUser>(
    `${PROXY_BASE}/user/${encodeURIComponent(userId)}`,
    TTL.user,
  );
}

// ===========================================================================
// LEAGUE endpoints
// ===========================================================================

/** Fetch all leagues for a user in a given NFL season year. */
async function getUserLeagues(userId: string, year: string): Promise<SleeperLeague[]> {
  return cachedGet<SleeperLeague[]>(
    `${PROXY_BASE}/user-leagues/${encodeURIComponent(userId)}/${encodeURIComponent(year)}`,
    TTL.userLeagues,
  );
}

// ===========================================================================
// ROSTER endpoints
// ===========================================================================

/** Fetch all rosters in a league. Pass `bypass: true` to skip both client and server caches. */
async function getLeagueRosters(leagueId: string, bypass?: boolean): Promise<SleeperRoster[]> {
  return cachedGet<SleeperRoster[]>(
    `${PROXY_BASE}/league/${encodeURIComponent(leagueId)}/rosters`,
    TTL.leagueRosters,
    bypass,
  );
}

/** Fetch the league user list (display names, avatars, metadata). Returns [] on any error. */
async function getLeagueUsers(leagueId: string, bypass?: boolean): Promise<SleeperUser[]> {
  const result = await cachedGetOrNull<SleeperUser[]>(
    `${PROXY_BASE}/league/${encodeURIComponent(leagueId)}/users`,
    TTL.leagueUsers,
    bypass,
  );
  return result ?? [];
}

/**
 * Fetch the single-league info object (settings, previous_league_id, etc.).
 * Returns null on upstream error or unknown league_id — callers walking the
 * previous_league_id chain rely on null to terminate the loop.
 */
async function getLeagueInfo(leagueId: string): Promise<SleeperLeague | null> {
  return cachedGetOrNull<SleeperLeague>(
    `${PROXY_BASE}/league/${encodeURIComponent(leagueId)}`,
    TTL.leagueInfo,
  );
}

// ===========================================================================
// MATCHUP endpoints
// ===========================================================================

/** Fetch all matchups for a given week (1-22). Pass `bypass: true` for live
 *  scoring — it skips both the browser TTL cache and the proxy's 5-minute server cache. */
async function getLeagueMatchups(leagueId: string, week: number, bypass?: boolean): Promise<SleeperMatchup[]> {
  return cachedGet<SleeperMatchup[]>(
    `${PROXY_BASE}/league/${encodeURIComponent(leagueId)}/matchups/${week}`,
    TTL.leagueMatchups,
    bypass,
  );
}

// ===========================================================================
// TRANSACTION endpoints
// ===========================================================================

/** Fetch transactions for a single week. Returns [] on any error. */
async function getLeagueTransactions(
  leagueId: string,
  week: number,
  bypass?: boolean,
): Promise<SleeperTransaction[]> {
  const result = await cachedGetOrNull<SleeperTransaction[]>(
    `${PROXY_BASE}/league/${encodeURIComponent(leagueId)}/transactions/${week}`,
    TTL.leagueTransactions,
    bypass,
  );
  return result ?? [];
}

/** Convenience: fetch multiple weeks of transactions in parallel. */
async function getLeagueTransactionsMultiWeek(
  leagueId: string,
  weeks: number[],
  bypass?: boolean,
): Promise<SleeperTransaction[]> {
  const results = await Promise.all(weeks.map((w) => getLeagueTransactions(leagueId, w, bypass)));
  return results.flat();
}

// ===========================================================================
// TRADED PICKS endpoints
// ===========================================================================

/** Fetch all traded picks in a league (past + future). */
async function getLeagueTradedPicks(leagueId: string, bypass?: boolean): Promise<SleeperTradedPick[]> {
  const result = await cachedGetOrNull<SleeperTradedPick[]>(
    `${PROXY_BASE}/league/${encodeURIComponent(leagueId)}/traded-picks`,
    TTL.leagueTradedPicks,
    bypass,
  );
  return result ?? [];
}

// ===========================================================================
// DRAFT endpoints
// ===========================================================================

/** Fetch all drafts associated with a league. */
async function getLeagueDrafts(leagueId: string, bypass?: boolean): Promise<SleeperDraft[]> {
  const result = await cachedGetOrNull<SleeperDraft[]>(
    `${PROXY_BASE}/league/${encodeURIComponent(leagueId)}/drafts`,
    TTL.leagueDrafts,
    bypass,
  );
  return result ?? [];
}

/**
 * Fetch all picks made in a draft.
 * Pass `bypassCache: true` for an in-progress draft so picks always
 * come from the network (server cache is still 60s, which is acceptable).
 */
async function getDraftPicks(
  draftId: string,
  bypassCache = false,
): Promise<SleeperDraftPick[]> {
  try {
    return await cachedGet<SleeperDraftPick[]>(
      `${PROXY_BASE}/draft/${encodeURIComponent(draftId)}/picks`,
      TTL.draftPicks,
      bypassCache,
    );
  } catch {
    return [];
  }
}

// ===========================================================================
// ADP — outlier (no /api/sleeper/* proxy)
// ===========================================================================
// getRookieBoardADP is not part of the Phase M proxy set: Sleeper's projections
// endpoint lives at a different host path and is hit on a separate cadence. It
// keeps the direct-to-Sleeper fetch and stays outside the browser cache layer.
// (The player map + NFL state are served by the shared `/api/players` proxy.)

// This bypasses the proxy + browser cache, so it is one of the flakiest call
// paths. Wrap in withRetry so a single transient blip on a hub switch doesn't
// hard-fail. Retries only fire on failure — successful
// requests (the norm) cost nothing extra.
async function getOrNull<T>(url: string): Promise<T | null> {
  try {
    return await withRetry<T>(async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Sleeper API error ${res.status} — ${url}`);
      return (await res.json()) as T;
    }, 3);
  } catch {
    return null;
  }
}

/**
 * Fetch dynasty ADP projections for a given season year.
 * Used to populate the rookie big board with ADP data.
 */
async function getRookieBoardADP(year: string): Promise<Record<string, unknown>[]> {
  const url =
    `${SLEEPER_PROJECTIONS_BASE}/${encodeURIComponent(year)}` +
    `?season_type=regular&position=QB&position=RB&position=WR&position=TE&order_by=adp_dynasty_2qb`;
  const result = await getOrNull<Record<string, unknown>[]>(url);
  return result ?? [];
}

// ===========================================================================
// Exported API object
// ===========================================================================

export const sleeperApi = {
  getUserByUsername,
  getUserById,
  getUserLeagues,
  getLeagueRosters,
  getLeagueUsers,
  getLeagueInfo,
  getLeagueMatchups,
  getLeagueTransactions,
  getLeagueTransactionsMultiWeek,
  getLeagueTradedPicks,
  getLeagueDrafts,
  getDraftPicks,
  getRookieBoardADP,
} as const;
