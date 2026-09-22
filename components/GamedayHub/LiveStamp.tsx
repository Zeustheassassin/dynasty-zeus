"use client";
import React, { useEffect, useState } from "react";

interface LiveStampProps {
  /** When the data on screen was last refreshed (ms), or null if it hasn't been yet. */
  updatedAt: number | null;
  /** A game is in progress, so the data is being polled automatically. */
  live: boolean;
}

const formatAge = (seconds: number): string => {
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
};

// "● Live · Updated 12s ago". The clock is a state value written from an interval
// callback (not read during render), so the label ticks without refetching anything.
function LiveStamp({ updatedAt, live }: LiveStampProps) {
  // Date.now(), not updatedAt — a remount with an already-stale updatedAt (e.g. the user
  // switched tabs for a few minutes and came back) would otherwise show "just now" for up
  // to 5s until the first interval tick corrects it (code-review catch).
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const ageSeconds = updatedAt == null ? null : Math.max(Math.floor((now - updatedAt) / 1000), 0);

  return (
    <span className="inline-flex items-center gap-2 text-[11px] text-gray-500">
      {live && (
        <span className="inline-flex items-center gap-1 text-green-400" title="A game is in progress — scores refresh automatically while this tab is open">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" aria-hidden />
          Live
        </span>
      )}
      {ageSeconds != null && <span>Updated {formatAge(ageSeconds)}</span>}
    </span>
  );
}

export default React.memo(LiveStamp);
