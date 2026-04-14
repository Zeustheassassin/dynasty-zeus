// ============================================================
// Gameday / kickoff timing helpers.
// Used by GamedayHub to determine game state and display times.
// ============================================================

/** Extracts a kickoff timestamp (ms) from a raw Sleeper projection object,
 *  trying multiple field name variants returned by different API versions. */
export const getProjectionKickoffAt = (projection: any): number | null => {
  const rawCandidates = [
    projection?.kickoffAt,
    projection?.kickoff_at,
    projection?.gameTime,
    projection?.game_time,
    projection?.startTime,
    projection?.start_time,
  ];
  const parsed = rawCandidates
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value) && value > 0);
  return parsed || null;
};

/** Returns the current game state: "Upcoming", "Live", or "Final".
 *  A game is considered Live for up to 6 hours after kickoff. */
export const getKickoffState = (kickoffAt: number | null, now = Date.now()) => {
  if (!kickoffAt) return "Upcoming";
  if (now < kickoffAt) return "Upcoming";
  if (now - kickoffAt < 6 * 60 * 60 * 1000) return "Live";
  return "Final";
};

/** Returns Tailwind class string for a game state badge. */
export const getKickoffStateClasses = (state: string) => {
  if (state === "Live")  return "border-green-500/40 bg-green-500/10 text-green-300";
  if (state === "Final") return "border-gray-600 bg-gray-800 text-gray-300";
  return "border-blue-500/40 bg-blue-500/10 text-blue-300";
};

/** Formats a kickoff timestamp as a short local time string (e.g. "1:00 PM"). */
export const formatKickoffTime = (kickoffAt: number | null) => {
  if (!kickoffAt) return "--";
  try {
    return new Date(kickoffAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "--";
  }
};
