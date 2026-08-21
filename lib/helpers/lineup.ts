// ============================================================
// Lineup slot helpers — position eligibility and kickoff-window
// rebalancing for the Gameday Hub lineup optimiser.
// ============================================================
import type { LineupCoachRow } from "../types";

/** Positions that can fill a FLEX slot. */
export const FLEX_ELIGIBLE_POSITIONS = ["RB", "WR", "TE"];

/** Positions that can fill a SUPER_FLEX slot. */
export const SUPER_FLEX_ELIGIBLE_POSITIONS = ["QB", "RB", "WR", "TE"];

/** Returns the human-readable lineup format string for a Sleeper league
 *  (e.g. "QB 1 • RB 2 • WR 3 • SFLEX 1"). */
export const getLineupSettings = (
  league: { roster_positions?: string[] } | null | undefined
) => {
  const positions = league?.roster_positions || [];
  const counts: Record<string, number> = {};
  positions.forEach((pos: string) => {
    if (pos === "BN" || pos === "IR" || pos === "TAXI") return;
    counts[pos] = (counts[pos] || 0) + 1;
  });
  const order = ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX"];
  return order
    .filter((pos) => counts[pos])
    .map((pos) => `${pos === "SUPER_FLEX" ? "SFLEX" : pos} ${counts[pos]}`)
    .join(" • ");
};

/** Returns the eligible positions for a given roster slot name. */
export const getLineupSlotEligiblePositions = (slot: string) => {
  if (slot === "FLEX")       return FLEX_ELIGIBLE_POSITIONS;
  if (slot === "SUPER_FLEX") return SUPER_FLEX_ELIGIBLE_POSITIONS;
  return [slot];
};

/** Reorders a lineup so that players with earlier kickoffs move into
 *  locked positional slots from FLEX / SUPER_FLEX where eligible.
 *  No-ops when kickoff data is unavailable. */
export const rebalanceLineupForKickoffWindows = (
  lineup: LineupCoachRow[],
  hasKickoffData: boolean
) => {
  if (!hasKickoffData) return lineup;

  const nextLineup = [...lineup];
  const getKickoffSortValue = (row: { kickoffAt: number | null }) =>
    row.kickoffAt ?? Number.MAX_SAFE_INTEGER;

  const tryMoveEarlierPlayerIntoLockedSlot = (
    lockedSlot: string,
    flexSlot: "FLEX" | "SUPER_FLEX"
  ) => {
    const lockedIndexes = nextLineup
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.slot === lockedSlot && row.player?.player_id);

    lockedIndexes.forEach(({ row: lockedRow, index: lockedIndex }) => {
      // Recomputed fresh on every locked slot, not hoisted above the loop:
      // each swap below changes who currently occupies the FLEX slots, so a
      // stale snapshot would keep re-selecting (and re-clobbering) the same
      // candidate for every locked slot of this position instead of moving
      // on to the next-best one.
      const flexIndexes = nextLineup
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.slot === flexSlot && row.player?.player_id);

      const swapCandidate = flexIndexes
        .filter(({ row }) => row.player?.position === lockedSlot)
        .sort((a, b) => getKickoffSortValue(a.row) - getKickoffSortValue(b.row))[0];
      if (!swapCandidate) return;

      const lockedKickoff = getKickoffSortValue(lockedRow);
      const flexKickoff   = getKickoffSortValue(swapCandidate.row);
      if (flexKickoff >= lockedKickoff) return;

      nextLineup[lockedIndex]           = { ...swapCandidate.row, slot: lockedSlot };
      nextLineup[swapCandidate.index]   = { ...lockedRow, slot: flexSlot };
    });
  };

  ["RB", "WR", "TE"].forEach((slot) =>
    tryMoveEarlierPlayerIntoLockedSlot(slot, "FLEX")
  );
  ["QB", "RB", "WR", "TE"].forEach((slot) =>
    tryMoveEarlierPlayerIntoLockedSlot(slot, "SUPER_FLEX")
  );

  return nextLineup;
};
