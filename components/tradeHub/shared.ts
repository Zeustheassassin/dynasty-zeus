import type { SleeperPlayer, AugmentedPick } from "../../lib/types";

export type PlayerWithValue = SleeperPlayer & { value: number };
export type PickWithValue = AugmentedPick & { value: number };

// Re-export the NFL-season-year window from the single source of truth so the
// trade hub can't drift from the corrected (March, not Jan-1) season rollover.
export { YEARS } from "../../lib/helpers/season";

export const buildTradeFingerprint = (
  leagueId: string,
  partnerRosterId: number | string,
  givePids: string[],
  receiveIds: string[],
) => `${leagueId}|${partnerRosterId}|${[...givePids].sort().join(",")}|${[...receiveIds].sort().join(",")}`;

export const ordinalSuffix = (n: number): string => {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
};
