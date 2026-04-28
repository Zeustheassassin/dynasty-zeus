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
import {
  SLEEPER_BASE_URL,
} from "./constants";
import type {
  SleeperUser,
  SleeperLeague,
  SleeperRoster,
  SleeperMatchup,
  SleeperTransaction,
  SleeperDraft,
  SleeperDraftPick,
  SleeperTradedPick,
  SleeperNFLState,
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
  return cachedFetch<T>(url, { ttlMs, bypass });
}

async function cachedGetOrNull<T>(url: string, ttlMs: number): Promise<T | null> {
  try {
    return await cachedFetch<T>(url, { ttlMs });
  } catch {
    return null;
  }
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

/** Fetch all rosters in a league. */
async function getLeagueRosters(leagueId: string): Promise<SleeperRoster[]> {
  return cachedGet<SleeperRoster[]>(
    `${PROXY_BASE}/league/${encodeURIComponent(leagueId)}/rosters`,
    TTL.leagueRosters,
  );
}

/** Fetch the league user list (display names, avatars, metadata). Returns [] on any error. */
async function getLeagueUsers(leagueId: string): Promise<SleeperUser[]> {
  const result = await cachedGetOrNull<SleeperUser[]>(
    `${PROXY_BASE}/league/${encodeURIComponent(leagueId)}/users`,
    TTL.leagueUsers,
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

/** Fetch all matchups for a given week (1-22). */
async function getLeagueMatchups(leagueId: string, week: number): Promise<SleeperMatchup[]> {
  return cachedGet<SleeperMatchup[]>(
    `${PROXY_BASE}/league/${encodeURIComponent(leagueId)}/matchups/${week}`,
    TTL.leagueMatchups,
  );
}

// ===========================================================================
// TRANSACTION endpoints
// ===========================================================================

/** Fetch transactions for a single week. Returns [] on any error. */
async function getLeagueTransactions(
  leagueId: string,
  week: number
): Promise<SleeperTransaction[]> {
  const result = await cachedGetOrNull<SleeperTransaction[]>(
    `${PROXY_BASE}/league/${encodeURIComponent(leagueId)}/transactions/${week}`,
    TTL.leagueTransactions,
  );
  return result ?? [];
}

/** Convenience: fetch multiple weeks of transactions in parallel. */
async function getLeagueTransactionsMultiWeek(
  leagueId: string,
  weeks: number[]
): Promise<SleeperTransaction[]> {
  const results = await Promise.all(weeks.map((w) => getLeagueTransactions(leagueId, w)));
  return results.flat();
}

// ===========================================================================
// TRADED PICKS endpoints
// ===========================================================================

/** Fetch all traded picks in a league (past + future). */
async function getLeagueTradedPicks(leagueId: string): Promise<SleeperTradedPick[]> {
  const result = await cachedGetOrNull<SleeperTradedPick[]>(
    `${PROXY_BASE}/league/${encodeURIComponent(leagueId)}/traded-picks`,
    TTL.leagueTradedPicks,
  );
  return result ?? [];
}

// ===========================================================================
// DRAFT endpoints
// ===========================================================================

/** Fetch all drafts associated with a league. */
async function getLeagueDrafts(leagueId: string): Promise<SleeperDraft[]> {
  const result = await cachedGetOrNull<SleeperDraft[]>(
    `${PROXY_BASE}/league/${encodeURIComponent(leagueId)}/drafts`,
    TTL.leagueDrafts,
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
// PLAYER / NFL STATE / ADP — outliers (no /api/sleeper/* proxy)
// ===========================================================================
// These three call paths are not part of the Phase M proxy set:
//   • getAllPlayers / getNFLState — the shared `/api/players` proxy returns
//     a slimmed combined `{ players, nflState }` shape; switching here would
//     change the function signatures.
//   • getRookieBoardADP — Sleeper's projections endpoint lives at a different
//     host path and is hit on a separate cadence.
// They keep the original direct-to-Sleeper fetch and stay outside the
// browser cache layer for now. Revisit if/when proxies are added.

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sleeper API error ${res.status} — ${url}`);
  return res.json() as Promise<T>;
}

async function getOrNull<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

/**
 * Fetch the full NFL player map from Sleeper.
 * This is a heavy payload (~5 MB). Cache it where possible.
 */
async function getAllPlayers(): Promise<Record<string, import("./types").SleeperPlayer>> {
  return get<Record<string, import("./types").SleeperPlayer>>(`${SLEEPER_BASE_URL}/players/nfl`);
}

/** Fetch the current NFL week/season state. */
async function getNFLState(): Promise<SleeperNFLState> {
  return get<SleeperNFLState>(`${SLEEPER_BASE_URL}/state/nfl`);
}

/**
 * Fetch dynasty ADP projections for a given season year.
 * Used to populate the rookie big board with ADP data.
 */
async function getRookieBoardADP(year: string): Promise<Record<string, unknown>[]> {
  const url =
    `https://api.sleeper.app/projections/nfl/${encodeURIComponent(year)}` +
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
  getAllPlayers,
  getNFLState,
  getRookieBoardADP,
} as const;
