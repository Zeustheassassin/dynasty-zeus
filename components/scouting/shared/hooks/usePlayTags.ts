"use client";
import { useMemo, useState } from "react";
import { isTaggedPlay, type PlayTagSpec, type TagPosition } from "../../../../lib/scouting/playEra";
import {
  carriedStickyValues, defaultTagValues, missingTags, tagPayload, tagSpecs, tagValuesFromPlay,
  type PlayFacts, type TagValue, type TagValues,
} from "../../../../lib/scouting/playTags";

export interface PlayTags {
  position: TagPosition;
  /** The values on screen: the play being edited, or the next play to log. */
  values: TagValues;
  /** Editing a play charted before the tags: nothing is shown or written. */
  editingUntagged: boolean;
  set: (column: string, value: TagValue) => void;
  /** After a log, or to leave an edit: back to a fresh play (sticky tags keep their value). */
  reset: () => void;
  startEdit: (play: object) => void;
  /** Tag columns to spread into the insert / update. Empty while editing an untagged play. */
  payload: (facts: PlayFacts) => Record<string, TagValue>;
  /** Required tags still to pick (blocks Log Play / Save Edit). */
  missing: (facts: PlayFacts) => readonly PlayTagSpec[];
}

const NONE: readonly PlayTagSpec[] = [];

/**
 * Tag state for one charting board. A sticky tag (red zone, garbage time)
 * starts each game at the value of the game's last charted play and then
 * keeps whatever the charter last set while they stay on that game; every
 * other tag goes back to its default after each logged play.
 * `gamePlays` = the selected game's plays in charting order.
 */
export function usePlayTags(
  position: TagPosition,
  gameId: string | null,
  gamePlays: readonly object[],
): PlayTags {
  const [draft, setDraft] = useState<Record<string, TagValue>>(() => defaultTagValues(position));
  // The charter's own sticky picks, for the game they were made in.
  const [stickyPicks, setStickyPicks] = useState<{ gameId: string | null; values: Record<string, TagValue> }>(
    { gameId: null, values: {} },
  );
  const [edit, setEdit] = useState<{ untagged: boolean; values: Record<string, TagValue> } | null>(null);

  const stickyColumns = useMemo(
    () => new Set(tagSpecs(position).filter((s) => s.entry === "sticky").map((s) => s.column)),
    [position],
  );
  const carried = useMemo(() => carriedStickyValues(position, gamePlays), [position, gamePlays]);

  const values = useMemo<TagValues>(() => {
    if (edit) return edit.values;
    const picks = stickyPicks.gameId === gameId ? stickyPicks.values : {};
    return { ...draft, ...carried, ...picks };
  }, [edit, draft, carried, stickyPicks, gameId]);

  const editingUntagged = edit?.untagged === true;

  return {
    position,
    values,
    editingUntagged,
    set(column, value) {
      if (edit) {
        if (!edit.untagged) setEdit({ ...edit, values: { ...edit.values, [column]: value } });
        return;
      }
      if (stickyColumns.has(column)) {
        setStickyPicks((p) => ({ gameId, values: { ...(p.gameId === gameId ? p.values : {}), [column]: value } }));
      } else {
        setDraft((d) => ({ ...d, [column]: value }));
      }
    },
    reset() {
      setEdit(null);
      setDraft(defaultTagValues(position));
    },
    startEdit(play) {
      const untagged = !isTaggedPlay(play, position);
      setEdit({ untagged, values: untagged ? {} : tagValuesFromPlay(play, position) });
    },
    payload(facts) {
      return editingUntagged ? {} : tagPayload(position, values, facts);
    },
    missing(facts) {
      return editingUntagged ? NONE : missingTags(position, values, facts);
    },
  };
}
