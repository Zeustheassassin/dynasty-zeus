"use client";
// Keeps every charted game's context filled in (Scouting → PFF Links,
// tape-grading expansion Stage 5): works out which prospects need a fill (a
// game with no context row, a game whose weather the archive can read now, a
// game linked to PFF since its cast was looked up) and runs
// /api/scouting/context for them: once when the tab opens, after every PFF
// import, and on the button. It waits while matching or importing runs, so
// the two never share PFF's read budget at once.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logger } from "../../../lib/logger";
import { EMPTY_CONTEXT_DATA, type GameContextData } from "../../../lib/scouting/gameContext";
import { archiveReady, kickoffMs } from "../../../lib/weather/openMeteo";
import {
  CONTEXT_MIGRATION_HINT, fetchGameContextData, isMissingContextTables, runContextFill, type ContextFillProgress,
} from "./contextClient";

const log = logger("scouting/context/useContextFill");
const LINKED = new Set(["auto", "confirmed"]);

interface FillGame { id: string; prospect_id: string; pff_game_id: number | null; pff_match_status: string | null }

export interface ContextCoverage {
  games: number;
  filled: number;
  matched: number;
  weather: number;
  pending: number;
  cast: number;
}

/** Prospects with a game the fill would add something to. */
export function prospectsToFill(games: readonly FillGame[], data: GameContextData, now = Date.now()): string[] {
  const rows = new Map(data.rows.map((r) => [r.game_id, r]));
  const cfd = new Map(data.cfdGames.map((g) => [g.id, g]));
  const out = new Set<string>();
  for (const g of games) {
    const r = rows.get(g.id);
    if (!r) { out.add(g.prospect_id); continue; }
    const linked = g.pff_game_id != null && LINKED.has(g.pff_match_status ?? "");
    if (linked && r.cast_status !== "ok") { out.add(g.prospect_id); continue; }
    const cg = r.cfd_game_id != null ? cfd.get(r.cfd_game_id) : undefined;
    const k = cg?.start_date ? kickoffMs(cg.start_date, cg.start_time_tbd) : null;
    if (cg && (cg.weather_status == null || (cg.weather_status === "pending" && k != null && archiveReady(k, now)))) out.add(g.prospect_id);
  }
  return [...out];
}

export function coverage(games: readonly FillGame[], data: GameContextData): ContextCoverage {
  const rows = new Map(data.rows.map((r) => [r.game_id, r]));
  const cfd = new Map(data.cfdGames.map((g) => [g.id, g]));
  const c: ContextCoverage = { games: games.length, filled: 0, matched: 0, weather: 0, pending: 0, cast: 0 };
  for (const g of games) {
    const r = rows.get(g.id);
    if (!r) continue;
    c.filled++;
    if (r.cfd_match_status === "auto") c.matched++;
    if (r.cast_status === "ok") c.cast++;
    const ws = r.cfd_game_id != null ? cfd.get(r.cfd_game_id)?.weather_status : null;
    if (ws === "ok" || ws === "dome") c.weather++;
    if (ws === "pending") c.pending++;
  }
  return c;
}

export function useContextFill(games: readonly FillGame[], busy: boolean, onFilled?: () => void) {
  const [data, setData] = useState<GameContextData>(EMPTY_CONTEXT_DATA);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ContextFillProgress | null>(null);
  const [cfdRemaining, setCfdRemaining] = useState<number | null>(null);
  const pendingRef = useRef(new Set<string>());
  const runningRef = useRef(false);
  const busyRef = useRef(busy);
  const autoRan = useRef(false);
  const cancelRef = useRef(false);
  /** The latest kick, for a finished run to start what was queued meanwhile. */
  const kickRef = useRef<() => void>(() => {});

  const load = useCallback(async () => {
    try {
      setData(await fetchGameContextData());
      setError(null);
    } catch (err) {
      if (isMissingContextTables(err)) setError(CONTEXT_MIGRATION_HINT);
      else { log.error("game context load failed", { err: String(err) }); setError(`Couldn't load the game context: ${String(err)}`); }
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toFill = useMemo(() => prospectsToFill(games, data), [games, data]);
  const cov = useMemo(() => coverage(games, data), [games, data]);

  const run = useCallback(async (ids: readonly string[]) => {
    if (ids.length === 0) return;
    runningRef.current = true;
    cancelRef.current = false;
    // Off the caller's stack: the first progress update is state.
    await Promise.resolve();
    try {
      const out = await runContextFill(ids, { onProgress: setProgress, isCancelled: () => cancelRef.current });
      if (out.cfdRemaining != null) setCfdRemaining(out.cfdRemaining);
      await load();
      const errors = [...out.errors.values()];
      if (errors.length) setError(`Game context: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}`);
      onFilled?.();
    } catch (err) {
      log.error("game context fill failed", { err: String(err) });
      setError(`Game context stopped: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setProgress(null);
      runningRef.current = false;
    }
    kickRef.current(); // anything queued meanwhile
  }, [load, onFilled]);

  /** Runs whatever is queued, unless a fill, a match or an import is running. */
  const kick = useCallback(async () => {
    if (runningRef.current || busyRef.current || pendingRef.current.size === 0) return;
    const ids = [...pendingRef.current];
    pendingRef.current.clear();
    await run(ids);
  }, [run]);

  useEffect(() => { kickRef.current = () => void kick(); }, [kick]);

  /** Fill these prospects once nothing else is running. */
  const queue = useCallback((ids: readonly string[]) => {
    for (const id of ids) pendingRef.current.add(id);
    void kick();
  }, [kick]);

  // Once on open: everything that needs it (only after the tables loaded fine).
  useEffect(() => {
    if (!loaded || error || autoRan.current || games.length === 0) return;
    autoRan.current = true;
    if (toFill.length) queue(toFill);
  }, [loaded, error, games.length, toFill, queue]);

  // Matching / importing finished: run what waited for it.
  useEffect(() => {
    busyRef.current = busy;
    if (!busy) void kick();
  }, [busy, kick]);

  return {
    data, error, toFill, coverage: cov, cfdRemaining, queue,
    progress, running: progress != null,
    cancel: () => { cancelRef.current = true; pendingRef.current.clear(); },
  };
}
