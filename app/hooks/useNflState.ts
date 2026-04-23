"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { logger } from "../../lib/logger";
import type { SleeperNFLState } from "../../lib/types";

const log = logger("app/hooks/useNflState");

export function useNflState() {
  const [nflState, setNflState] = useState<SleeperNFLState | null>(null);
  const nflStateRef = useRef(nflState);
  useEffect(() => { nflStateRef.current = nflState; }, [nflState]);

  const loadNflState = useCallback(async () => {
    if (nflStateRef.current) return;
    try {
      const data = await fetch('/api/nfl-state').then(r => r.json());
      setNflState(data);
    } catch (err) {
      log.error('loadNflState failed', { err: String(err) });
    }
  }, []);

  return { nflState, setNflState, loadNflState };
}
