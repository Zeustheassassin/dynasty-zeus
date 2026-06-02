"use client";
import { useState, useEffect } from "react";

export interface PlayerUsage {
  avgTargets: number;    // avg targets per game (WR/TE)
  avgCarries: number;    // avg rush attempts per game (RB)
  snapPct: number;       // 0–1 fraction of team offensive snaps
  gamesPlayed: number;   // number of weeks with meaningful snaps
  // Recent 2-week window (for trend detection)
  recentTargets: number;  // avg targets over last 2 games
  recentCarries: number;
  recentSnapPct: number;
  // Trend = recent minus overall avg (positive = usage increasing)
  targetTrend: number;
  carryTrend: number;
  snapTrend: number;
}

// Module-level cache — survives re-renders, cleared on page reload
// Values are Sleeper weekly stat fields (all numeric, some null).
const statsCache: Record<string, Record<string, Record<string, number | null>>> = {};

/**
 * Fetches the last `lookback` completed weeks of Sleeper actuals for the
 * current season and aggregates per-player usage (targets, carries, snap%).
 * Also computes a 2-week recent window so callers can detect trending up/down.
 *
 * Returns null during the off-season or when data isn't ready yet.
 * All fetches are fire-and-forget; the component works fine without them.
 */
export interface UsePlayerStatsReturn {
  playerStats: Record<string, PlayerUsage> | null;
  loadingStats: boolean;
}

export function usePlayerStats(
  season: string | null,
  currentWeek: number | null,   // must be > 0 during regular season
  lookback = 4
): UsePlayerStatsReturn {
  const [playerStats, setPlayerStats] = useState<Record<string, PlayerUsage> | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  useEffect(() => {
    // Off-season or not enough data yet — clear state and bail.
    // Synchronous setState in effect is intentional: clearing derived state
    // when input conditions are not met is the correct React pattern here.
    if (!season || !currentWeek || currentWeek < 2) {
      setPlayerStats(null); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }

    // Build the list of completed weeks to aggregate (exclude current in-progress week)
    // Ordered most-recent first so weeks[0] = last completed week.
    const weeks: number[] = [];
    for (let w = currentWeek - 1; w >= Math.max(1, currentWeek - lookback); w--) {
      weeks.push(w);
    }
    if (weeks.length === 0) {
      setPlayerStats(null);
      return;
    }

    // Recent window: up to last 2 completed weeks
    const recentWeeks = weeks.slice(0, 2);

    const uncached = weeks.filter((w) => !statsCache[`${season}-${w}`]);

    const aggregate = () => {
      // Full lookback accumulator
      const playerMap: Record<string, {
        targets: number; carries: number; snaps: number; teamSnaps: number; weeks: number;
      }> = {};
      // Recent 2-week accumulator
      const recentMap: Record<string, {
        targets: number; carries: number; snaps: number; teamSnaps: number; weeks: number;
      }> = {};

      for (const w of weeks) {
        const isRecent = recentWeeks.includes(w);
        const weekData = statsCache[`${season}-${w}`] ?? {};
        for (const [pid, s] of Object.entries(weekData as Record<string, Record<string, number | null>>)) {
          const snaps: number = s.off_snp ?? 0;
          const teamSnaps: number = s.tm_off_snp ?? 0;
          const targets: number = s.rec_tgt ?? 0;
          const carries: number = s.rush_att ?? 0;

          // Only count weeks where the player actually played
          if (snaps < 5 && targets === 0 && carries === 0) continue;

          if (!playerMap[pid]) {
            playerMap[pid] = { targets: 0, carries: 0, snaps: 0, teamSnaps: 0, weeks: 0 };
          }
          playerMap[pid].targets += targets;
          playerMap[pid].carries += carries;
          playerMap[pid].snaps += snaps;
          playerMap[pid].teamSnaps += teamSnaps;
          playerMap[pid].weeks += 1;

          if (isRecent) {
            if (!recentMap[pid]) {
              recentMap[pid] = { targets: 0, carries: 0, snaps: 0, teamSnaps: 0, weeks: 0 };
            }
            recentMap[pid].targets += targets;
            recentMap[pid].carries += carries;
            recentMap[pid].snaps += snaps;
            recentMap[pid].teamSnaps += teamSnaps;
            recentMap[pid].weeks += 1;
          }
        }
      }

      const result: Record<string, PlayerUsage> = {};
      for (const [pid, d] of Object.entries(playerMap)) {
        if (d.weeks === 0) continue;
        const avgTargets = d.targets / d.weeks;
        const avgCarries = d.carries / d.weeks;
        const snapPct    = d.teamSnaps > 0 ? d.snaps / d.teamSnaps : 0;

        const rd = recentMap[pid];
        const recentTargets  = rd && rd.weeks > 0 ? rd.targets / rd.weeks : avgTargets;
        const recentCarries  = rd && rd.weeks > 0 ? rd.carries / rd.weeks : avgCarries;
        const recentSnapPct  = rd && rd.weeks > 0 && rd.teamSnaps > 0
          ? rd.snaps / rd.teamSnaps : snapPct;

        result[pid] = {
          avgTargets,
          avgCarries,
          snapPct,
          gamesPlayed: d.weeks,
          recentTargets,
          recentCarries,
          recentSnapPct,
          targetTrend: recentTargets - avgTargets,
          carryTrend:  recentCarries - avgCarries,
          snapTrend:   recentSnapPct - snapPct,
        };
      }
      setPlayerStats(result);
    };

    if (uncached.length === 0) {
      aggregate();
      return;
    }

    setLoadingStats(true);
    const controller = new AbortController();
    const { signal } = controller;

    Promise.all(
      uncached.map((w) =>
        fetch(`/api/stats/sleeper-weekly?season=${season}&week=${w}`, { signal })
          .then((r) => {
            if (!r.ok) throw new Error(`sleeper-weekly ${r.status}`);
            return r.json();
          })
          // Only cache a SUCCESSFUL response (a legit empty {} for a week with no
          // data is fine to cache). On failure leave the key unset so the week is
          // retried on a later run instead of being permanently stuck empty.
          .then((data) => { statsCache[`${season}-${w}`] = data ?? {}; })
          .catch(() => { /* transient failure — do not cache, allow retry */ })
      )
    ).then(() => {
      if (signal.aborted) return;
      aggregate();
      setLoadingStats(false);
    });

    return () => { controller.abort(); };
  }, [season, currentWeek, lookback]);

  return { playerStats, loadingStats };
}
