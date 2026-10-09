// ============================================================
// Which rookie class the Draft Hub's board shows.
// ============================================================
// The user's rule (2026-10-09): the board moves to the next class at the
// first Week 1 kickoff of an NFL season. Season Y's opener (e.g. NE @ SEA,
// 8:20 pm ET on 9/9/2026) turns it from class Y to Y+1, and it stays Y+1
// through the January rollover, when the calendar catches up.
//
// So: the season that starts in this calendar year has kicked off → year + 1,
// otherwise → year. The answer is the same either side of New Year's Eve, so
// the time zone of "year" never matters.
//
// The kickoff is ESPN's real Week 1 schedule (never a guess from projection
// timestamps). Without it, Sleeper's /state/nfl stands in: its regular-season
// week reaches 1 a few days before the opener, so that fallback can flip a
// little early. With neither, the calendar year.
//
// Deliberately separate from ROOKIE_YEAR (hooks/useRookieBoardState.ts),
// which also drives the simulator's pick season and the Draft Scout modal and
// must keep tracking the calendar.
// ============================================================

import type { TeamGameState } from "../types";

export type DraftClassSource = "espn" | "sleeper" | "calendar";

export interface DraftClass {
  year: number;
  /** What decided it: ESPN's Week 1 kickoff, Sleeper's week, or the calendar alone. */
  source: DraftClassSource;
}

/** The parts of Sleeper's /state/nfl this reads. */
export interface DraftClassNflState {
  season?: string | null;
  season_type?: string | null;
  week?: number | null;
}

/**
 * The draft board's class at `now`.
 *
 * @param week1KickoffAt The first Week 1 kickoff (ms) of the NFL season that
 *   starts in `now`'s calendar year, or null when unknown (no schedule yet, or
 *   ESPN failed).
 * @param nflState Sleeper's /state/nfl, the fallback when the kickoff is unknown.
 */
export function draftBoardClass(
  now: Date,
  week1KickoffAt: number | null,
  nflState?: DraftClassNflState | null,
): DraftClass {
  const year = now.getFullYear();
  if (week1KickoffAt != null && Number.isFinite(week1KickoffAt)) {
    return { year: now.getTime() >= week1KickoffAt ? year + 1 : year, source: "espn" };
  }
  if (nflState && /^\d{4}$/.test(String(nflState.season ?? ""))) {
    // Sleeper's season is this year's only from its offseason rollover on;
    // in January it's still last year's, which kicked off long ago and
    // whose class is this calendar year.
    const kicked = Number(nflState.season) === year && (
      (nflState.season_type === "regular" && Number(nflState.week) >= 1) || nflState.season_type === "post"
    );
    return { year: kicked ? year + 1 : year, source: "sleeper" };
  }
  return { year, source: "calendar" };
}

/**
 * The first kickoff in a Week 1 scoreboard (lib/espnScoreboard.ts, keyed by
 * team), or null without one. Only games in `season`'s calendar year count, so
 * a reply for some other season can't stand in.
 */
export function firstKickoff(games: Record<string, TeamGameState> | null | undefined, season: number): number | null {
  let first: number | null = null;
  for (const g of Object.values(games ?? {})) {
    const at = g?.kickoffAt;
    if (typeof at !== "number" || !Number.isFinite(at) || new Date(at).getUTCFullYear() !== season) continue;
    if (first == null || at < first) first = at;
  }
  return first;
}
