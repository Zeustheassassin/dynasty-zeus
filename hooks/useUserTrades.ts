"use client";
import { useState, useRef, type Dispatch, type SetStateAction } from "react";
import { CURRENT_YEAR, getDraftRoundSlot, isDynastyLeague } from "../lib/helpers";
import { logger } from "../lib/logger";
import { sleeperApi } from "../lib/sleeperApi";
import { withConcurrency } from "../lib/concurrency";
import { RECENT_TRADE_WINDOW_DAYS, TARGET_USER_LEAGUE_CONCURRENCY } from "../lib/constants";
import type { SleeperTransaction, SleeperTradedPick } from "../lib/types";

const log = logger("hooks/useUserTrades");

export type AnnotatedTrade = SleeperTransaction & {
  leagueName: string;
  leagueId: string;
  myRosterId: number;
  rosterToOwner: Record<number, string>;
  rosterToName: Record<number, string>;
};

export interface UseUserTradesReturn {
  tradeHubUserId: string | null;
  setTradeHubUserId: Dispatch<SetStateAction<string | null>>;
  tradeHubData: AnnotatedTrade[] | null;
  setTradeHubData: Dispatch<SetStateAction<AnnotatedTrade[] | null>>;
  loadingTradeHub: boolean;
  /** Non-null when the last load failed outright, or when some leagues failed (tradeHubData then
   *  holds the leagues that did load) — lets the UI distinguish an outage from "no trades". */
  tradeHubError: string | null;
  loadUserTrades: (targetUserId: string, bypass?: boolean) => Promise<void>;
}

