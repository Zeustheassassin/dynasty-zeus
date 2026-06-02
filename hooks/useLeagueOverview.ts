"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { logger } from "../lib/logger";
import { sleeperApi } from "../lib/sleeperApi";
import { CURRENT_YEAR, YEARS, ROUNDS, getDraftRoundSlot } from "../lib/helpers";
import type {
  SleeperLeague,
  AugmentedPick, LeagueOverviewEntry,
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

            // Skip seasons whose rookie draft is complete (those picks are
            // spent); extend the window forward to keep it the same length.
            // A startup-sized draft (>6 rounds) also retires that season if no
            // separate rookie-sized draft exists for it — that pattern means
            // rookies were consumed inside the startup itself.
            const seasonsWithRookieDraft = new Set(
              draftsData
                .filter((d) => {
                  if (!d?.season) return false;
                  const rounds = d.settings?.rounds ?? d.rounds ?? 99;
                  return rounds <= 6;
                })
                .map((d) => String(d.season))
            );
            const completedDraftSeasons = new Set<string>();
            draftsData.forEach((d) => {
              if (d?.status !== "complete" || !d?.season) return;
              const rounds = d.settings?.rounds ?? d.rounds ?? 99;
              const season = String(d.season);
              if (rounds <= 6) completedDraftSeasons.add(season);
              else if (!seasonsWithRookieDraft.has(season)) completedDraftSeasons.add(season);
            });
            const baseYearNum = Number(YEARS[0]);
            const pickYearWindow: string[] = [];
            for (let offset = 0; pickYearWindow.length < YEARS.length; offset++) {
              const y = String(baseYearNum + offset);
              if (!completedDraftSeasons.has(y)) pickYearWindow.push(y);
            }

            const tempPicks: AugmentedPick[] = [];
            const rosterToUser: Record<string, string> = {};
            rostersData.forEach((r) => {
              rosterToUser[String(r.roster_id)] = r.owner_id;
              pickYearWindow.forEach((year) => {
                ROUNDS.forEach((round) => {
                  tempPicks.push({
                    season: year,
                    round,
                    roster_id: r.roster_id,
                    owner_id: r.roster_id,
                    previous_owner_id: r.roster_id,
                  });
                });
              });
            });

            tradedPicksData.forEach((tp) => {
              const match = tempPicks.find(
                (p) => p.season === tp.season && p.round === tp.round && p.roster_id === tp.roster_id
              );
              if (match) match.owner_id = tp.owner_id;
            });

            const currentDraft = draftsData.find((d) => d.season === CURRENT_YEAR);
            const order = currentDraft?.draft_order || {};
            const totalDraftTeams = rostersData.length || Number(currentDraft?.settings?.teams) || 0;
            tempPicks.forEach((pick) => {
              if (pick.season === CURRENT_YEAR) {
                const userId = rosterToUser[String(pick.roster_id)];
                const baseSlot = Number(order[String(userId)] || 0);
                const slot = getDraftRoundSlot(
                  currentDraft ?? {},
                  Number(pick.round),
                  baseSlot,
                  totalDraftTeams
                );
                pick.slot = slot
                  ? `${pick.round}.${String(slot).padStart(2, "0")}`
                  : `${pick.round}`;
              }
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
    loadLeagueOverview,
  };
}
