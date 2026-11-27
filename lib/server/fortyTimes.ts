// ============================================================
// Fill 40s: read the two sources (SERVER-ONLY)
// ============================================================
// WalterFootball's position rankings page for projected 40s (robots.txt
// allows all; read with an honest User-Agent, one page per position and
// class, held in Next's Data Cache for a day so repeat clicks don't re-read
// the site), and nflverse's combine.csv for the official 40s and weigh-ins (a
// public GitHub release, ~0.9 MB, held for 12 hours). The parsing is
// lib/scouting/fortyFill.ts. The same file gives Measured sizes its combine
// heights and weights (fetchCombineSizes; lib/scouting/measuredSize.ts).
// ============================================================

import { parseCombineCsv, parseWalterFootballPage, type FortyPos, type FortyRow } from "../scouting/fortyFill";
import { parseCombineSizes, type CombineSizeRow } from "../scouting/measuredSize";

export const COMBINE_CSV_URL = "https://github.com/nflverse/nflverse-data/releases/download/combine/combine.csv";
const USER_AGENT = "dynastyzeus-forty-reader/1.0 (projected 40s for a private scouting board, read on request)";
const FETCH_TIMEOUT_MS = 20_000;
/** A day for a projections page; they move slowly. */
export const PROJECTIONS_REVALIDATE_S = 86_400;
/** Twelve hours for combine.csv, so a new combine shows up the same day. */
export const COMBINE_REVALIDATE_S = 43_200;

export const walterFootballUrl = (pos: FortyPos, year: number) => `https://walterfootball.com/${pos}Rankings${year}.php`;

/** WalterFootball's projected 40s at a position in a class; empty when it has no page for that class yet. */
export async function fetchProjectedPosition(year: number, pos: FortyPos, fetchFn: typeof fetch = fetch): Promise<FortyRow[]> {
  const res = await fetchFn(walterFootballUrl(pos, year), {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    next: { revalidate: PROJECTIONS_REVALIDATE_S },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`WalterFootball answered ${res.status} for ${pos} ${year}`);
  return parseWalterFootballPage(await res.text(), pos);
}

/** nflverse's combine.csv, held in the Data Cache for 12 hours (Fill 40s and Measured sizes share it). */
async function fetchCombineCsv(fetchFn: typeof fetch): Promise<string> {
  const res = await fetchFn(COMBINE_CSV_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/csv" },
    next: { revalidate: COMBINE_REVALIDATE_S },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`nflverse combine.csv answered ${res.status}`);
  return res.text();
}

/** The combine's 40s at a position for a draft year; null when that year's combine isn't in the file yet. */
export async function fetchCombinePosition(year: number, pos: FortyPos, fetchFn: typeof fetch = fetch): Promise<FortyRow[] | null> {
  const { rows, inYear } = parseCombineCsv(await fetchCombineCsv(fetchFn), year);
  return inYear === 0 ? null : rows.filter((r) => r.position === pos);
}

/** Every QB / RB / WR / TE's combine height and weight for a draft year (measuredSize.ts); null when that year's combine isn't in yet. */
export async function fetchCombineSizes(year: number, fetchFn: typeof fetch = fetch): Promise<CombineSizeRow[] | null> {
  const { rows, inYear } = parseCombineSizes(await fetchCombineCsv(fetchFn), year);
  return inYear === 0 ? null : rows;
}