export function useUserTrades(): UseUserTradesReturn {
  const [tradeHubUserId, setTradeHubUserId] = useState<string | null>(null);
  const [tradeHubData, setTradeHubData] = useState<AnnotatedTrade[] | null>(null);
  const [loadingTradeHub, setLoadingTradeHub] = useState(false);
  const [tradeHubError, setTradeHubError] = useState<string | null>(null);
  // Monotonic guard so a slow load for an earlier user can't overwrite a newer one.
  const requestSeq = useRef(0);

  const loadUserTrades = async (targetUserId: string, bypass?: boolean) => {
    setTradeHubUserId(targetUserId);
    // Keep prior data visible on a same-user refresh; only clear when switching users.
    if (!bypass) setTradeHubData(null);
    setLoadingTradeHub(true);
    setTradeHubError(null);
    const seq = ++requestSeq.current;

    try {
      const allLeagues = await sleeperApi.getUserLeagues(targetUserId, CURRENT_YEAR);

      const dynastyLeagues = allLeagues.filter(isDynastyLeague);

      const oneMonthAgo = Date.now() - RECENT_TRADE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      const allTrades: AnnotatedTrade[] = [];
      let failedLeagues = 0;

      // Capped at TARGET_USER_LEAGUE_CONCURRENCY leagues at once rather than firing every one
      // of the target user's leagues' 4 Sleeper calls simultaneously — this scales with the
      // LOOKED-UP user's league count, not the viewer's own, so even a small-league viewer can
      // trip an uncapped burst by looking up a whale (Sept 22 code-review 50-league-
      // scalability finding, Tier 1 #4).
      await withConcurrency(dynastyLeagues, async (league) => {
        // Per-league fault isolation: a league whose rosters or trades fail is counted and
        // reported rather than dropped silently, which reads as "no trades in that league".
        const fetched = await Promise.all([
          sleeperApi.getLeagueRosters(league.league_id),
          sleeperApi.getLeagueRecentTrades(league.league_id, bypass),
          sleeperApi.getLeagueDrafts(league.league_id),
          sleeperApi.getLeagueUsers(league.league_id),
        ]).catch((err) => {
          failedLeagues += 1;
          log.warn("league trades fetch failed", { leagueId: league.league_id, err: String(err) });
          return null;
        });
        if (!fetched) return;
        const [rostersData, recentTrades, draftsData, leagueUsersData] = fetched;

        const myRoster = rostersData.find((r) => r.owner_id === targetUserId);
        if (!myRoster) return;

        const currentDraft = draftsData.find((d) => d.season === CURRENT_YEAR);
        const draftOrder = currentDraft?.draft_order || {};
        const numTeams = rostersData.length
          || Number(currentDraft?.settings?.teams) || 0;
        const rosterToOwner: Record<number, string> = {};
        rostersData.forEach((r) => {
          rosterToOwner[r.roster_id] = r.owner_id;
        });

        const ownerIdToName: Record<string, string> = {};
        (Array.isArray(leagueUsersData) ? leagueUsersData : []).forEach((u) => {
          ownerIdToName[u.user_id] = u.display_name || u.metadata?.team_name || u.user_id;
        });
        const rosterToName: Record<number, string> = {};
        Object.entries(rosterToOwner).forEach(([rosterId, ownerId]) => {
          const name = ownerIdToName[ownerId];
          if (name) rosterToName[Number(rosterId)] = name;
        });

        const slotLabel = (season: string, round: number, rosterId: number): string => {
          if (String(season) === CURRENT_YEAR && currentDraft) {
            const userId = rosterToOwner[rosterId];
            const baseSlot = Number(draftOrder[String(userId)] || 0);
            const s = getDraftRoundSlot(currentDraft, round, baseSlot, numTeams);
            if (s) return `${season} ${round}.${String(s).padStart(2, "0")}`;
          }
          return `${season} Rd ${round}`;
        };

        const startupDraft = draftsData
          .filter((d) => (d.settings?.rounds ?? 0) > 6)
          .sort((a, b) => (b.settings?.rounds ?? 0) - (a.settings?.rounds ?? 0))[0];
        const startupStart: number = startupDraft?.start_time ?? 0;
        const startupEnd: number = startupDraft?.last_picked
          ?? (startupStart ? startupStart + 60 * 24 * 60 * 60 * 1000 : 0);

        const trades = recentTrades
          .filter((t) =>
            t.type === "trade" &&
            t.status === "complete" &&
            t.created > oneMonthAgo &&
            (t.roster_ids || []).includes(myRoster.roster_id) &&
            !(startupStart > 0 && t.created >= startupStart && t.created <= startupEnd)
          );

        trades.forEach((trade) => {
          const resolvedDraftPicks = (trade.draft_picks || []).map((p: SleeperTradedPick) => ({
            ...p,
            resolvedSlot: slotLabel(String(p.season), Number(p.round), Number(p.roster_id)),
          }));
          allTrades.push({
            ...trade,
            draft_picks: resolvedDraftPicks,
            leagueName: league.name,
            leagueId: league.league_id,
            myRosterId: myRoster.roster_id,
            rosterToOwner,
            rosterToName,
          });
        });
      }, TARGET_USER_LEAGUE_CONCURRENCY);

      if (seq !== requestSeq.current) return; // a newer load started — discard stale result
      allTrades.sort((a, b) => b.created - a.created);
      setTradeHubData(allTrades.slice(0, 15));
      if (failedLeagues > 0) {
        setTradeHubError(
          `Couldn't load trades from ${failedLeagues} of ${dynastyLeagues.length} leagues — Sleeper may be busy, try again in a minute.`
        );
      }
    } catch (err) {
      log.error("trade hub fetch failed", { err: String(err) });
      if (seq === requestSeq.current) {
        setTradeHubError("Couldn't load trades. Sleeper may be unavailable — try again.");
      }
    } finally {
      if (seq === requestSeq.current) setLoadingTradeHub(false);
    }
  };

  return {
    tradeHubUserId,
    setTradeHubUserId,
    tradeHubData,
    setTradeHubData,
    loadingTradeHub,
    tradeHubError,
    loadUserTrades,
  };
}
