// A prospect's age: exact from the birthday when there is one, otherwise
// estimated from the 247 high-school class year (recruits table, matched by
// lib/recruiting/match.ts). No public source carries college players'
// birthdates, so a 2027 or 2028 prospect usually only has the estimate. It's
// never written back as a birthday.
//
// Calibrated 2026-10-01 on the 63 prospects with both a real birthdate and an
// HS class: age at the late-April draft = (draft year − HS class) + 18.4, with
// a mean error of 0.05 years and an SD of 0.44. An HS class of Y therefore
// implies a birth near Y − 18.085 as a decimal year.

const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;
const HS_CLASS_TO_BIRTH_YEARS = 18.085;

export interface ProspectAge {
  years: number;
  /** True when it comes from the HS class year, not a birthday. */
  estimated: boolean;
}

function birthMs(birthday: string | null | undefined, hsClassYear: number | null | undefined): { ms: number; estimated: boolean } | null {
  if (birthday) {
    const t = new Date(birthday).getTime();
    if (!Number.isNaN(t)) return { ms: t, estimated: false };
  }
  if (hsClassYear != null) {
    const decimal = hsClassYear - HS_CLASS_TO_BIRTH_YEARS;
    return { ms: Date.UTC(1970, 0, 1) + (decimal - 1970) * MS_PER_YEAR, estimated: true };
  }
  return null;
}

/** Age (decimal years) on `at`, or null with neither a birthday nor an HS class. */
export function prospectAgeAt(
  at: Date,
  birthday: string | null | undefined,
  hsClassYear: number | null | undefined,
): ProspectAge | null {
  const b = birthMs(birthday, hsClassYear);
  if (!b) return null;
  return { years: (at.getTime() - b.ms) / MS_PER_YEAR, estimated: b.estimated };
}

/** Age on Sept 1 of the draft year: how old the prospect is for the rookie season. */
export function rookieSeasonAge(
  draftClassYear: number,
  birthday: string | null | undefined,
  hsClassYear: number | null | undefined,
): ProspectAge | null {
  return prospectAgeAt(new Date(Date.UTC(draftClassYear, 8, 1)), birthday, hsClassYear);
}

/** Height text as entered ("6'2\"", "6’2”", "6-2", "74") → inches. Null if unreadable. */
export function parseHeightInches(height: string | null | undefined): number | null {
  if (!height) return null;
  const s = height.trim();
  const ftIn = s.match(/^(\d)\s*['’-]\s*(\d{1,2})/);
  if (ftIn) return Number(ftIn[1]) * 12 + Number(ftIn[2]);
  const inches = s.match(/^(\d{2})(\.\d+)?$/);
  if (inches) return Number(s);
  return null;
}
