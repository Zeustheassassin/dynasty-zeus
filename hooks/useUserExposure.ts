"use client";
import { useState, useRef, type Dispatch, type SetStateAction } from "react";
import { CURRENT_YEAR } from "../lib/helpers";
import { logger } from "../lib/logger";
import { sleeperApi } from "../lib/sleeperApi";
import type { SleeperRoster } from "../lib/types";

const log = logger("hooks/useUserExposure");

interface ExposureEntry { playerId: string; count: number; percent: number; }
export interface ExposureData { players: ExposureEntry[]; leagueCount: number; }

export interface UseUserExposureReturn {
  userCache: Record<string, ExposureData>;
  selectedUserId: string | null;
  setSelectedUserId: Dispatch<SetStateAction<string | null>>;
  externalShares: ExposureData | null;
  loadingShares: boolean;
  /** Non-null when the last load failed — lets the UI show an error+retry instead of a blank "no data" panel. */
  exposureError: string | null;
  loadUserExposure: (userId: string) => Promise<void>;
}

export function useUserExposure(): UseUserExposureReturn {
  const [userCache, setUserCache] = useState<Record<string, ExposureData>>({});
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [externalShares, setExternalShares] = useState<ExposureData | null>(null);
  const [loadingShares, setLoadingShares] = useState(false);
  const [exposureError, setExposureError] = useState<string | null>(null);
  // Monotonic guard: only the most recent load is allowed to commit, so a slow
  // load('A') resolving after a later load('B') can't overwrite B's result.
  const requestSeq = useRef(0);

  const loadUserExposure = async (userId: string) => {
    if (userCache[userId]) {
      setExternalShares(userCache[userId]);
      setSelectedUserId(userId);
      setExposureError(null);
      return;
    }
    const seq = ++requestSeq.current;
    try {
      setLoadingShares(true);
      setExposureError(null);
      setSelectedUserId(userId);

      const leagues = await sleeperApi.getUserLeagues(userId, CURRENT_YEAR);

      const rosterResults = await Promise.all(
        leagues.map(async (league) => {
          const rosters = await sleeperApi.getLeagueRosters(league.league_id);
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
      if (seq !== requestSeq.current) return; // a newer load started — discard stale result
      setExternalShares(result);
      setUserCache((prev) => ({ ...prev, [userId]: result }));
    } catch (err) {
      log.error("error loading user exposure", { err: String(err) });
      if (seq === requestSeq.current) {
        setExposureError("Couldn't load this user's shares. Sleeper may be unavailable — try again.");
      }
    } finally {
      if (seq === requestSeq.current) setLoadingShares(false);
    }
  };

  return {
    userCache,
    selectedUserId,
    setSelectedUserId,
    externalShares,
    loadingShares,
    exposureError,
    loadUserExposure,
  };
}
