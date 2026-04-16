"use client";
import { useState, type Dispatch, type SetStateAction } from "react";
import { CURRENT_YEAR, getDraftRoundSlot } from "../lib/helpers";
import { logger } from "../lib/logger";
import type { SleeperTransaction, SleeperLeague, SleeperRoster, SleeperDraft, SleeperUser, SleeperTradedPick } from "../lib/types";

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
  loadUserTrades: (targetUserId: string) => Promise<void>;
}

export function useUserTrades(): UseUserTradesReturn {
  const [tradeHubUserId, setTradeHubUserId] = useState<string | null>(null);
  const [tradeHubData, setTradeHubData] = useState<AnnotatedTrade[] | null>(null);
  const [loadingTradeHub, setLoadingTradeHub] = useState(false);

  const loadUserTrades = async (targetUserId: string) => {
    setTradeHubUserId(targetUserId);
    setTradeHubData(null);
    setLoadingTradeHub(true);

    try {
      const leaguesRes = await fetch(
        `https://api.sleeper.app/v1/user/${targetUserId}/leagues/nfl/${CURRENT_YEAR}`
      );
      const allLeagues = (await leaguesRes.json()) as SleeperLeague[];

      const dynastyLeagues = allLeagues.filter((l) =>
        ((l.settings?.taxi_slots ?? 0) > 0 ||
          (l.roster_positions?.length ?? 0) > 20) &&
        (l.settings?.best_ball ?? 0) === 0
      );

      const oneMonthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const allTrades: AnnotatedTrade[] = [];

      await Promise.all(
        dynastyLeagues.map(async (league) => {
          const [rostersData, t1, t2, draftsData, leagueUsersData] = await Promise.all([
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`)
              .then((r) => r.json() as Promise<SleeperRoster[]>).catch(() => [] as SleeperRoster[]),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/transactions/1`)
              .then((r) => r.json() as Promise<SleeperTransaction[]>).catch(() => [] as SleeperTransaction[]),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/transactions/2`)
              .then((r) => r.json() as Promise<SleeperTransaction[]>).catch(() => [] as SleeperTransaction[]),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/drafts`)
              .then((r) => r.json() as Promise<SleeperDraft[]>).catch(() => [] as SleeperDraft[]),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/users`)
              .then((r) => r.json() as Promise<SleeperUser[]>).catch(() => [] as SleeperUser[]),
          ]);

          const myRoster = rostersData.find((r) => r.owner_id === targetUserId);
          if (!myRoster) return;

          const currentDraft = (Array.isArray(draftsData) ? draftsData : [])
            .find((d) => d.season === CURRENT_YEAR);
          const draftOrder = currentDraft?.draft_order || {};
          const numTeams = (Array.isArray(rostersData) ? rostersData : []).length
            || Number(currentDraft?.settings?.teams) || 0;
          const rosterToOwner: Record<number, string> = {};
          (Array.isArray(rostersData) ? rostersData : []).forEach((r) => {
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

          const startupDraft = (Array.isArray(draftsData) ? draftsData : [])
            .filter((d) => (d.settings?.rounds ?? 0) > 6)
            .sort((a, b) => (b.settings?.rounds ?? 0) - (a.settings?.rounds ?? 0))[0];
          const startupStart: number = startupDraft?.start_time ?? 0;
          const startupEnd: number = startupDraft?.last_picked
            ?? (startupStart ? startupStart + 60 * 24 * 60 * 60 * 1000 : 0);

          const trades = [...(Array.isArray(t1) ? t1 : []), ...(Array.isArray(t2) ? t2 : [])]
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
        })
      );

      allTrades.sort((a, b) => b.created - a.created);
      setTradeHubData(allTrades.slice(0, 15));
    } catch (err) {
      log.error("trade hub fetch failed", { err: String(err) });
    } finally {
      setLoadingTradeHub(false);
    }
  };

  return {
    tradeHubUserId,
    setTradeHubUserId,
    tradeHubData,
    setTradeHubData,
    loadingTradeHub,
    loadUserTrades,
  };
}
