"use client";
// One prospect's game context for his charting board's Games tab (migration
// 065): each charted game's opponent defense, weather and supporting cast,
// the left-early suggestions, and the user's own per-game calls (left early,
// played hurt, trait grades), saved to scouting_games.

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { logger } from "../../../lib/logger";
import { leftEarlySuggestions } from "../../../lib/scouting/gameFlags";
import { EMPTY_CONTEXT_DATA, resolveGameContexts, type GameContextData } from "../../../lib/scouting/gameContext";
import { withTrait } from "../../../lib/scouting/traits";
import { supabase } from "../../../lib/supabaseclient";
import type { ScoutingGame } from "../../../lib/types";
import {
  CONTEXT_MIGRATION_HINT, fetchGameContextData, isMissingContextTables, runContextFill, type ContextFillProgress,
} from "./contextClient";

const log = logger("scouting/context/useGameContextLog");

type GamePatch = Partial<Pick<ScoutingGame, "played_hurt" | "left_early" | "trait_grades">>;

export function useGameContextLog(
  prospectId: string,
  games: readonly ScoutingGame[],
  /** The board's games setter: a saved call updates its game in place. */
  setGames: Dispatch<SetStateAction<ScoutingGame[]>>,
  onDirty?: () => void,
) {
  const [data, setData] = useState<GameContextData>(EMPTY_CONTEXT_DATA);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ContextFillProgress | null>(null);
  const [unmatched, setUnmatched] = useState<Map<string, string>>(new Map());
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const d = await fetchGameContextData(prospectId);
      if (seq !== loadSeq.current) return;
      setData(d);
      setError(null);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      if (isMissingContextTables(err)) setError(CONTEXT_MIGRATION_HINT);
      else { log.error("game context load failed", { err: String(err) }); setError(`Couldn't load the game context: ${String(err)}`); }
    }
  }, [prospectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const contexts = useMemo(() => resolveGameContexts(games, data), [games, data]);
  const suggestions = useMemo(() => leftEarlySuggestions(games, contexts), [games, contexts]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const out = await runContextFill([prospectId], { onProgress: setProgress });
      setUnmatched(out.unmatched);
      await load();
      const failed = out.errors.get(prospectId);
      if (failed) setError(`Refresh failed: ${failed}`);
      onDirty?.();
    } catch (err) {
      log.error("game context refresh failed", { err: String(err) });
      setError(`Refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setProgress(null);
    }
  }, [prospectId, load, onDirty]);

  /** Saves one of the user's per-game calls. */
  const patchGame = useCallback(async (gameId: string, patch: GamePatch) => {
    const { error: err } = await supabase.from("scouting_games").update(patch).eq("id", gameId);
    if (err) {
      log.error("scouting_games context flag update failed", { err: err.message });
      setError(isMissingContextTables(err.message) ? CONTEXT_MIGRATION_HINT : `Couldn't save: ${err.message}`);
      return;
    }
    setGames((prev) => prev.map((g) => (g.id === gameId ? { ...g, ...patch } : g)));
    onDirty?.();
  }, [setGames, onDirty]);

  const setTrait = useCallback((g: ScoutingGame, key: string, value: number | null) =>
    patchGame(g.id, { trait_grades: withTrait(g.trait_grades, key, value) }), [patchGame]);

  return {
    contexts, suggestions, unmatched, error, refresh, patchGame, setTrait,
    refreshing: progress != null,
    progressNote: progress?.note ?? null,
    filled: games.filter((g) => contexts.has(g.id)).length,
  };
}

export type GameContextLog = ReturnType<typeof useGameContextLog>;
