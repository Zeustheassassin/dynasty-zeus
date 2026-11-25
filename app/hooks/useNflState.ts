"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { logger } from "../../lib/logger";
import { newerNflState } from "../../lib/helpers/season";
import type { SleeperNFLState } from "../../lib/types";

const log = logger("app/hooks/useNflState");

export function useNflState() {
  const [nflState, setNflStateRaw] = useState<SleeperNFLState | null>(null);
  const nflStateRef = useRef(nflState);
  useEffect(() => { nflStateRef.current = nflState; }, [nflState]);

  // Every source of Sleeper's state goes through here, and only a newer one replaces what's held:
  // a stale cached copy or a failed fetch (null / error body) never moves the app back a week or
  // blanks it (newerNflState).
  const setNflState = useCallback((incoming: unknown) => {
    setNflStateRaw((current) => newerNflState(current, incoming));
  }, []);

  const loadNflState = useCallback(async () => {
    if (nflStateRef.current) return;
    try {
      const data = await fetch('/api/nfl-state').then(r => r.json());
      setNflState(data);
    } catch (err) {
      log.error('loadNflState failed', { err: String(err) });
    }
  }, [setNflState]);

  /** Sleeper's state straight from Sleeper, past the route's 1-hour cache (the To-Do hub's Refresh).
   *  Resolves to the state the app holds afterwards — the fresh one unless it was older or failed. */
  const refreshNflState = useCallback(async (): Promise<SleeperNFLState | null> => {
    try {
      const res = await fetch('/api/nfl-state?bypass=1');
      if (!res.ok) return nflStateRef.current;
      const kept = newerNflState(nflStateRef.current, await res.json());
      setNflState(kept);
      return kept;
    } catch (err) {
      log.error('refreshNflState failed', { err: String(err) });
      return nflStateRef.current;
    }
  }, [setNflState]);

  return { nflState, setNflState, loadNflState, refreshNflState };
}
