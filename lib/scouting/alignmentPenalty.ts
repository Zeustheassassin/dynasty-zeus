// WR alignment concentration, the user's call from years of watching
// (2026-10-01): a receiver who lines up 75%+ of the snaps on one side of the
// field tends to be a worse NFL prospect, more so at 90%+. A receiver who
// lives in the slot carries a milder version of the same flag. It comes off
// the AE Score, so the Dynasty Score and Dynasty+ carry it too.
//
// The penalty starts at ALIGN_START% and curves up to its full size at
// ALIGN_FULL%: full × ((share − 75) / 20)^ALIGN_CURVE. That's gentle just past
// 75% and steep toward 95%. One side (left or right) can cost up to
// SIDE_MAX_PENALTY true-talent SDs; the slot up to SLOT_MAX_PENALTY. Shares are
// of all charted snaps (prospect_route_stats pct_left / pct_right / pct_slot,
// 0–100).
//
// On 2026-10-01, 18 of 85 qualifying WRs were over 75% on one side (6 over
// 90%) and 10 over 75% in the slot.

export const ALIGN_START = 75;
export const ALIGN_FULL = 95;
export const ALIGN_CURVE = 1.5;
export const SIDE_MAX_PENALTY = 0.5;
export const SLOT_MAX_PENALTY = 0.2;

export interface AlignmentPenalty { label: string; value: number }

interface AlignmentShares {
  pct_left?: number | null;
  pct_right?: number | null;
  pct_slot?: number | null;
}

const ramp = (share: number) =>
  Math.min(1, Math.max(0, (share - ALIGN_START) / (ALIGN_FULL - ALIGN_START))) ** ALIGN_CURVE;

/** The AE Score penalty (negative) for a WR's alignment, or null under 75% everywhere. */
export function alignmentPenalty(s: AlignmentShares): AlignmentPenalty | null {
  const left = s.pct_left ?? 0;
  const right = s.pct_right ?? 0;
  const slot = s.pct_slot ?? 0;
  const side = Math.max(left, right);
  const sideName = left >= right ? "left" : "right";
  // Shares sum to at most 100, so only one of these can pass 75%.
  if (side > ALIGN_START) {
    return { label: `${Math.round(side)}% of snaps on the ${sideName} side`, value: -SIDE_MAX_PENALTY * ramp(side) };
  }
  if (slot > ALIGN_START) {
    return { label: `${Math.round(slot)}% of snaps in the slot`, value: -SLOT_MAX_PENALTY * ramp(slot) };
  }
  return null;
}
