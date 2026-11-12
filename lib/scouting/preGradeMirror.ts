// The pre-draft grade mirrors the Dynasty Score (the user's call, 2026-11-12)
// on the curve in prospectGrade.ts (gradeFromDynasty), while the prospect's
// class is still to be drafted.
//
// The Big Board computes it from the live Dynasty Score and writes it to
// prospects.pre_draft_grade (migration 098), so every surface that reads the
// column (the prospect report, the charting header and Bio panel) shows the
// same grade. Once the class is drafted (scoreLock.ts classDraftedBy, May 1 of
// the draft year) the writes stop and the grade stays as it stood: the
// pre-draft record. A prospect without a Dynasty Score (no AE Score yet) keeps
// the grade typed by hand, and so does every drafted class.

import type { Prospect } from "../types";
import { gradeFromDynasty } from "./prospectGrade";
import { classDraftedBy } from "./scoreLock";

/** The grade his Dynasty Score maps to, or null when the Pre grade doesn't mirror it (no Dynasty, or a drafted class). */
export function mirroredPreGrade(
  p: { draft_class_year: number },
  dynasty: number | null | undefined,
  now: Date,
): number | null {
  if (dynasty == null || !Number.isFinite(dynasty) || classDraftedBy(p.draft_class_year, now)) return null;
  return gradeFromDynasty(dynasty);
}

/**
 * Off the Big Board: whether a prospect's Pre grade is the mirror, judged from
 * the Dynasty Score the board last saved (board_scores), so a form doesn't
 * offer to type over it.
 */
export function preGradeIsMirrored(
  p: Pick<Prospect, "draft_class_year" | "board_scores">,
  now: Date,
): boolean {
  return mirroredPreGrade(p, p.board_scores?.dynasty, now) != null;
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
