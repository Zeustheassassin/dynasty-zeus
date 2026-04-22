import type { SleeperPlayer, AugmentedPick } from "../../lib/types";

export type PlayerWithValue = SleeperPlayer & { value: number };
export type PickWithValue = AugmentedPick & { value: number };

export const BASE_YEAR_TH = new Date().getFullYear();
export const YEARS = Array.from({ length: 3 }, (_, i) => String(BASE_YEAR_TH + i));

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
