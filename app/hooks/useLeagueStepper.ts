"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAttentionLeagues,
  getStepIndex,
  LINEUP_KINDS,
  type ActionAppTab,
  type ActionItem,
  type DoneRecord,
  type LeagueStepSession,
  type LeagueStop,
} from "../../lib/helpers/actionQueue";
import type { SleeperLeague } from "../../lib/types";

// To-Do hub Stage 3: step through the leagues needing attention from the League Hub — its bar,
// the [ / ] keys and the command palette. A run is a snapshot of the To-Do list's By league order
// taken when it starts (To-Do's Open in app, or a step from outside the League Hub), so the order
// and "3 of 9" stay put while the user works: switching to a league with other scoring clears the
// projections and empties the lineup status until they reload, and the roster poll can land
// mid-run. Back to To-Do shows the live list; the next Open in app starts a new run.

export interface LeagueStepTarget {
  stop: LeagueStop;
  /** 0-based position in the run. */
  index: number;
  total: number;
}

export interface UseLeagueStepperArgs {
  /** Sleeper user id — a run belongs to one account. */
  userId: string | null;
  items: ActionItem[];
  done: Record<string, DoneRecord>;
  leagues: SleeperLeague[];
  selectedLeagueId: string | null;
  /** On the League Hub — steps walk the open run instead of starting a new one. */
  inLeagueHub: boolean;
  /** In season with this week's lineup status not computed yet (projections or schedule still
   *  loading) — a run started now keeps the last computed lineup moves rather than leaving them out. */
  lineupPending: boolean;
  /** Open a league on a League Hub tab (To-Do's Open in app navigation). */
  open: (leagueId: string, tab: ActionAppTab) => void;
}

export interface UseLeagueStepperReturn {
  /** The open run, or null (the League Hub bar shows only during one). */
  session: LeagueStepSession | null;
  /** Prev (-1) / Next (+1). On the League Hub with a run open, the stop before / after the selected
   *  league; anywhere else a new run from the live list, starting at its first (Next) or last
   *  (Prev) league. Returns false when there's nowhere to go. */
  step: (dir: 1 | -1) => boolean;
  /** Where step(dir) would go right now, without going — the command palette's labels. */
  peek: (dir: 1 | -1) => LeagueStepTarget | null;
  /** To-Do's Open in app: open the league and start a run from the live list there. */
  openFromTodo: (leagueId: string, tab: ActionAppTab) => void;
  /** Close the bar. */
  end: () => void;
}

export function useLeagueStepper(args: UseLeagueStepperArgs): UseLeagueStepperReturn {
  const [stored, setStored] = useState<LeagueStepSession | null>(null);
  const session = stored && stored.userId === args.userId ? stored : null;

  // The last lineup moves computed while the lineup status was ready, for a run started while it
  // reloads. Written after commit; read only by the event handlers below.
  const lastLineupItemsRef = useRef<ActionItem[]>([]);
  useEffect(() => {
    if (!args.lineupPending) lastLineupItemsRef.current = args.items.filter((i) => LINEUP_KINDS.includes(i.kind));
  }, [args.items, args.lineupPending]);

  // Latest render's values, so step / peek / openFromTodo stay stable (the memoized League Hub
  // and MainLayout's key listener take them) and still read current data.
  const latestRef = useRef({ args, session });
  useEffect(() => { latestRef.current = { args, session }; });

  const snapshot = useCallback((): LeagueStop[] => {
    const { items, done, leagues, lineupPending } = latestRef.current.args;
    const source = lineupPending
      ? [...items.filter((i) => !LINEUP_KINDS.includes(i.kind)), ...lastLineupItemsRef.current]
      : items;
    return getAttentionLeagues(source, done, leagues, Date.now());
  }, []);

  const resolve = useCallback((dir: 1 | -1): { stops: LeagueStop[]; index: number } | null => {
    const { args: { inLeagueHub, selectedLeagueId }, session: open } = latestRef.current;
    if (inLeagueHub && open) {
      const index = getStepIndex(open, selectedLeagueId, dir);
      return index == null ? null : { stops: open.stops, index };
    }
    const stops = snapshot();
    if (stops.length === 0) return null;
    return { stops, index: dir > 0 ? 0 : stops.length - 1 };
  }, [snapshot]);

  const peek = useCallback((dir: 1 | -1): LeagueStepTarget | null => {
    const target = resolve(dir);
    return target ? { stop: target.stops[target.index], index: target.index, total: target.stops.length } : null;
  }, [resolve]);

  const step = useCallback((dir: 1 | -1): boolean => {
    const { userId, open } = latestRef.current.args;
    const target = resolve(dir);
    if (!target || !userId) return false;
    const stop = target.stops[target.index];
    setStored({ userId, stops: target.stops, cursor: target.index });
    open(stop.leagueId, stop.appTab);
    return true;
  }, [resolve]);

  const openFromTodo = useCallback((leagueId: string, tab: ActionAppTab) => {
    const { userId, open } = latestRef.current.args;
    const stops = snapshot();
    // A league with no move left (Waiver Watch's Open in app) opens off the list: Next starts at the top.
    setStored(userId && stops.length > 0
      ? { userId, stops, cursor: stops.findIndex((s) => s.leagueId === leagueId) }
      : null);
    open(leagueId, tab);
  }, [snapshot]);

  const end = useCallback(() => setStored(null), []);

  return { session, step, peek, openFromTodo, end };
}
