"use client";
import { useEffect, useState } from "react";
import { scheduleApi } from "../lib/scheduleApi";
import { draftBoardClass, type DraftClassNflState, type DraftClassSource } from "../lib/helpers/draftClass";

export interface UseDraftBoardClassReturn {
  /** The rookie class the Draft Hub's board shows (lib/helpers/draftClass.ts). */
  classYear: number;
  /** What decided it: ESPN's Week 1 kickoff, Sleeper's week, or the calendar alone. */
  source: DraftClassSource;
  /** ESPN has answered for this year's season, with a kickoff or without. Until
   *  then the class rests on Sleeper or the calendar and may still change. */
  ready: boolean;
}

// setTimeout's longest delay (~24.8 days). A kickoff further off is picked up
// by a later mount instead.
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * The draft board's class: next year's from the first Week 1 kickoff of the
 * season starting this calendar year, this year's before it. The kickoff is
 * ESPN's (through /api/nfl-scoreboard); `nflState` (Sleeper's /state/nfl) is
 * the fallback while it loads or when ESPN has none.
 */
export function useDraftBoardClass(nflState?: DraftClassNflState | null): UseDraftBoardClassReturn {
  const [now, setNow] = useState(() => Date.now());
  const season = new Date(now).getFullYear();
  const [kickoff, setKickoff] = useState<{ season: number; at: number | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void scheduleApi.getWeek1Kickoff(season).then((at) => {
      if (!cancelled) setKickoff({ season, at });
    });
    return () => { cancelled = true; };
  }, [season]);

  const ready = kickoff?.season === season;
  const at = ready ? kickoff.at : null;

  // A board left open across the kickoff flips then.
  useEffect(() => {
    if (at == null) return;
    const wait = at - Date.now();
    if (wait <= 0 || wait > MAX_TIMER_MS) return;
    const timer = setTimeout(() => setNow(Date.now()), wait + 1000);
    return () => clearTimeout(timer);
  }, [at]);

  const cls = draftBoardClass(new Date(now), at, nflState);
  return { classYear: cls.year, source: cls.source, ready };
}
