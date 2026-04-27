// CollegeFootballData (CFD) API client for recruiting data.
// CFD's recruiting feed IS the 247Sports Composite — that's the only source they ingest.
// One call per year returns the full HighSchool class (no pagination, ~3k records, ~1MB).
// Free-tier rate limit is ~1000 calls/month; we cache aggressively in Supabase.

const CFD_BASE = "https://api.collegefootballdata.com";

export interface CfdRecruit {
  id: string | number | null;
  athleteId?: string | number | null;
  recruitType?: string;
  year: number;
  ranking: number | null;
  name: string;
  school: string | null;
  committedTo: string | null;
  position: string | null;
  height: number | null;
  weight: number | null;
  stars: number | null;
  rating: number | null;
  city: string | null;
  stateProvince: string | null;
  country: string | null;
  hometownInfo?: { latitude?: number; longitude?: number; fipsCode?: string } | null;
}

/**
 * Normalized shape stored in the `recruits` Supabase table — snake_case columns,
 * id always coerced to string (CFD returns numeric ids but we store as text PK).
 */
export interface RecruitRow {
  id: string;
  year: number;
  ranking: number | null;
  name: string;
  position: string | null;
  stars: number | null;
  rating: number | null;
  height: number | null;
  weight: number | null;
  school: string | null;
  committed_to: string | null;
  city: string | null;
  state_province: string | null;
  country: string | null;
  athlete_id: string | null;
}

/**
 * Fetch the full HighSchool recruiting class for a given year from CFD.
 * Throws on non-200 or auth failure — caller should catch and surface to user.
 */
export async function fetchCfdRecruits(year: number, apiKey: string): Promise<CfdRecruit[]> {
  const url = `${CFD_BASE}/recruiting/players?year=${year}&classification=HighSchool`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    // 60s ceiling — large classes (~1MB) over slow networks can take 10-15s
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`CFD auth failed (${res.status}) — check CFD_API_KEY`);
  }
  if (res.status === 429) {
    throw new Error("CFD rate limit hit — try again later");
  }
  if (!res.ok) {
    throw new Error(`CFD request failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("CFD returned non-array response");
  return data as CfdRecruit[];
}

/** Map CFD's camelCase response into our snake_case row shape, dropping unused fields. */
export function toRecruitRow(r: CfdRecruit): RecruitRow | null {
  if (r.id == null || !r.name) return null;
  return {
    id: String(r.id),
    year: r.year,
    ranking: r.ranking ?? null,
    name: r.name,
    position: r.position ?? null,
    stars: r.stars ?? null,
    rating: r.rating ?? null,
    height: r.height ?? null,
    weight: r.weight ?? null,
    school: r.school ?? null,
    committed_to: r.committedTo ?? null,
    city: r.city ?? null,
    state_province: r.stateProvince ?? null,
    country: r.country ?? null,
    athlete_id: r.athleteId != null ? String(r.athleteId) : null,
  };
}
