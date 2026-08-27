// ============================================================
// League Management "commitment status" + advance-payment display
// helpers, shared by League Hub's Overview tab and the Dashboard's
// team summary cards so both read leagueMgmtData the same way.
// ============================================================
import type { LeagueMgmtRow } from "../types";

/** Tailwind text color class for a league name, driven by commitment_status. */
export function getCommitmentNameColor(row: LeagueMgmtRow | undefined): string {
  switch (row?.commitment_status) {
    case "leaving": return "text-red-500";
    case "on_fence": return "text-amber-400";
    case "staying": return "text-emerald-400";
    default: return "";
  }
}

export interface FuturePaidBadge {
  label: string;
  colorClass: string;
}

/**
 * Summarizes which seasons after the current one are marked paid on a
 * league_management row, e.g. "Paid thru 2028". Returns null when nothing
 * beyond the current season is paid, so callers can omit the badge.
 */
export function getFuturePaidBadge(row: LeagueMgmtRow | undefined): FuturePaidBadge | null {
  if (!row) return null;
  const currentYear = new Date().getFullYear();
  const futurePaidYears = Object.keys(row)
    .filter((k) => k.startsWith("paid_") && row[k] === true)
    .map((k) => Number(k.slice("paid_".length)))
    .filter((y) => Number.isFinite(y) && y > currentYear)
    .sort((a, b) => a - b);

  if (futurePaidYears.length === 0) return null;

  const maxYear = futurePaidYears[futurePaidYears.length - 1];
  return {
    label: futurePaidYears.length === 1 ? `Paid ${maxYear}` : `Paid thru ${maxYear}`,
    colorClass: "text-emerald-400 bg-emerald-950/40 border-emerald-800",
  };
}
