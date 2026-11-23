// The pre-draft grade mirrors the Dynasty Score (the user's call, 2026-11-12)
// on the curve in prospectGrade.ts (gradeFromDynasty), in every class.
//
// The Big Board computes it from the live Dynasty Score and writes it to
// prospects.pre_draft_grade (migration 098), so every surface that reads the
// column (the prospect report, the charting header and Bio panel) shows the
// same grade. Drafted classes mirror too (the user, 2026-11-22: "adjust the
// Preranking to do it based on the Dynasty Score like the 2027 class and
// beyond … for all the 2026 players"); until then a drafted class kept the
// grade typed before its draft. A prospect without a Dynasty Score (no AE
// Score yet) keeps the grade typed by hand.

import type { Prospect } from "../types";
import { gradeFromDynasty } from "./prospectGrade";

/** The grade his Dynasty Score maps to, or null without one (his typed grade stands). */
export function mirroredPreGrade(dynasty: number | null | undefined): number | null {
  if (dynasty == null || !Number.isFinite(dynasty)) return null;
  return gradeFromDynasty(dynasty);
}

/**
 * Off the Big Board: whether a prospect's Pre grade is the mirror, judged from
 * the Dynasty Score the board last saved (board_scores), so a form doesn't
 * offer to type over it.
 */
export function preGradeIsMirrored(p: Pick<Prospect, "board_scores">): boolean {
  return mirroredPreGrade(p.board_scores?.dynasty) != null;
}

/**
 * The grades to write: each mirrored grade that differs from the stored one
 * and from what this visit already tried (`tried`), so a failed write isn't
 * sent again until the grade changes.
 */
export function changedPreGrades(
  prospects: readonly Pick<Prospect, "id" | "pre_draft_grade">[],
  mirrored: ReadonlyMap<string, number>,
  tried: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of prospects) {
    const g = mirrored.get(p.id);
    if (g == null || g === tried.get(p.id)) continue;
    const stored = p.pre_draft_grade == null ? null : Number(p.pre_draft_grade);
    if (stored !== g) out.set(p.id, g);
  }
  return out;
}
