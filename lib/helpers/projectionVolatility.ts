// ============================================================
// Projection volatility (floor/ceiling spread across active sources).
// Used by StartersTab to flag boom/bust vs. steady-consensus players.
// ============================================================

import type { ProjectionRow } from "../types";

/** Need at least this many sources to actually matching this player before a
 *  spread means anything — 2 points is trivially "wide" or "tight" reading. */
export const MIN_VOLATILITY_SOURCES = 3;

/** Range (ceiling - floor) as a fraction of consensus fpts at/above which a
 *  player is flagged "volatile". */
export const HIGH_VOLATILITY_PCT = 0.20;

/** Range as a fraction of consensus fpts at/below which a player is flagged
 *  "safe" (tight agreement across sources). */
export const LOW_VOLATILITY_PCT = 0.08;

export type ProjectionVolatilityLevel = "volatile" | "safe" | "neutral";

export interface ProjectionVolatility {
  floor: number;
  ceiling: number;
  range: number;
  sourceCount: number;
  level: ProjectionVolatilityLevel;
}

/** Reads the floor/ceiling spread across a projection row's per-source fpts.
 *  Returns null when fewer than MIN_VOLATILITY_SOURCES sources matched this
 *  player — not enough data points for the spread to mean anything. */
export const getProjectionVolatility = (
  row: Pick<ProjectionRow, "fpts" | "sourceFpts"> | null | undefined
): ProjectionVolatility | null => {
  if (!row?.sourceFpts) return null;
  const values = Object.values(row.sourceFpts);
  if (values.length < MIN_VOLATILITY_SOURCES) return null;

  const floor = Math.min(...values);
  const ceiling = Math.max(...values);
  const range = ceiling - floor;
  const pct = row.fpts > 0 ? range / row.fpts : 0;
  const level: ProjectionVolatilityLevel =
    pct >= HIGH_VOLATILITY_PCT ? "volatile" : pct <= LOW_VOLATILITY_PCT ? "safe" : "neutral";

  return { floor, ceiling, range, sourceCount: values.length, level };
};
