"use client";
import { useEffect, useRef } from "react";

/**
 * Calls `callback` every `intervalMs` while the tab is visible. Pauses when the
 * tab is hidden and, on returning to it, polls immediately if the data has
 * gone stale in the meantime. Never overlaps calls: a tick is skipped while
 * the previous one is still running. `intervalMs = null` disables polling.
 *
 * Does not call on mount — the caller's own load effect already does that.
 */
export function useVisibilityPolling(
  callback: () => void | Promise<void>,
  intervalMs: number | null
) {
  const callbackRef = useRef(callback);
  useEffect(() => { callbackRef.current = callback; });

  useEffect(() => {
    if (intervalMs == null || intervalMs <= 0) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    let running = false;
    let lastRun = Date.now();

    const tick = async () => {
      if (running) return;
      running = true;
      lastRun = Date.now();
      try { await callbackRef.current(); } catch { /* callbacks own their errors */ }
      finally { running = false; }
    };
    const start = () => {
      if (timer != null) return;
      timer = setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (timer == null) return;
      clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (Date.now() - lastRun >= intervalMs) void tick();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
}
