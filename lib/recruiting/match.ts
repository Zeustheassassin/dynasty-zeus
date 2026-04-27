// Matches scouted Prospects (user-curated) against cached Recruits (CFD/247 Composite).
// Built around three signals in priority order:
//   1. Normalized name (suffix-stripped, alphanumeric-only) — uses normalizeRookieName so
//      "Carnell Tate Jr." matches "Carnell Tate" both directions.
//   2. Position window — prospect.position must equal recruit.position OR recruit.position
//      is "ATH" (multi-position designation; common for skill players who later specialize).
//   3. Year window — recruit's HS class year must fit a plausible NFL eligibility window
//      relative to prospect.draft_class_year (3-7 years prior). When multiple recruits
//      survive the window, the one closest to draft_year - 4 (typical 4-year senior path)
//      wins; further ties broken by stars desc.

import { normalizeRookieName } from "../../components/draftHub/shared";
import type { RecruitRow } from "./cfd";

export interface MatchableProspect {
  name: string;
  position: string;
  draft_class_year: number;
}

/** NFL eligibility = 3 years removed from HS class. We allow up to 7 years prior to cover
 *  redshirts, COVID super-seniors, and grad transfers. The "typical" path is 4 years
 *  (HS senior → 4-year college → NFL draft), used as the tie-break ideal. */
const MIN_YEARS_BEFORE_DRAFT = 3;
const MAX_YEARS_BEFORE_DRAFT = 7;
const TYPICAL_YEARS_BEFORE_DRAFT = 4;

function positionMatches(prospectPos: string, recruitPos: string | null): boolean {
  if (!recruitPos) return false;
  if (prospectPos === recruitPos) return true;
  // ATH is CFD's catch-all for multi-position skill players. Common for true freshmen
  // who haven't been pinned to a single position yet — accept as a fallback match.
  if (recruitPos === "ATH") return true;
  return false;
}

function yearInWindow(prospectDraftYear: number, recruitYear: number): boolean {
  const diff = prospectDraftYear - recruitYear;
  return diff >= MIN_YEARS_BEFORE_DRAFT && diff <= MAX_YEARS_BEFORE_DRAFT;
}

/** Index recruits by normalized name → array of matching rows. Built once per render. */
export function buildRecruitIndex(recruits: RecruitRow[]): Map<string, RecruitRow[]> {
  const idx = new Map<string, RecruitRow[]>();
  for (const r of recruits) {
    const key = normalizeRookieName(r.name);
    if (!key) continue;
    const list = idx.get(key);
    if (list) list.push(r);
    else idx.set(key, [r]);
  }
  return idx;
}

/** Find the best recruit match for a prospect. Returns null if no candidate fits the
 *  name + position + year-window constraints. */
export function findRecruitMatch(
  prospect: MatchableProspect,
  index: Map<string, RecruitRow[]>
): RecruitRow | null {
  const key = normalizeRookieName(prospect.name);
  if (!key) return null;

  const candidates = index.get(key);
  if (!candidates || candidates.length === 0) return null;

  const filtered = candidates.filter((r) =>
    positionMatches(prospect.position, r.position)
    && yearInWindow(prospect.draft_class_year, r.year)
  );
  if (filtered.length === 0) return null;
  if (filtered.length === 1) return filtered[0];

  // Tie-break: closest to typical 4-year path; if still tied, prefer higher stars.
  const ideal = prospect.draft_class_year - TYPICAL_YEARS_BEFORE_DRAFT;
  return filtered.slice().sort((a, b) => {
    const distA = Math.abs(a.year - ideal);
    const distB = Math.abs(b.year - ideal);
    if (distA !== distB) return distA - distB;
    return (b.stars ?? 0) - (a.stars ?? 0);
  })[0];
}
