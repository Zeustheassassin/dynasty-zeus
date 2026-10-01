// NFL draft rounds as the app stores them: 1–7, and 8 for undrafted. The Rookie
// Draft Hub has written an undrafted rookie as round 8, pick 300 all along, and
// prospects' `draft_round` uses the same number, so every surface reads 8 as
// "Undrafted" and never prints it as a round or the placeholder pick.

export const UNDRAFTED_ROUND = 8;
/** Every value a round picker offers, in order: 1st–7th, then Undrafted. */
export const DRAFT_ROUND_CHOICES: readonly number[] = [1, 2, 3, 4, 5, 6, 7, UNDRAFTED_ROUND];

const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];

/** "1st" … "7th", or "Undrafted". */
export function draftRoundLabel(round: number): string {
  if (round === UNDRAFTED_ROUND) return "Undrafted";
  return ORDINAL[round] ?? `Rd ${round}`;
}

/** A compact NFL draft slot: "KC · R1 · #8", "KC · Undrafted". Null when empty. */
export function nflDraftSlotLabel(info: { team?: string | null; round?: number | null; pick?: number | null }): string | null {
  const undrafted = info.round === UNDRAFTED_ROUND;
  const parts = [
    info.team || null,
    info.round != null ? (undrafted ? "Undrafted" : `R${info.round}`) : null,
    !undrafted && info.pick != null ? `#${info.pick}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
