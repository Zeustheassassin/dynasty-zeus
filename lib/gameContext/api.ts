// Request/response shapes of POST /api/scouting/context, shared by the route
// and the Scouting → PFF Links panel. Types and constants only: client-safe.

/** Prospects per POST /api/scouting/context (about one PFF read per new game). */
export const CONTEXT_FILL_BATCH = 6;

export interface ContextFillResult {
  prospectId: string;
  /** Charted games given a context row this run. */
  games: number;
  /** Games matched to their CollegeFootballData game. */
  matched?: number;
  /** Games with weather in (or a dome). */
  weather?: number;
  /** Games from the last few days, waiting on the weather archive. */
  weatherPending?: number;
  /** Games with the supporting cast in. */
  cast?: number;
  unmatched?: { gameId: string; reason: string }[];
  error?: string;
}

export interface ContextFillResponse {
  results: ContextFillResult[];
  /** CollegeFootballData lists fetched this run (most runs: none). */
  cfdFetched: string[];
  /** CollegeFootballData calls left this month, when a list was fetched. */
  cfdRemaining: number | null;
  /** Set when PFF's read budget ran out mid-batch: wait this long, then resend the unreached ids. */
  retryAfterMs: number | null;
}
