// ============================================================
// LeagueSafe links — each league's LeagueSafe page per season, kept in the
// Management Hub (leaguesafe_links, migration 081) over the same four
// calendar years as the Paid columns (getPaymentYears).
//
// Sleeper gives a renewed dynasty league a new league_id every season, so a
// 2029 link saved in 2026 sits under the 2026 league_id. A league reads its
// links through previous_league_id (resolveLeagueSafeLinks), and
// getLeagueSafeCarryForward copies them onto the renewed league so the chain
// never needs more than that one hop.
// ============================================================
import type { LeagueSafeLinks } from "../types";

type LeagueChainRef = { league_id: string; previous_league_id?: string | null };

export interface LeagueSafeRow {
  league_id: string;
  season: number;
  url: string;
}

/** A pasted link, trimmed: "" clears the season, a bare "leaguesafe.com/…"
 *  gets https://, and anything that isn't an http(s) web address is null, so
 *  a javascript: link can never be saved or rendered as an href. */
export function normalizeLeagueSafeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!parsed.hostname.includes(".")) return null;
  return parsed.href;
}

/** A league's links by season: the rows saved under the league it renewed
 *  from, under its own rows. Its own row wins even when "" (cleared), so a
 *  cleared season doesn't come back from last year's league. */
export function resolveLeagueSafeLinks(league: LeagueChainRef, stored: LeagueSafeLinks): Record<number, string> {
  const previous = league.previous_league_id ? stored[league.previous_league_id] : undefined;
  return { ...(previous ?? {}), ...(stored[league.league_id] ?? {}) };
}

/** Rows to copy onto renewed leagues: each season in `years` with a link
 *  under previous_league_id and no row of the league's own yet. */
export function getLeagueSafeCarryForward(
  leagues: LeagueChainRef[],
  stored: LeagueSafeLinks,
  years: number[],
): LeagueSafeRow[] {
  const rows: LeagueSafeRow[] = [];
  for (const league of leagues) {
    const previous = league.previous_league_id ? stored[league.previous_league_id] : undefined;
    if (!previous) continue;
    const own = stored[league.league_id] ?? {};
    for (const season of years) {
      const url = previous[season];
      if (url && own[season] === undefined) rows.push({ league_id: league.league_id, season, url });
    }
  }
  return rows;
}

/** Seasons in `years` with no LeagueSafe link. */
export function getMissingLeagueSafeYears(links: Record<number, string> | undefined, years: number[]): number[] {
  return years.filter((year) => !links?.[year]);
}
