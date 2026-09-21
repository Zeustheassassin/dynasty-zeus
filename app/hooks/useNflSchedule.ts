"use client";
import { useState, useCallback, useRef } from "react";
import { scheduleApi } from "../../lib/scheduleApi";
import type { TeamGameState } from "../../lib/types";

export interface LoadScheduleOpts {
  /** Skip the browser TTL cache — used by live polling. */
  bypass?: boolean;
}

export function useNflSchedule() {
  const [scheduleByTeam, setScheduleByTeam] = useState<Record<string, TeamGameState>>({});
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [scheduleUpdatedAt, setScheduleUpdatedAt] = useState<number | null>(null);
  const loadedWeekRef = useRef<number>(0);

  const loadSchedule = useCallback(async (week: number, opts?: LoadScheduleOpts) => {
    if (!week) return;
    // A poll shouldn't flash a loading state over data that's already on screen.
    if (!opts?.bypass) setLoadingSchedule(true);
    try {
      const data = await scheduleApi.getNflScoreboard(week, opts?.bypass);
      // getNflScoreboard returns {} on any failure. Keep the last good scoreboard for
      // the same week rather than blanking every live game on one transient error.
      const failed = Object.keys(data).length === 0;
      if (failed && loadedWeekRef.current === week) return;
      loadedWeekRef.current = week;
      setScheduleByTeam(data);
      if (!failed) setScheduleUpdatedAt(Date.now());
    } finally {
      if (!opts?.bypass) setLoadingSchedule(false);
    }
  }, []);

  return {
    scheduleByTeam,
    loadingSchedule,
    scheduleUpdatedAt,
    loadSchedule,
  };
}
