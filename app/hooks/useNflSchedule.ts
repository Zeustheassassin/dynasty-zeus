"use client";
import { useState, useCallback } from "react";
import { scheduleApi } from "../../lib/scheduleApi";
import type { TeamGameState } from "../../lib/types";

export function useNflSchedule() {
  const [scheduleByTeam, setScheduleByTeam] = useState<Record<string, TeamGameState>>({});
  const [loadingSchedule, setLoadingSchedule] = useState(false);

  const loadSchedule = useCallback(async (week: number) => {
    if (!week) return;
    setLoadingSchedule(true);
    try {
      const data = await scheduleApi.getNflScoreboard(week);
      setScheduleByTeam(data);
    } finally {
      setLoadingSchedule(false);
    }
  }, []);

  return {
    scheduleByTeam,
    loadingSchedule,
    loadSchedule,
  };
}
