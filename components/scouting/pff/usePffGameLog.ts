"use client";
// One prospect's PFF stats for his charting board's Games tab: his stored rows
// (migration 063), each charted game's current row, his totals over the
// charted games, and a Refresh that re-imports him from PFF.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logger } from "../../../lib/logger";
import { buildPffTotals, currentGameRow, isLinkedGame } from "../../../lib/pff/totals";
import type { ScoutingGame } from "../../../lib/types";
import {
  fetchPffRows, isMissingPffTables, PFF_STATS_MIGRATION_HINT, runPffImport, type PffImportProgress, type PffRows,
} from "./pffClient";

const log = logger("scouting/pff/usePffGameLog");

export function usePffGameLog(prospectId: string, games: readonly ScoutingGame[], onImported?: () => void) {
  const [rows, setRows] = useState<PffRows>({ games: [], seasons: [] });
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<PffImportProgress | null>(null);
  /** Why PFF had nothing for a game, from the last refresh. */
  const [missing, setMissing] = useState<Map<string, string>>(new Map());
  const [note, setNote] = useState<string | null>(null);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const r = await fetchPffRows(prospectId);
      if (seq !== loadSeq.current) return;
      setRows(r);
      setError(null);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      if (isMissingPffTables(err)) setError(PFF_STATS_MIGRATION_HINT);
      else { log.error("PFF rows load failed", { err: String(err) }); setError(`Couldn't load PFF stats: ${String(err)}`); }
    }
  }, [prospectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rowByGame = useMemo(() => new Map(rows.games.map((r) => [r.game_id, r])), [rows.games]);
  const rowFor = useCallback((g: ScoutingGame) => currentGameRow(g, rowByGame.get(g.id)), [rowByGame]);
  const totals = useMemo(
    () => buildPffTotals(games, rows.games, rows.seasons).get(prospectId) ?? null,
    [games, rows, prospectId],
  );

  /** Why a game shows no PFF stats. */
  const whyEmpty = useCallback((g: ScoutingGame) => {
    if (!isLinkedGame(g)) return "Not linked to a PFF game (Scouting → PFF Links)";
    return missing.get(g.id) ?? "Not imported yet: Refresh PFF";
  }, [missing]);

  const refresh = useCallback(async () => {
    setNote(null);
    setError(null);
    try {
      const out = await runPffImport([prospectId], { onProgress: setProgress });
      setMissing(out.missing);
      setNote(out.notes.get(prospectId) ?? null);
      await load();
      // After the reload, which clears the error on success.
      const failed = out.errors.get(prospectId);
      if (failed) setError(`Refresh failed: ${failed}`);
      onImported?.();
    } catch (err) {
      log.error("PFF refresh failed", { err: String(err) });
      setError(`Refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setProgress(null);
    }
  }, [prospectId, load, onImported]);

  return {
    rowFor, totals, whyEmpty, refresh, error, note,
    refreshing: progress != null,
    progressNote: progress?.note ?? null,
    linked: games.filter(isLinkedGame).length,
  };
}

export type PffGameLog = ReturnType<typeof usePffGameLog>;
