"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseclient";
import { logger } from "../lib/logger";
import { useDraftBoardClass } from "./useDraftBoardClass";
import {
  DRAFT_BOARD_COLUMNS, DRAFT_BOARD_POSITIONS, sortDraftBoard, type DraftBoardProspect,
} from "../lib/helpers/draftBoard";
import type { SleeperNFLState } from "../lib/types";

const log = logger("hooks/useDraftBoardProspects");

const NO_ROWS: DraftBoardProspect[] = [];

/**
 * The user's draft board for the live draft (draft board sync Stage 4): the
 * class's Scouting prospects in board order, the same rows the Draft Hub's
 * Rookie Big Board lists. Loads once the class settles and again each time
 * `active` turns on (the Draft Hub opening), so OVR moves made in Scouting
 * show up. A failed load keeps the last rows.
 */
export function useDraftBoardProspects(
  userId: string | null,
  nflState: SleeperNFLState | null,
  active: boolean,
): DraftBoardProspect[] {
  const { classYear, ready } = useDraftBoardClass(nflState);
  const [loaded, setLoaded] = useState<{ key: string; rows: DraftBoardProspect[] } | null>(null);
  const key = userId && ready ? `${userId}|${classYear}` : null;

  useEffect(() => {
    if (!key || !userId || !active) return;
    let cancelled = false;
    supabase
      .from("prospects")
      .select(DRAFT_BOARD_COLUMNS)
      .eq("user_id", userId)
      .eq("draft_class_year", classYear)
      .in("position", [...DRAFT_BOARD_POSITIONS])
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { log.warn("draft board load failed", { err: error.message }); return; }
        setLoaded({ key, rows: sortDraftBoard((data ?? []) as DraftBoardProspect[]) });
      }, (e: unknown) => log.warn("draft board load failed", { err: String(e) }));
    return () => { cancelled = true; };
  }, [key, userId, classYear, active]);

  return loaded && loaded.key === key ? loaded.rows : NO_ROWS;
}
