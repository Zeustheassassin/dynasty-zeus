"use client";
import { useEffect, useState } from "react";
import { getWeeklyProjectionsRange } from "../lib/weeklyProjectionsStore";
import { SLEEPER_WEEKLY_PROJECTIONS_TTL_MS } from "../lib/constants";
import type { WeeklyProjectionWeek } from "../lib/helpers/weeklyProjections";
import { logger } from "../lib/logger";

const log = logger("useWeeklyProjections");

export interface WeeklyProjectionsState {
  /** Week → trimmed Sleeper projections, for the weeks that loaded. */
  weeklyProjections: Record<number, WeeklyProjectionWeek>;
  /** `season:weeks` of the last load to settle (success or failure) — Run All Sims waits for it
   *  to match the weeks it needs. Null until the first load settles. */
  settledKey: string | null;
}

/** The key a load of `weeks` in `season` settles under. */
export function weeklyProjectionsKey(season: string, weeks: readonly number[]): string {
  return `${season}:${weeks.join(",")}`;
}

/**
 * Sleeper's projections for each week in `weeks` (the season simulator's remaining regular-season
 * weeks), reloaded hourly so injury news reaches the sim the same day. Nothing loads while `weeks`
 * is empty (offseason, or the regular season is over).
 */
export function useWeeklyProjections(season: string | null, weeks: readonly number[]): WeeklyProjectionsState {
  const [state, setState] = useState<WeeklyProjectionsState>({ weeklyProjections: {}, settledKey: null });
  const key = season && weeks.length > 0 ? weeklyProjectionsKey(season, weeks) : null;

  useEffect(() => {
    if (!key || !season) return;
    let cancelled = false;
    const weekList = key.slice(season.length + 1).split(",").map(Number);
    // getWeeklyProjectionsRange never rejects — a failed week is just missing from the result.
    const load = () => {
      getWeeklyProjectionsRange(season, weekList).then((loaded) => {
        if (cancelled) return;
        const missing = weekList.filter((week) => !loaded[week]);
        if (missing.length > 0) log.warn("weekly projections missing", { season, missing });
        setState({ weeklyProjections: loaded, settledKey: key });
      });
    };
    load();
    const timer = setInterval(load, SLEEPER_WEEKLY_PROJECTIONS_TTL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key, season]);

  return state;
}
