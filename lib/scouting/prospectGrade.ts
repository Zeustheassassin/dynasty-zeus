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

/**
 * The pre-draft grade mirrors the Dynasty Score on this curve (the user's
 * points, 2026-11-12; the top retuned 2026-11-13 so +2.0 to +2.3 is 90–94.9
 * and +2.3 to +3.0 is 95–100): straight lines between them, the end grade held
 * past either end. The column's 1.0 floor still applies, so a Dynasty of about
 * −9.85 or lower stores 1.0, not 0. preGradeMirror.ts says when it applies.
 */
export const DYNASTY_GRADE_CURVE: readonly (readonly [dynasty: number, grade: number])[] = [
  [-10, 0],
  [-2.25, 50],
  [0, 75],
  [2, 90],
  [2.3, 95],
  [3, 100],
];

/** The grade a Dynasty Score maps to on DYNASTY_GRADE_CURVE, one decimal, 1.0–100.0. */
export function gradeFromDynasty(dynasty: number): number {
  const c = DYNASTY_GRADE_CURVE;
  const first = c[0];
  const last = c[c.length - 1];
  let g: number;
  if (!(dynasty > first[0])) g = first[1];
  else if (dynasty >= last[0]) g = last[1];
  else {
    const i = c.findIndex(([d]) => d >= dynasty); // 1..length-1 here
    const [d0, g0] = c[i - 1];
    const [d1, g1] = c[i];
    g = g0 + ((g1 - g0) * (dynasty - d0)) / (d1 - d0);
  }
  return roundGrade(clampGrade(g));
}

/** The curve for tooltips: "−10 → 0 · −2.25 → 50 · 0 → 75 · +2 → 90 · +2.3 → 95 · +3 → 100". */
export function dynastyGradeCurveText(): string {
  const num = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "0");
  return DYNASTY_GRADE_CURVE.map(([d, g]) => `${num(d)} → ${g}`).join(" · ");
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
