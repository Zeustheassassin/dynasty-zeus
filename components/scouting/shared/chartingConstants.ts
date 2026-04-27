import type { ChartingDecision, RouteType } from "../../../lib/types";

export const GAME_TYPES = ["regular", "bowl", "playoff", "scrimmage"];

export const CHARTING_DECISIONS: { value: ChartingDecision; label: string }[] = [
  { value: "fully_charted", label: "Fully Charted" },
  { value: "partial_chart", label: "Partial Chart" },
  { value: "charting",      label: "Charting" },
  { value: "pending",       label: "Undecided" },
  { value: "not_charting",  label: "Not Charting" },
];

export const ROUTE_TYPES: RouteType[] = [
  "nine", "post", "dig", "curl", "slant", "screen", "flat", "comeback", "out", "corner", "other",
];

// Auto-promote within the charting → partial_chart → fully_charted chain based on game count.
// Manual "pending" (Undecided) and "not_charting" are left alone, and we never demote.
export function deriveChartingDecision(
  stored: ChartingDecision,
  totalGames: number,
): ChartingDecision {
  if (stored === "pending" || stored === "not_charting") return stored;
  if (totalGames >= 8) return "fully_charted";
  if (totalGames >= 1 && stored === "charting") return "partial_chart";
  return stored;
}
