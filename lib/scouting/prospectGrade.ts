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
 * The scout's tier scale, best→worst (the user's own cut-offs). `min` is
 * inclusive and a tier runs up to the next one's `min`; grades are one-decimal,
 * so Cornerstone is 90.0–94.9. Every consumer (grade colour, the Big Board
 * legend) iterates this list, so changing a cut-off or colour is one edit here.
 *
 * Colours match the Draft History outcome scale (lib/draft/playerTier.ts)
 * wherever the meanings line up, so a name reads the same colour everywhere:
 * Star amber, Starter emerald, Rotational ≈ Flex sky, Depth ≈ Bench Depth
 * slate, Practice Squad ≈ Roster Clogger orange, CFL ≈ Cut red. The two tiers
 * that scale lacks sit above its gold in purple.
 */
export interface GradeTier {
  label: string;
  /** Lowest grade in the tier, inclusive. */
  min: number;
  /** Text colour for a grade in this tier. */
  text: string;
  /** Solid fill for the legend swatch. */
  swatch: string;
}

export const GRADE_TIERS: readonly GradeTier[] = [
  { label: "Generational",   min: 95,        text: "text-fuchsia-400", swatch: "bg-fuchsia-400" },
  { label: "Cornerstone",    min: 90,        text: "text-violet-400",  swatch: "bg-violet-400" },
  { label: "Star",           min: 85,        text: "text-amber-400",   swatch: "bg-amber-400" },
  { label: "Starter",        min: 80,        text: "text-emerald-400", swatch: "bg-emerald-400" },
  { label: "Rotational",     min: 75,        text: "text-sky-400",     swatch: "bg-sky-400" },
  { label: "Depth",          min: 70,        text: "text-slate-300",   swatch: "bg-slate-300" },
  { label: "Practice Squad", min: 65,        text: "text-orange-400",  swatch: "bg-orange-400" },
  { label: "CFL",            min: GRADE_MIN, text: "text-red-400",     swatch: "bg-red-400" },
];

/** The tier a grade falls in; null when ungraded. */
export function gradeTier(g: number | null | undefined): GradeTier | null {
  if (g == null) return null;
  return GRADE_TIERS.find((t) => g >= t.min) ?? GRADE_TIERS[GRADE_TIERS.length - 1];
}

/** A tier's grade range for display: "95+", "90–94.9", …, "Under 65". */
export function gradeTierRange(tier: GradeTier): string {
  const i = GRADE_TIERS.indexOf(tier);
  if (i === 0) return `${tier.min}+`;
  const upper = GRADE_TIERS[i - 1].min;
  if (i === GRADE_TIERS.length - 1) return `Under ${upper}`;
  return `${tier.min}–${(upper - 0.1).toFixed(1)}`;
}

/** Tailwind text colour for a grade, by tier; dim slate when ungraded. */
export function gradeColor(g: number | null | undefined): string {
  return gradeTier(g)?.text ?? "text-slate-600";
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
