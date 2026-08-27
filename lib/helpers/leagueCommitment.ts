// ============================================================
// League Management "commitment status" + advance-payment display
// helpers, shared by League Hub's Overview tab and the Dashboard's
// team summary cards so both read leagueMgmtData the same way.
// ============================================================
import type { LeagueMgmtRow } from "../types";

/** Tailwind text color class for a league name, driven by commitment_status.
 *  Muted/desaturated tones on purpose — full-saturation red-500/amber-400
 *  repeated down a long league list read as visually jarring. */
export function getCommitmentNameColor(row: LeagueMgmtRow | undefined): string {
  switch (row?.commitment_status) {
    case "leaving": return "text-red-400/80";
    case "on_fence": return "text-amber-300/80";
    case "staying": return "text-emerald-400/80";
    default: return "";
  }
}

/** Seasons after the current one marked paid (paid_YYYY === true) on a league_management row. */
function getFuturePaidYears(row: LeagueMgmtRow | undefined): number[] {
  if (!row) return [];
  const currentYear = new Date().getFullYear();
  return Object.keys(row)
    .filter((k) => k.startsWith("paid_") && row[k] === true)
    .map((k) => Number(k.slice("paid_".length)))
    .filter((y) => Number.isFinite(y) && y > currentYear)
    .sort((a, b) => a - b);
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
  const futurePaidYears = getFuturePaidYears(row);
  if (futurePaidYears.length === 0) return null;

  const maxYear = futurePaidYears[futurePaidYears.length - 1];
  return {
    label: futurePaidYears.length === 1 ? `Paid ${maxYear}` : `Paid thru ${maxYear}`,
    colorClass: "text-emerald-400 bg-emerald-950/40 border-emerald-800",
  };
}

/** True if any season after the current one is marked paid. Drives the Paid Future dot. */
export function isFuturePaid(row: LeagueMgmtRow | undefined): boolean {
  return getFuturePaidYears(row).length > 0;
}

/** Softened dot color (same muted palette as commitment status) for the Paid Future indicator. */
export function getPaidFutureDotColor(paid: boolean): string {
  return paid ? "bg-emerald-400/70" : "bg-red-400/70";
}
