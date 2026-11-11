// ============================================================
// NFL draft picks: fetch Wikipedia's draft page (SERVER-ONLY)
// ============================================================
// One MediaWiki API read per draft year (the whole page's wikitext, ~35 KB
// for 2027), held in Next's Data Cache for a day: trades that move picks
// land on the page within a day or so, and nothing here needs it faster.
// The parsing and the ownership rules live in lib/nflDraftPicks.ts.
// ============================================================

import { draftCapital, parseDraftTrades, DRAFT_PICK_RESOLUTIONS, type DraftCapital } from "../nflDraftPicks";

const API = "https://en.wikipedia.org/w/api.php";
const FETCH_TIMEOUT_MS = 15_000;
/** A day: the Data Cache's refresh for a draft page. */
export const DRAFT_PAGE_REVALIDATE_S = 86_400;
/** Wikimedia asks API clients for a descriptive User-Agent. */
const USER_AGENT = "nfl-draft-capital-reader/1.0 (reads the Trades involving draft picks section once a day)";

export const draftPageTitle = (year: number) => `${year}_NFL_draft`;

export function draftPageApiUrl(year: number): string {
  const q = new URLSearchParams({
    action: "parse", page: draftPageTitle(year), prop: "wikitext|revid", format: "json", formatversion: "2", redirects: "1",
  });
  return `${API}?${q}`;
}

interface ParseAnswer {
  parse?: { title?: string; revid?: number; wikitext?: string };
  error?: { code?: string; info?: string };
}

export interface DraftPage {
  year: number;
  /** The page revision read: a stable reference when checking a pick by hand. */
  revid: number | null;
  wikitext: string;
}

/** The draft page's wikitext, or null when Wikipedia has no page for that year yet. Throws on a failed read. */
export async function fetchDraftPage(year: number, fetchFn: typeof fetch = fetch): Promise<DraftPage | null> {
  const res = await fetchFn(draftPageApiUrl(year), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    next: { revalidate: DRAFT_PAGE_REVALIDATE_S },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Wikipedia answered ${res.status} for ${draftPageTitle(year)}`);
  const body = (await res.json()) as ParseAnswer;
  if (body.error?.code === "missingtitle") return null;
  if (body.error) throw new Error(`Wikipedia: ${body.error.code ?? "error"} ${body.error.info ?? ""}`.trim());
  if (typeof body.parse?.wikitext !== "string") throw new Error(`Wikipedia sent no wikitext for ${draftPageTitle(year)}`);
  return { year, revid: body.parse.revid ?? null, wikitext: body.parse.wikitext };
}

export interface FetchedDraftCapital extends DraftCapital {
  revid: number | null;
  /** How many traded-pick bullets the page had (a sanity number for the caller). */
  tradedPicks: number;
}

/** Every team's picks for one draft from its Wikipedia page, with the user's settled disputes applied; null
 *  when the page doesn't exist yet. */
export async function fetchDraftCapital(year: number, fetchFn: typeof fetch = fetch): Promise<FetchedDraftCapital | null> {
  const page = await fetchDraftPage(year, fetchFn);
  if (!page) return null;
  const parse = parseDraftTrades(page.wikitext, year);
  return { ...draftCapital(parse, DRAFT_PICK_RESOLUTIONS), revid: page.revid, tradedPicks: parse.trades.length };
}
