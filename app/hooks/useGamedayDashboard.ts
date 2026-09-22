"use client";
import { useState, useCallback, useMemo, useRef } from "react";
import { sleeperApi } from "../../lib/sleeperApi";
import { buildGamedayDashboardEntries } from "../../lib/helpers";
import { withConcurrency } from "../../lib/concurrency";
import { GAMEDAY_DASHBOARD_CONCURRENCY } from "../../lib/constants";
import type { StatLine } from "../../lib/helpers/gamedayLive";
import type {
  SleeperLeague, SleeperUser, SleeperPlayer, ProjectionRow,
  GamedayDashboardEntry, GamedayDashboardRaw, TeamGameState,
} from "../../lib/types";

export interface GamedayDashboardInputs {
  user: SleeperUser | null;
  players: Record<string, SleeperPlayer>;
  projectionData: ProjectionRow[];
  scheduleByTeam: Record<string, TeamGameState>;
  /** Live cumulative stat lines for per-stat pace (optional; empty = points-level pace). */
  liveStatsByPlayerId?: Record<string, StatLine>;
}

// Stable empty default so an omitted `liveStatsByPlayerId` doesn't bust the memo every render.
const NO_LIVE_STATS: Record<string, StatLine> = {};

// Cross-league "my matchups only" view. Deliberately separate from
// gamedayMatchupCards (single selected league): this fetches full rosters +
// matchups for EVERY league the user is in, which the cached single-league
// `rosters`/`users` state can't supply since those only ever hold the
// currently-selected league's data.
//
// The fetched data is stored raw and the scored entries are derived from it
// with the *current* players/projections/scoreboard, so a live scoreboard
// update re-scores every card without another round of Sleeper requests.
export function useGamedayDashboard({ user, players, projectionData, scheduleByTeam, liveStatsByPlayerId = NO_LIVE_STATS }: GamedayDashboardInputs) {
  const [rawEntries, setRawEntries] = useState<GamedayDashboardRaw[]>([]);
  const [loadingGamedayDashboard, setLoadingGamedayDashboard] = useState(false);
  const [gamedayDashboardWeek, setGamedayDashboardWeek] = useState<number | null>(null);
  const [gamedayDashboardUpdatedAt, setGamedayDashboardUpdatedAt] = useState<number | null>(null);
  const weekRef = useRef<number | null>(null);

  const gamedayDashboardEntries = useMemo(
    (): GamedayDashboardEntry[] => (
      gamedayDashboardWeek
        ? buildGamedayDashboardEntries(rawEntries, user, gamedayDashboardWeek, players, projectionData, scheduleByTeam, liveStatsByPlayerId)
        : []
    ),
    [rawEntries, user, gamedayDashboardWeek, players, projectionData, scheduleByTeam, liveStatsByPlayerId]
  );

  /** Full load: rosters + users + matchups for every league. `bypass` only skips
   *  the matchup caches — rosters/users don't change during a game. */
  const loadGamedayDashboard = useCallback(async (
    leagues: SleeperLeague[],
    user: SleeperUser | null,
    week: number,
    opts?: { bypass?: boolean },
  ) => {
    if (!user?.user_id || !leagues.length || !week) return;
    weekRef.current = week;
    setLoadingGamedayDashboard(true);
    try {
      // Fetched GAMEDAY_DASHBOARD_CONCURRENCY leagues at a time (3 Sleeper calls each) rather
      // than firing every league at once — an uncapped fan-out here hit the same 429 risk
      // Batch 5 found and fixed for cross-league intel (Sept 22 code-review 50-league-
      // scalability finding, Tier 1 #1).
      const results = await withConcurrency(leagues, async (league): Promise<GamedayDashboardRaw> => {
        try {
          const [rosters, users, matchups] = await Promise.all([
            sleeperApi.getLeagueRosters(league.league_id),
            sleeperApi.getLeagueUsers(league.league_id),
            sleeperApi.getLeagueMatchups(league.league_id, week, opts?.bypass),
          ]);
          return { league, error: false, rosters, users, matchups };
        } catch {
          return { league, error: true, rosters: [], users: [], matchups: [] };
        }
      }, GAMEDAY_DASHBOARD_CONCURRENCY);
      if (weekRef.current !== week) return;
      setRawEntries(results);
      setGamedayDashboardWeek(week);
      setGamedayDashboardUpdatedAt(Date.now());
    } finally {
      setLoadingGamedayDashboard(false);
    }
  }, []);

  /** Live refresh: re-pull just the matchup totals (cache bypassed) for the given
   *  leagues, leaving every other league and all rosters/users untouched. A league
   *  whose refetch fails keeps its previous data. */
  const refreshGamedayDashboardMatchups = useCallback(async (leagueIds: string[], week: number) => {
    if (!week || !leagueIds.length) return;
    const fresh = new Map<string, GamedayDashboardRaw["matchups"]>();
    // Same GAMEDAY_DASHBOARD_CONCURRENCY cap as loadGamedayDashboard above — this refresh
    // re-runs every poll tick during a live slate, so an uncapped fan-out here repeats the
    // 429 risk on every single tick rather than just once per page load.
    await withConcurrency(leagueIds, async (leagueId) => {
      try {
        fresh.set(leagueId, await sleeperApi.getLeagueMatchups(leagueId, week, true));
      } catch { /* keep previous */ }
    }, GAMEDAY_DASHBOARD_CONCURRENCY);
    if (weekRef.current !== week || fresh.size === 0) return;
    setRawEntries((prev) => prev.map((item) => {
      const matchups = fresh.get(item.league.league_id);
      return matchups && !item.error ? { ...item, matchups } : item;
    }));
    setGamedayDashboardUpdatedAt(Date.now());
  }, []);

  return {
    gamedayDashboardEntries,
    loadingGamedayDashboard,
    gamedayDashboardWeek,
    gamedayDashboardUpdatedAt,
    loadGamedayDashboard,
    refreshGamedayDashboardMatchups,
  };
}
