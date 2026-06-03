"use client";
import { useState, useCallback } from "react";
import { logger } from "../../lib/logger";
import { sleeperApi } from "../../lib/sleeperApi";
import type {
  SleeperMatchup,
  AnnotatedTransaction,
} from "../../lib/types";

const log = logger("app/hooks/useActivityState");

export function useActivityState() {
  const [activityTransactions, setActivityTransactions] = useState<AnnotatedTransaction[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [leagueWeeklyMatchups, setLeagueWeeklyMatchups] = useState<Record<string, { week: number; matchups: SleeperMatchup[] }[]>>({});
  const [loadingLeagueWeeklyMatchups, setLoadingLeagueWeeklyMatchups] = useState(false);
  // Owner draft tendencies are no longer compiled client-side (the loader was
  // dead code, removed in audit batch B10); kept as a stable empty map for any
  // consumer that still reads it.
  const [ownerDraftTendencies] = useState<Record<string, Record<string, number>>>({});

  const loadActivity = useCallback(async (leagueId: string) => {
    if (!leagueId) return;
    setLoadingActivity(true);
    try {
      const weeks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
      const all = (await sleeperApi.getLeagueTransactionsMultiWeek(leagueId, weeks))
        .filter((t) => t && t.status === "complete");
      all.sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0));
      setActivityTransactions(all.slice(0, 150) as AnnotatedTransaction[]);
    } catch (err) {
      log.error('loadActivity failed', { err: String(err) });
    } finally { setLoadingActivity(false); }
  }, []);

  return {
    activityTransactions,
    setActivityTransactions,
    loadingActivity,
    leagueWeeklyMatchups,
    setLeagueWeeklyMatchups,
    loadingLeagueWeeklyMatchups,
    setLoadingLeagueWeeklyMatchups,
    ownerDraftTendencies,
    loadActivity,
  };
}
