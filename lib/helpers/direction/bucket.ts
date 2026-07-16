import type { StrategicBucket } from "../../types";

/**
 * Maps (dynasty rank, redraft rank, leagueSize) → a strategic bucket label + Tailwind color.
 *
 * Uses percentile-based thresholds so the grid scales correctly for 8-team
 * and 14-team leagues alike:
 *   top20 = top-20% = ceil(n × 0.20)   — "Elite" cut
 *   top33 = top-33% = ceil(n × 0.33)   — upper-tier cut
 *   bot33 = bottom-33% cut = ceil(n × 0.67)  (ranks > bot33 are bottom third)
 *
 * 3×3 grid:
 *
 *              │ redRank ≤ top33  │ top33 < red ≤ bot33 │ redRank > bot33
 * ─────────────┼──────────────────┼─────────────────────┼─────────────────
 * dyn ≤ top33  │ Elite / True Con │ Almost There        │ Rebuilder
 * mid dynasty  │ Fading Contender │ Purgatory           │ Stranded
 * dyn > bot33  │ Window Closing   │ Fading Out          │ Hopeless
 *
 * Elite is the sub-case where BOTH ranks land in the top-20%.
 */
export const getLeagueDirectionBucket = (dynRank: number, redRank: number, leagueSize = 12): { bucket: StrategicBucket; bucketColor: string } => {
  const n     = leagueSize;
  const top20 = Math.ceil(n * 0.20);
  const top33 = Math.ceil(n * 0.33);
  const bot33 = Math.ceil(n * 0.67);

  // ── Top-third dynasty ─────────────────────────────────────
  if (dynRank <= top33) {
    if (redRank <= top33) {
      // Elite: both in top-20%
      if (dynRank <= top20 && redRank <= top20)
        return { bucket: "Elite",          bucketColor: "text-yellow-300 bg-yellow-900/40 border-yellow-600" };
      return   { bucket: "True Contender", bucketColor: "text-green-300 bg-green-900/40 border-green-600" };
    }
    if (redRank <= bot33)
      return   { bucket: "Almost There",   bucketColor: "text-cyan-300 bg-cyan-900/40 border-cyan-600" };
    return     { bucket: "Rebuilder",      bucketColor: "text-indigo-300 bg-indigo-900/40 border-indigo-600" };
  }

  // ── Middle-third dynasty ──────────────────────────────────
  if (dynRank <= bot33) {
    if (redRank <= top33)
      return { bucket: "Fading Contender", bucketColor: "text-blue-300 bg-blue-900/40 border-blue-600" };
    if (redRank <= bot33)
      return { bucket: "Purgatory",        bucketColor: "text-orange-300 bg-orange-900/40 border-orange-600" };
    return   { bucket: "Stranded",         bucketColor: "text-rose-300 bg-rose-900/40 border-rose-600" };
  }

  // ── Bottom-third dynasty ──────────────────────────────────
  if (redRank <= top33)
    return { bucket: "Window Closing", bucketColor: "text-amber-300 bg-amber-900/40 border-amber-600" };
  if (redRank <= bot33)
    return { bucket: "Fading Out",     bucketColor: "text-purple-300 bg-purple-900/40 border-purple-600" };
  return   { bucket: "Hopeless",       bucketColor: "text-red-300 bg-red-900/40 border-red-600" };
};

export type DynastyTier = "Contender" | "Middle" | "Rebuilding";

/** Coarse 3-band grouping of dynasty rank, same top33/bot33 thresholds as
 *  the bucket grid above — feeds Phase D's tiered standings bands (D3),
 *  which color-code by dynasty direction without needing the full 10-label
 *  bucket grid. */
export const getDynastyTier = (dynRank: number, leagueSize = 12): DynastyTier => {
  const n = leagueSize;
  const top33 = Math.ceil(n * 0.33);
  const bot33 = Math.ceil(n * 0.67);
  if (dynRank <= top33) return "Contender";
  if (dynRank <= bot33) return "Middle";
  return "Rebuilding";
};

/** Detached color lookup — lets adjusted buckets get the right colour
 *  without needing to re-derive ranks. */
export const getBucketColor = (bucket: string): string => {
  const map: Record<string, string> = {
    "Elite":            "text-yellow-300 bg-yellow-900/40 border-yellow-600",
    "True Contender":   "text-green-300 bg-green-900/40 border-green-600",
    "Almost There":     "text-cyan-300 bg-cyan-900/40 border-cyan-600",
    "Rebuilder":        "text-indigo-300 bg-indigo-900/40 border-indigo-600",
    "Fading Contender": "text-blue-300 bg-blue-900/40 border-blue-600",
    "Window Closing":   "text-amber-300 bg-amber-900/40 border-amber-600",
    "Purgatory":        "text-orange-300 bg-orange-900/40 border-orange-600",
    "Stranded":         "text-rose-300 bg-rose-900/40 border-rose-600",
    "Fading Out":       "text-purple-300 bg-purple-900/40 border-purple-600",
    "Hopeless":         "text-red-300 bg-red-900/40 border-red-600",
  };
  return map[bucket] ?? "text-gray-300 bg-gray-800 border-gray-600";
};
