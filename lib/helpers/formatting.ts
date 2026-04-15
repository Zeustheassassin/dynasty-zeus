// ============================================================
// Formatting helpers — dates, names, display text.
// ============================================================

/** Returns a human-friendly relative date string from a Unix timestamp (ms). */
export const formatRelativeDate = (ts: number) => {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 week ago";
  if (days < 21) return "2 weeks ago";
  if (days < 30) return "3 weeks ago";
  return "1 month ago";
};

/** Normalises a rookie player name for fuzzy matching:
 *  strips suffixes (Jr, II, etc.) and non-alpha characters. */
export const normalizeRookieName = (name: string) =>
  (name || "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/gi, "")
    .replace(/[^a-z]/g, "")
    .trim();

/** Stub — Sleeper ADP rookie board builder (not yet implemented). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const buildSleeperRookieBoard = (_playerMap: Record<string, unknown>) => [];
