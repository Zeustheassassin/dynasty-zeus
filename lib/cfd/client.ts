// ============================================================
// CollegeFootballData (CFD) API reads for the game context — SERVER-ONLY.
// ============================================================
// The key (CFD_API_KEY) never leaves the server. CFD's free tier allows about
// 1,000 calls a month, shared with the Recruits tab, and every response
// reports what's left (x-calllimit-remaining). So each list is fetched once
// per season into the shared cache tables (cache.ts) and refreshed only when
// it can have changed; nothing here is called per game.
// ============================================================

const CFD_BASE = "https://api.collegefootballdata.com";

export class CfdError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "CfdError";
  }
}

export interface CfdResponse<T> {
  body: T;
  /** Calls left this month, as CFD reports it (null if it didn't say). */
  remaining: number | null;
}

export type CfdGet = <T>(path: string, params: Record<string, string | number>) => Promise<CfdResponse<T>>;

/** A reader bound to the key, or null when CFD_API_KEY isn't set. */
export function getCfdReader(fetchImpl: typeof fetch = fetch): CfdGet | null {
  if (typeof window !== "undefined") throw new Error("lib/cfd/client is server-only");
  const key = process.env.CFD_API_KEY;
  if (!key) return null;
  return async <T,>(path: string, params: Record<string, string | number>) => {
    const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const res = await fetchImpl(`${CFD_BASE}${path}?${q.toString()}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 401 || res.status === 403) throw new CfdError(`CollegeFootballData refused the key (${res.status})`, res.status);
    if (res.status === 429) throw new CfdError("CollegeFootballData's monthly call limit is used up", 429);
    if (!res.ok) throw new CfdError(`CollegeFootballData ${path} failed: ${res.status}`, res.status);
    const left = Number(res.headers.get("x-calllimit-remaining"));
    return { body: (await res.json()) as T, remaining: Number.isFinite(left) ? left : null };
  };
}
