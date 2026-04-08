// ============================================================
// Sleeper API client
// ============================================================
// A single place for every Sleeper HTTP call so that URL changes,
// error handling, and retries only need to be updated here.
//
// All functions are async and return typed results.  They throw on
// non-OK responses so callers can handle errors uniformly.
//
// Usage:
//   import { sleeperApi } from "@/lib/sleeperApi";
//   const user = await sleeperApi.getUserByUsername("john_doe");
// ============================================================

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

const BASE = "https://api.sleeper.app/v1";

// ---------------------------------------------------------------------------
// Internal helper — fetch + JSON parse with a descriptive error on failure
// ---------------------------------------------------------------------------
async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Sleeper API error ${res.status} — ${url}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Helper — like get() but returns null instead of throwing (for optional calls)
// ---------------------------------------------------------------------------
async function getOrNull<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

// ===========================================================================
// USER endpoints
// ===========================================================================

/** Fetch a Sleeper user by username. */
async function getUserByUsername(username: string): Promise<SleeperUser> {
  return get<SleeperUser>(`${BASE}/user/${encodeURIComponent(username)}`);
}

/** Fetch a Sleeper user by user_id. */
async function getUserById(userId: string): Promise<SleeperUser | null> {
  return getOrNull<SleeperUser>(`${BASE}/user/${userId}`);
}

// ===========================================================================
// LEAGUE endpoints
// ===========================================================================

/** Fetch all leagues for a user in a given NFL season year. */
async function getUserLeagues(userId: string, year: string): Promise<SleeperLeague[]> {
  return get<SleeperLeague[]>(`${BASE}/user/${userId}/leagues/nfl/${year}`);
}

// ===========================================================================
// ROSTER endpoints
// ===========================================================================

/** Fetch all rosters in a league. */
async function getLeagueRosters(leagueId: string): Promise<SleeperRoster[]> {
  return get<SleeperRoster[]>(`${BASE}/league/${leagueId}/rosters`);
}

// ===========================================================================
// MATCHUP endpoints
// ===========================================================================

/** Fetch all matchups for a given week (1-18). */
async function getLeagueMatchups(leagueId: string, week: number): Promise<SleeperMatchup[]> {
  return get<SleeperMatchup[]>(`${BASE}/league/${leagueId}/matchups/${week}`);
}

// ===========================================================================
// TRANSACTION endpoints
// ===========================================================================

/** Fetch transactions for a single week. Returns [] on any error. */
async function getLeagueTransactions(
  leagueId: string,
  week: number
): Promise<SleeperTransaction[]> {
  const result = await getOrNull<SleeperTransaction[]>(
    `${BASE}/league/${leagueId}/transactions/${week}`
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
  const result = await getOrNull<SleeperTradedPick[]>(`${BASE}/league/${leagueId}/traded_picks`);
  return result ?? [];
}

// ===========================================================================
// DRAFT endpoints
// ===========================================================================

/** Fetch all drafts associated with a league. */
async function getLeagueDrafts(leagueId: string): Promise<SleeperDraft[]> {
  const result = await getOrNull<SleeperDraft[]>(`${BASE}/league/${leagueId}/drafts`);
  return result ?? [];
}

/** Fetch all picks made in a draft. */
async function getDraftPicks(draftId: string): Promise<SleeperDraftPick[]> {
  const result = await getOrNull<SleeperDraftPick[]>(`${BASE}/draft/${draftId}/picks`);
  return result ?? [];
}

// ===========================================================================
// PLAYER endpoints
// ===========================================================================

/**
 * Fetch the full NFL player map from Sleeper.
 * This is a heavy payload (~5 MB).  Cache it where possible.
 */
async function getAllPlayers(): Promise<Record<string, import("./types").SleeperPlayer>> {
  return get<Record<string, import("./types").SleeperPlayer>>(`${BASE}/players/nfl`);
}

// ===========================================================================
// NFL STATE endpoint
// ===========================================================================

/** Fetch the current NFL week/season state. */
async function getNFLState(): Promise<SleeperNFLState> {
  return get<SleeperNFLState>(`${BASE}/state/nfl`);
}

// ===========================================================================
// PROJECTIONS / ADP endpoint
// ===========================================================================

/**
 * Fetch dynasty ADP projections for a given season year.
 * Used to populate the rookie big board with ADP data.
 */
async function getRookieBoardADP(year: string): Promise<Record<string, unknown>[]> {
  const url =
    `https://api.sleeper.app/projections/nfl/${year}` +
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
