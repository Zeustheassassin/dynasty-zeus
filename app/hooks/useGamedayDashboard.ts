"use client";
import { useState, useCallback } from "react";
import { sleeperApi } from "../../lib/sleeperApi";
import { buildGamedayMatchups } from "../../lib/helpers";
import type {
  SleeperLeague, SleeperUser, SleeperPlayer, ProjectionRow,
  GamedayDashboardEntry, TeamGameState,
} from "../../lib/types";

// Cross-league "my matchups only" view. Deliberately separate from
// gamedayMatchupCards (single selected league): this fetches full rosters +
// matchups for EVERY league the user is in, which the cached single-league
// `rosters`/`users` state can't supply since those only ever hold the
// currently-selected league's data.
export function useGamedayDashboard() {
  const [gamedayDashboardEntries, setGamedayDashboardEntries] = useState<GamedayDashboardEntry[]>([]);
  const [loadingGamedayDashboard, setLoadingGamedayDashboard] = useState(false);
  const [gamedayDashboardWeek, setGamedayDashboardWeek] = useState<number | null>(null);

  const loadGamedayDashboard = useCallback(async (
    leagues: SleeperLeague[],
    user: SleeperUser | null,
    week: number,
    players: Record<string, SleeperPlayer>,
    projectionData: ProjectionRow[],
    scheduleByTeam: Record<string, TeamGameState>,
  ) => {
    if (!user?.user_id || !leagues.length || !week) return;
    setLoadingGamedayDashboard(true);
    try {
      const results = await Promise.all(leagues.map(async (league): Promise<GamedayDashboardEntry> => {
        try {
          const [rosters, leagueUsers, matchups] = await Promise.all([
            sleeperApi.getLeagueRosters(league.league_id),
            sleeperApi.getLeagueUsers(league.league_id),
            sleeperApi.getLeagueMatchups(league.league_id, week),
          ]);

          const myRoster = rosters.find((r) => r.owner_id === user.user_id);
          if (!myRoster) return { league, myTeam: null, oppTeam: null, error: false };

          const myEntry = matchups.find((m) => Number(m.roster_id) === Number(myRoster.roster_id));
          if (!myEntry) return { league, myTeam: null, oppTeam: null, error: false };

          const scopedMatchups = matchups.filter((m) => Number(m.matchup_id) === Number(myEntry.matchup_id));

          const userMap: Record<string, string> = {};
          rosters.forEach((r) => {
            const u = leagueUsers.find((lu) => lu.user_id === r.owner_id);
            if (u) {
              userMap[r.roster_id] = u.display_name;
              userMap[r.owner_id] = u.display_name;
            }
          });

          const [matchup] = buildGamedayMatchups(league, rosters, scopedMatchups, week, players, projectionData, userMap, scheduleByTeam);
          const myTeam = matchup?.teams.find((t) => t.rosterId === myRoster.roster_id) ?? null;
          const oppTeam = matchup?.teams.find((t) => t.rosterId !== myRoster.roster_id) ?? null;
          return { league, myTeam, oppTeam, error: false };
        } catch {
          return { league, myTeam: null, oppTeam: null, error: true };
        }
      }));
      setGamedayDashboardEntries(results);
      setGamedayDashboardWeek(week);
    } finally {
      setLoadingGamedayDashboard(false);
    }
  }, []);

  return {
    gamedayDashboardEntries,
    loadingGamedayDashboard,
    gamedayDashboardWeek,
    loadGamedayDashboard,
  };
}
