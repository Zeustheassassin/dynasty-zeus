"use client";
import { useCallback, useMemo, useState } from "react";
import { getLocalStorageItem, setLocalStorageItem } from "@/lib/hooks/useLocalStorage";
import type { DoneRecord } from "../../lib/helpers/actionQueue";

// To-Do hub Done marks — this device only (localStorage, no table), one list per Supabase account
// holding the current NFL week alone. A list saved for any other week reads as empty and is
// overwritten by the next mark, so old weeks prune themselves. Signed out, marks last the session.

interface StoredDone {
  week: string;
  items: Record<string, DoneRecord>;
}

interface DoneState {
  storageKey: string | null;
  week: string | null;
  items: Record<string, DoneRecord>;
}

export const todoDoneStorageKey = (accountId: string) => `todoDone:${accountId}`;

function readDone(storageKey: string | null, week: string | null): Record<string, DoneRecord> {
  if (!storageKey || !week) return {};
  const stored = getLocalStorageItem<StoredDone | null>(storageKey, null);
  return stored?.week === week && stored.items && typeof stored.items === "object" ? stored.items : {};
}

/** One item to mark done. `final`: marked again after it came back flagged — hidden for the
 *  rest of the week instead of re-checked. */
export interface TodoDoneMark {
  key: string;
  final?: boolean;
}

export interface UseTodoDoneReturn {
  /** This week's marks, keyed by ActionItem.key. */
  done: Record<string, DoneRecord>;
  /** Mark items done now, in one write. */
  markDone: (marks: TodoDoneMark[]) => void;
  undoDone: (key: string) => void;
}

/** `accountId` is the Supabase user id; `week` is lineupWeekKey(season, week) — null until
 *  the NFL state has loaded, when marking does nothing. */
export function useTodoDone(accountId: string | null, week: string | null): UseTodoDoneReturn {
  const storageKey = accountId ? todoDoneStorageKey(accountId) : null;
  const [state, setState] = useState<DoneState>({ storageKey: null, week: null, items: {} });

  // Re-read storage whenever the account or week changes (both arrive after mount).
  const done = useMemo(
    () => (state.storageKey === storageKey && state.week === week ? state.items : readDone(storageKey, week)),
    [state, storageKey, week]
  );

  const save = useCallback((items: Record<string, DoneRecord>) => {
    if (!week) return;
    if (storageKey) setLocalStorageItem<StoredDone>(storageKey, { week, items });
    setState({ storageKey, week, items });
  }, [storageKey, week]);

  const markDone = useCallback((marks: TodoDoneMark[]) => {
    if (marks.length === 0) return;
    const at = Date.now();
    const next = { ...done };
    for (const { key, final } of marks) next[key] = final ? { at, final: true } : { at };
    save(next);
  }, [done, save]);

  const undoDone = useCallback((key: string) => {
    if (!(key in done)) return;
    const next = { ...done };
    delete next[key];
    save(next);
  }, [done, save]);

  return { done, markDone, undoDone };
}
