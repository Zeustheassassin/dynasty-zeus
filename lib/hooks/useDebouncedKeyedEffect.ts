"use client";
import { useRef, useEffect, useCallback } from "react";

/**
 * Debounces a per-key side effect (typically a Supabase write triggered on
 * every keystroke of a textarea) so rapid repeated calls with the same key
 * collapse into a single call with the latest value after a pause, instead
 * of firing one request per keystroke and racing on the network — an
 * earlier keystroke's request resolving after a later one's would otherwise
 * leave stale, truncated text persisted despite the UI showing the full text.
 *
 * Different keys debounce independently (e.g. one call site editing several
 * leagues' bylaws keeps a separate timer per league_id).
 */
export function useDebouncedKeyedEffect(delayMs = 600) {
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  return useCallback(
    (key: string, fn: () => void) => {
      const existing = timers.current.get(key);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        timers.current.delete(key);
        fn();
      }, delayMs);
      timers.current.set(key, t);
    },
    [delayMs]
  );
}
