"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cachedFetch } from "../lib/clientFetch";
import { logger } from "../lib/logger";
import { finishedSeasons, fromPayload, type SeasonLine, type SeasonLinesPayload } from "../lib/helpers/nflSeasonLines";

const log = logger("hooks/useNflSeasonLines");

/** A week in the browser; the key carries the seasons, so the February 1 roll reads the new set. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface NflSeasonLinesState {
  lines: SeasonLine[] | null;
  seasons: number[];
  error: string | null;
  retry: () => void;
}

/**
 * The last three finished NFL seasons as QB / RB / WR / TE season lines
 * (/api/nfl-season-lines), for positional value per league. Loads once per
 * mount, from when `enabled` is first true (the Rookie Big Board waits for a
 * league to be picked); a failure says so and can be retried.
 */
export function useNflSeasonLines(enabled = true): NflSeasonLinesState {
  const expected = useMemo(() => finishedSeasons(new Date()), []);
  const [state, setState] = useState<{ payload: SeasonLinesPayload | null; error: string | null }>({ payload: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const loaded = state.payload != null;

  useEffect(() => {
    if (!enabled || loaded) return;
    let cancelled = false;
    cachedFetch<SeasonLinesPayload>("/api/nfl-season-lines", {
      ttlMs: TTL_MS,
      cacheKey: `nflSeasonLines_v1_${expected.join("-")}`,
      bypass: attempt > 0,
    }).then(
      (payload) => { if (!cancelled) setState({ payload, error: null }); },
      (e: unknown) => {
        log.warn("season lines failed", { err: String(e) });
        if (!cancelled) setState({ payload: null, error: "The NFL season stats couldn't be loaded." });
      },
    );
    return () => { cancelled = true; };
  }, [expected, attempt, enabled, loaded]);

  const lines = useMemo(() => (state.payload ? fromPayload(state.payload) : null), [state.payload]);
  const retry = useCallback(() => {
    setState({ payload: null, error: null });
    setAttempt((a) => a + 1);
  }, []);
  return { lines, seasons: state.payload?.seasons ?? expected, error: state.error, retry };
}
