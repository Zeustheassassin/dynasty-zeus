"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { logger } from "../lib/logger";
import { fetchLeagueCore } from "./leagueCoreFetch";
import { buildLeaguePickPool } from "../lib/helpers";
import { withConcurrency } from "../lib/concurrency";
import { LEAGUE_OVERVIEW_CONCURRENCY } from "../lib/constants";
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
  // Dedupes calls landing in the same render pass — e.g. the OVERVIEW-tab effect and the
  // player-profile-open effect in useAppState.ts can both call loadLeagueOverview() before
  // leagueOverviewLoaded flips true, each previously starting its own full per-league fan-out.
  // A call made while one is already running now joins that same in-flight promise instead of
  // firing a redundant fetch (Sept 22 code-review 50-league-scalability, Tier 2 finding #7).
  const inFlightRef = useRef<Promise<void> | null>(null);

  const loadLeagueOverview = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;

    const run = async () => {
      const currentLeagues = leaguesRef.current;
      const currentUser = userRef.current;
      if (!currentLeagues.length || !currentUser) return;
      const seq = ++overviewSeq.current;
      setLoadingLeagueOverview(true);
      setLeagueOverviewError(null);
      try {
        const fetchLeague = async (league: SleeperLeague) => {
          try {
            const { rosters, tradedPicks, drafts, userMap } = await fetchLeagueCore(league.league_id);

            // Pick pool: shared with useAppState.loadRoster/useSpyState via buildLeaguePickPool.
            // Overview renders every league at once, so it caps round depth at ROUNDS.length
            // and skips the per-league round trim/slot fallback the other two callers use —
            // see __tests__/hooks/pickWindowCopies.test.ts for the pinned per-caller behavior.
            const tempPicks = buildLeaguePickPool(rosters, tradedPicks, drafts, "overview");

            return { league, rosters, picks: tempPicks, userMap };
          } catch (err) {
            log.warn("loadLeagueOverview league fetch error", { err: String(err) });
            return null;
          }
        };

        // Fetched LEAGUE_OVERVIEW_CONCURRENCY leagues at a time (4 Sleeper calls each) rather
        // than firing every league at once — an uncapped fan-out here hit the same 429 risk
        // Batch 5 found and fixed for cross-league intel (Sept 22 code-review P1 finding #3).
        const results = await withConcurrency(currentLeagues, fetchLeague, LEAGUE_OVERVIEW_CONCURRENCY, {
          shouldBail: () => seq !== overviewSeq.current, // a newer load started — stop fetching for this one
        });

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
    };

    const promise = run().finally(() => {
      inFlightRef.current = null;
    });
    inFlightRef.current = promise;
    return promise;
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
