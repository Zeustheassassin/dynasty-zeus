// ============================================================
// Draft pick value helpers — key generation, value lookup,
// draft type detection, slot calculation, and FantasyCalc fetch.
// ============================================================

import { CURRENT_YEAR } from "./season";

/** Minimal pick shape needed for value key generation (subset of SleeperTradedPick). */
interface PickLike {
  season?: string | number;
  round?: number;
  slot?: string;
}

/** Minimal draft shape needed for snake detection (Sleeper's schema is inconsistent across endpoints). */
interface DraftLike {
  type?: string;
  settings?: { type?: string; draft_type?: string; [key: string]: unknown };
  metadata?: { type?: string; draft_type?: string; [key: string]: unknown };
}

/** FantasyCalc value entry from the /api/fc-values response. */
interface FcEntry {
  player?: { position?: string; name?: string; sleeperId?: string | number };
  value?: number;
}

/** Returns the FantasyCalc pick key for a traded/owned pick.
 *  Current-year picks with known slots use slot format ("2026-1.06");
 *  future picks or unknown slots use round format ("2027-1"). */
export const getPickValueKey = (pick: PickLike): string => {
  if (
    pick?.season === CURRENT_YEAR &&
    pick?.slot &&
    String(pick.slot).includes(".")
  ) {
    return `${pick.season}-${pick.slot}`;
  }
  return `${pick?.season}-${pick?.round}`;
};

/** Looks up a pick's value from the pickValues map, falling back
 *  from the specific slot key to the round key if needed. */
export const getStoredPickValue = (
  pickValues: Record<string, number>,
  pick: PickLike
): number =>
  pickValues[getPickValueKey(pick)] ??
  pickValues[`${pick?.season}-${pick?.round}`] ??
  0;

/** Returns true when the draft type is identified as a snake draft
 *  (checks multiple field locations since Sleeper's schema is inconsistent). */
export const isSnakeDraft = (draft: DraftLike): boolean => {
  const typeCandidates = [
    draft?.type,
    draft?.settings?.type,
    draft?.settings?.draft_type,
    draft?.metadata?.type,
    draft?.metadata?.draft_type,
  ]
    .map((value) => String(value || "").toLowerCase())
    .filter(Boolean);

  return typeCandidates.some((value) => value.includes("snake"));
};

/** Calculates the draft slot position for a team in a given round,
 *  reversing direction in even rounds for snake drafts. */
export const getDraftRoundSlot = (
  draft: DraftLike,
  round: number,
  baseSlot: number,
  totalTeams: number
): number => {
  if (!baseSlot || baseSlot < 1 || totalTeams < 2) return baseSlot;
  if (!isSnakeDraft(draft)) return baseSlot;
  return round % 2 === 0 ? totalTeams - baseSlot + 1 : baseSlot;
};

/** Fetches dynasty values from the /api/fc-values proxy and normalises
 *  them into separate player and pick value maps keyed by Sleeper ID. */
export const fetchFantasyCalcValues = async (
  numQbs = 1
): Promise<{ playerValues: Record<string, number>; pickValues: Record<string, number> }> => {
  const res = await fetch(`/api/fc-values?numQbs=${numQbs}`);
  const data = await res.json();

  const playerValues: Record<string, number> = {};
  const slotPickValues: Record<string, number[]> = {};
  const pickBuckets: Record<string, number[]>     = {};
  const pickRoundValues: Record<string, number>   = {};

  data.forEach((entry: FcEntry) => {
    if (typeof entry.value !== "number" || entry.value <= 0) return;
    const value = entry.value;
    if (entry.player?.position === "PICK") {
      // Specific slot — e.g. "2026 Pick 1.04"
      const slotMatch = entry.player.name?.match(/^(\d{4}) Pick (\d+)\.(\d{1,2})$/);
      if (slotMatch) {
        const roundKey = `${slotMatch[1]}-${slotMatch[2]}`;
        const slotKey  = `${slotMatch[1]}-${slotMatch[2]}.${slotMatch[3].padStart(2, "0")}`;
        if (!slotPickValues[slotKey]) slotPickValues[slotKey] = [];
        slotPickValues[slotKey].push(value);
        if (!pickBuckets[roundKey]) pickBuckets[roundKey] = [];
        pickBuckets[roundKey].push(value);
        return;
      }
      // Future round — e.g. "2027 1st"
      const roundMatch = entry.player.name?.match(/^(\d{4})\s+(\d+)(?:st|nd|rd|th)$/);
      if (roundMatch) {
        pickRoundValues[`${roundMatch[1]}-${roundMatch[2]}`] = value;
      }
    } else {
      const sleeperId = entry.player?.sleeperId;
      if (sleeperId) playerValues[String(sleeperId)] = value;
    }
  });

  const pickValues: Record<string, number> = {};

  // Average multiple slot entries for the same slot key
  Object.entries(slotPickValues).forEach(([key, vals]) => {
    pickValues[key] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  });

  // Average current-year round buckets
  Object.entries(pickBuckets).forEach(([key, vals]) => {
    pickValues[key] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  });

  // Fill future-year first-round values from named picks
  Object.entries(pickRoundValues).forEach(([key, val]) => {
    if (!pickValues[key]) pickValues[key] = val;
  });

  // Derive future-year 2nd/3rd/4th using current-year ratios
  const base1st = pickValues[`${CURRENT_YEAR}-1`];
  if (base1st) {
    Object.entries(pickRoundValues).forEach(([key]) => {
      const [year, roundStr] = key.split("-");
      if (roundStr !== "1") return;
      const yr1stVal = pickValues[key];
      [2, 3, 4].forEach((r) => {
        const rKey = `${year}-${r}`;
        if (!pickValues[rKey]) {
          const baseCurrentYear = pickValues[`${CURRENT_YEAR}-${r}`];
          if (baseCurrentYear) {
            pickValues[rKey] = Math.round(yr1stVal * (baseCurrentYear / base1st));
          }
        }
      });
    });
  }

  return { playerValues, pickValues };
};
