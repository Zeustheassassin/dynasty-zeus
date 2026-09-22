"use client";
import { useCallback, useEffect, useRef } from "react";

/**
 * Turns a charting board's per-write `onDataChanged()` into "mark dirty, reload once".
 *
 * `onDataChanged` is the ScoutingHub's `loadAll`: 8 queries against the aggregate views plus,
 * for RB/QB/TE, a full league-wide plays refetch. Firing it after every charted play made
 * charting a reload storm, and it also blanked the league plays for a few seconds each time.
 * A board's own tables (`plays`, `games`) are updated locally per write; the only things that
 * need the hub's reload are the tabs that render hub-derived data (`flushTabs`) and whatever
 * the hub shows after the board closes.
 *
 * `markDirty()` records a write and reloads immediately only if the user is currently ON one of
 * `flushTabs` (so what they are looking at never goes stale — same as before). Otherwise the
 * reload waits for whichever comes first:
 *   - the user entering one of `flushTabs`, or
 *   - the board unmounting (back button, hub tab switch, position switch).
 * One reload per burst of writes, and none at all if nothing was written.
 */
export function useDeferredDataChanged(
  onDataChanged: () => void,
  tab: string,
  flushTabs: readonly string[],
): { markDirty: () => void; flush: () => void } {
  const dirtyRef = useRef(false);
  const onDataChangedRef = useRef(onDataChanged);
  const tabRef = useRef(tab);
  const flushTabsRef = useRef(flushTabs);

  useEffect(() => {
    onDataChangedRef.current = onDataChanged;
    tabRef.current = tab;
    flushTabsRef.current = flushTabs;
  }, [onDataChanged, tab, flushTabs]);

  const flush = useCallback(() => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    onDataChangedRef.current();
  }, []);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    if (flushTabsRef.current.includes(tabRef.current)) flush();
  }, [flush]);

  // Entering a tab that renders hub-derived data while writes are pending.
  useEffect(() => {
    if (flushTabs.includes(tab)) flush();
  }, [tab, flushTabs, flush]);

  // Board closing (unmount): the hub list / other hub tabs must see the writes.
  useEffect(() => flush, [flush]);

  return { markDirty, flush };
}
