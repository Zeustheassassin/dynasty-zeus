/**
 * Prospect draft grades — the 1.0–100.0 one-decimal scale shared by every
 * surface that reads or edits `prospects.pre_draft_grade` /
 * `prospects.post_draft_grade` (Big Board cells, the charting Bio panel, the
 * charting header badge).
 *
 * The DB column is `numeric(4,1)` with a CHECK of 1–100 (migration 054), so the
 * parse below is the client-side mirror of that constraint: anything the user
 * types is clamped into range and rounded to one decimal *before* it is sent,
 * rather than letting Postgres silently round 88.63 to 88.6 or reject 120 with
 * a constraint error the user would see as a failed save.
 *
 * NULL means *ungraded*, which is deliberately distinct from a low grade — an
 * empty input clears the grade instead of writing 1.0.
 */

export const GRADE_MIN = 1;
export const GRADE_MAX = 100;

/** The two gradeable fields on a prospect. */
export type GradeField = "pre_draft_grade" | "post_draft_grade";

/**
 * Parse raw input-field text into a storable grade.
 *
 * @returns the clamped, one-decimal grade; `null` for blank input (= clear the
 *          grade); and `undefined` for text that isn't a number at all, which
 *          the caller should treat as "don't write anything".
 */
export function parseGrade(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return undefined;
  return roundGrade(clampGrade(n));
}

/** Clamp to the 1–100 range the DB CHECK enforces. */
export function clampGrade(n: number): number {
  return Math.min(GRADE_MAX, Math.max(GRADE_MIN, n));
}

/**
 * Round to one decimal. Uses a scaled round rather than `toFixed` so the result
 * stays a number, and nudges by Number.EPSILON so binary-float values that sit a
 * hair below a .x5 boundary (88.65 is really 88.6499…) still round up the way a
 * user typing "88.65" expects.
 */
export function roundGrade(n: number): number {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

/** Display form: always one decimal, em dash when ungraded. */
export function formatGrade(g: number | null | undefined): string {
  return g == null ? "—" : g.toFixed(1);
}

/**
 * Tailwind text colour for a grade, so a board scanned at a glance separates
 * the tiers. Tuned to the way these grades are used on the board — 90+ is a
 * blue-chip, 80+ a clear starter, 70+ a contributor, below that a flier —
 * rather than to a generic red/green split.
 */
export function gradeColor(g: number | null | undefined): string {
  if (g == null) return "text-slate-600";
  if (g >= 90) return "text-emerald-400";
  if (g >= 80) return "text-sky-400";
  if (g >= 70) return "text-slate-200";
  return "text-slate-500";
}

/**
 * post − pre, or null when either side is ungraded. The board shows this as the
 * "how much did the landing spot move him" column.
 */
export function gradeDelta(
  pre: number | null | undefined,
  post: number | null | undefined,
): number | null {
  if (pre == null || post == null) return null;
  return roundGrade(post - pre);
}
