"use client";
import { useState } from "react";
import { CURRENT_YEAR } from "../lib/helpers";
import type { SleeperLeague, SleeperRoster } from "../lib/types";

interface ExposureEntry { playerId: string; count: number; percent: number; }
export interface ExposureData { players: ExposureEntry[]; leagueCount: number; }

export function useUserExposure() {
  const [userCache, setUserCache] = useState<Record<string, ExposureData>>({});
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [externalShares, setExternalShares] = useState<ExposureData | null>(null);
  const [loadingShares, setLoadingShares] = useState(false);

  const loadUserExposure = async (userId: string) => {
    if (userCache[userId]) {
      setExternalShares(userCache[userId]);
      setSelectedUserId(userId);
      return;
    }
    try {
      setLoadingShares(true);
      setSelectedUserId(userId);

      const leaguesRes = await fetch(
        `https://api.sleeper.app/v1/user/${userId}/leagues/nfl/${CURRENT_YEAR}`
      );
      const leagues = (await leaguesRes.json()) as SleeperLeague[];

      const rosterResults = await Promise.all(
        leagues.map(async (league) => {
          const res = await fetch(
            `https://api.sleeper.app/v1/league/${league.league_id}/rosters`
          );
          const rosters = (await res.json()) as SleeperRoster[];
          return rosters.find((r) => r.owner_id === userId);
        })
      );

      const validRosters = rosterResults.filter((r): r is SleeperRoster => r !== undefined);
      const leagueCount = validRosters.length;

      const map: Record<string, number> = {};
      validRosters.forEach((r) => {
        r.players?.forEach((id: string) => {
          if (!map[id]) map[id] = 0;
          map[id]++;
        });
      });

      const topPlayers = Object.entries(map)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([playerId, count]) => ({
          playerId,
          count,
          percent: leagueCount ? Math.round((count / leagueCount) * 100) : 0,
        }));

      const result: ExposureData = { players: topPlayers, leagueCount };
      setExternalShares(result);
      setUserCache((prev) => ({ ...prev, [userId]: result }));
    } catch (err) {
      console.error("Error loading user exposure:", err);
    } finally {
      setLoadingShares(false);
    }
  };

  return {
    userCache,
    selectedUserId,
    setSelectedUserId,
    externalShares,
    loadingShares,
    loadUserExposure,
  };
}
