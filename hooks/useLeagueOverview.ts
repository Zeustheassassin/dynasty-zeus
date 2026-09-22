"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { logger } from "../lib/logger";
import { sleeperApi } from "../lib/sleeperApi";
import { buildLeaguePickPool } from "../lib/helpers";
import type {
  SleeperLeague,
  LeagueOverviewEntry,
} from "../lib/types";

const log = logger("hooks/useLeagueOverview");

interface SleeperUserShape {
  user_id: string;
}

export function useLeagueOverview(
  leagues: SleeperLeague[],
  user: SleeperUserShape | null
) {
  const [leagueOverviewData, setLeagueOverviewData] = useState<Record<string, LeagueOverviewEntry>>({});
  const [loadingLeagueOverview, setLoadingLeagueOverview] = useState(false);
  const [leagueOverviewLoaded, setLeagueOverviewLoaded] = useState(false);
  const [leagueOverviewError, setLeagueOverviewError] = useState<string | null>(null);
  const [leagueOverviewUpdatedAt, setLeagueOverviewUpdatedAt] = useState<number | null>(null);

  // Stable refs so loadLeagueOverview stays a stable callback
  const leaguesRef = useRef(leagues);
  const userRef = useRef(user);
  useEffect(() => { leaguesRef.current = leagues; }, [leagues]);
  useEffect(() => { userRef.current = user; }, [user]);
  // Monotonic guard so an earlier in-flight load can't overwrite a newer one.
  const overviewSeq = useRef(0);

  const loadLeagueOverview = useCallback(async () => {
    const currentLeagues = leaguesRef.current;
    const currentUser = userRef.current;
    if (!currentLeagues.length || !currentUser) return;
    const seq = ++overviewSeq.current;
    setLoadingLeagueOverview(true);
    setLeagueOverviewError(null);
    try {
      const results = await Promise.all(
        currentLeagues.map(async (league) => {
          try {
            const [rostersData, tradedPicksData, draftsData, usersData] = await Promise.all([
              sleeperApi.getLeagueRosters(league.league_id),
              sleeperApi.getLeagueTradedPicks(league.league_id),
              sleeperApi.getLeagueDrafts(league.league_id),
              sleeperApi.getLeagueUsers(league.league_id),
            ]);

            const leagueUserMap: Record<string, string> = {};
            (usersData || []).forEach((u) => {
              leagueUserMap[u.user_id] =
                u.display_name || u.username || u.metadata?.team_name || `Team`;
            });

            // Pick pool: shared with useAppState.loadRoster/useSpyState via buildLeaguePickPool.
            // Overview renders every league at once, so it caps round depth at ROUNDS.length
            // and skips the per-league round trim/slot fallback the other two callers use —
            // see __tests__/hooks/pickWindowCopies.test.ts for the pinned per-caller behavior.
            const tempPicks = buildLeaguePickPool(rostersData, tradedPicksData, draftsData, {
              roundsMode: "fixed",
              slotFallback: "bare-round",
              labelFutureSlots: false,
            });

            return { league, rosters: rostersData, picks: tempPicks, userMap: leagueUserMap };
          } catch (err) {
            log.warn("loadLeagueOverview league fetch error", { err: String(err) });
            return null;
          }
        })
      );

      if (seq !== overviewSeq.current) return; // a newer load started — discard stale result
      const byLeague: Record<string, LeagueOverviewEntry> = {};
      results
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .forEach(({ league, rosters: lr, picks, userMap }) => {
          byLeague[league.league_id] = { league, rosters: lr, picks, userMap };
        });
      setLeagueOverviewData(byLeague);
      setLeagueOverviewLoaded(true);
      // If every league failed (empty result on a non-empty league list), surface an error.
      if (Object.keys(byLeague).length === 0 && currentLeagues.length > 0) {
        setLeagueOverviewError("Couldn't load league data. Sleeper may be unavailable — try again.");
      } else {
        setLeagueOverviewUpdatedAt(Date.now());
      }
    } catch (err) {
      log.error("loadLeagueOverview failed", { err: String(err) });
      if (seq === overviewSeq.current) {
        setLeagueOverviewError("Couldn't load league data. Sleeper may be unavailable — try again.");
      }
    } finally {
      if (seq === overviewSeq.current) setLoadingLeagueOverview(false);
    }
  }, []);

  return {
    leagueOverviewData,
    loadingLeagueOverview,
    leagueOverviewLoaded,
    leagueOverviewError,
    leagueOverviewUpdatedAt,
    loadLeagueOverview,
  };
}
