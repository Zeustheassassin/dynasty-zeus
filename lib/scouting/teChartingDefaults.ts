// ============================================================
// TE charting board defaults (the user's, 2026-10-19) — pre-filled picks the
// charter can change, so a typical rep is a click or two:
//   - Wide   → a block rep is a Movement block on a DB, Success.
//   - Slot   → a block rep is a Movement block on an LB, Success.
//   - Inline / Wing Back → the play starts as a Run Block (the user, 10/19,
//     first said Pass Block); a block rep (run or pass) is an Inline block on
//     a DL, Success.
//   - Route Run → Zone coverage, not targeted; once targeted, not contested.
// Full Back / Running Back have no block defaults (pick type and outcome).
// Pure: TEChartingBoard applies these when positioning or play type is picked,
// and to the next play after one is logged.
// ============================================================

import type { TEBlockType, TECoverage, TEPlayType, TEPositioning } from "../types";

export type TEBlockedDefender = "dl" | "lb" | "db";

export interface TEBlockDefaults {
  blockType: TEBlockType | null;
  blockSuccess: boolean | null;
  /** The play tag `blocked_defender`. */
  blockedDefender: TEBlockedDefender;
}

/** A block rep's pre-filled picks from where he lined up. */
export function teBlockDefaults(positioning: TEPositioning): TEBlockDefaults {
  switch (positioning) {
    case "wide":
      return { blockType: "movement", blockSuccess: true, blockedDefender: "db" };
    case "slot":
      return { blockType: "movement", blockSuccess: true, blockedDefender: "lb" };
    case "inline":
    case "wing_back":
      return { blockType: "inline", blockSuccess: true, blockedDefender: "dl" };
    default:
      // DL is the tag's own preset; no block type or outcome to assume.
      return { blockType: null, blockSuccess: null, blockedDefender: "dl" };
  }
}

/** A route rep's pre-filled picks. */
export const TE_ROUTE_DEFAULTS: { coverage: TECoverage; targeted: boolean } = { coverage: "zone", targeted: false };

/** A target's pre-filled pick once "Targeted? Yes" is on. */
export const TE_TARGET_DEFAULTS: { contestedTarget: boolean } = { contestedTarget: false };

/** The play type after moving to `positioning`: Inline and Wing Back start as a Run Block. */
export function tePlayTypeForPositioning(positioning: TEPositioning, current: TEPlayType): TEPlayType {
  return positioning === "inline" || positioning === "wing_back" ? "run_block" : current;
}

export const isTEBlock = (playType: TEPlayType) => playType === "run_block" || playType === "pass_block";
