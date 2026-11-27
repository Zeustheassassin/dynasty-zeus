// ============================================================
// Height, weight, birthday and eligible-thru year from PFF's player
// directory, against what the prospect has on file: the Roster sheet's
// "Fill from PFF" review (/api/pff/bio reads PFF; the sheet saves the changes
// the user keeps).
// ============================================================
// The user's rule (2026-10-12): where PFF has a height or weight that differs
// from theirs, PFF's wins; a field PFF leaves blank never blanks theirs.
// Birthdays: PFF has them for few college players, and many of the user's
// came from Wikipedia on purpose (they prefer it), so PFF fills a blank
// birthday, but one PFF disagrees with is only offered, unticked.
// Eligible thru (2026-10-13): PFF's current_eligible_year, the last draft he
// can enter (his eligibility runs out), not the first; PFF's wins.
// Jersey (2026-11-23, migration 104): PFF's jersey_number, the number he
// wears now (shown after his name on the charting boards); PFF's wins.
// Measured size (2026-11-27, migration 108, measuredSize.ts): once his height
// and weight were measured (combine, Senior Bowl, pro day …), PFF's listed
// ones are left out; the review says how many it kept.
// Client-safe: pure functions, no PFF client.
// ============================================================

import type { BioOnFile, PffBio } from "../pff/api";
import { parseHeightInches } from "./prospectAge";

/** PFF's height (feet and inches as one number: 602 = 6'2") → inches. Null when blank or unreadable. */
export function pffHeightInches(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isInteger(raw)) return null;
  const feet = Math.floor(raw / 100);
  const inches = raw % 100;
  if (feet < 4 || feet > 7 || inches > 11) return null;
  return feet * 12 + inches;
}

/** Inches → the sheet's text format, 6'2". */
export const heightText = (inches: number): string => `${Math.floor(inches / 12)}'${inches % 12}"`;

/** A jersey number as one or two digits (migration 104's CHECK), else null. "26", 26 and " 26 " → "26". */
export function jerseyNumber(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return /^\d{1,2}$/.test(s) ? s : null;
}

/** One PFF directory row → the numbers worth saving (implausible values dropped). */
export function readPffBio(p: {
  height: number | null;
  weight: number | null;
  dob: string | null;
  current_eligible_year?: number | null;
  jersey_number?: string | number | null;
}): PffBio {
  const weight = p.weight != null && Number.isInteger(p.weight) && p.weight >= 120 && p.weight <= 400 ? p.weight : null;
  const day = p.dob?.slice(0, 10) ?? "";
  const thru = p.current_eligible_year;
  return {
    heightIn: pffHeightInches(p.height),
    weight,
    dob: /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) ? day : null,
    // Same range as migration 071's CHECK.
    eligibleThru: thru != null && Number.isInteger(thru) && thru >= 2000 && thru <= 2100 ? thru : null,
    jersey: jerseyNumber(p.jersey_number),
  };
}

/** Each field is its prospects column, so a change saves as `{ [field]: to }`. */
export type BioField = "height" | "weight" | "birthday" | "eligible_thru_year" | "jersey_number";

export interface BioChange {
  /** `${prospectId}:${field}` */
  key: string;
  prospectId: string;
  name: string;
  field: BioField;
  /** As on file now: "" or null when blank. */
  from: string | number | null;
  /** What gets saved: height text, pounds, YYYY-MM-DD, a draft year, or a jersey number ("26"). */
  to: string | number;
  /** fill: his field is blank. update: PFF's differs. differs: a birthday PFF disagrees on. */
  kind: "fill" | "update" | "differs";
  /** Ticked when the review opens. */
  on: boolean;
}

export interface BioRow {
  prospectId: string;
  name: string;
  current: BioOnFile;
  pff: PffBio;
  /** His height and weight were measured (size_source set): PFF's are left out. */
  measured?: boolean;
}

/** Measured prospects whose height or weight PFF lists differently: kept, not offered. */
export function measuredKept(rows: readonly BioRow[]): { prospectId: string; name: string }[] {
  return rows.filter((r) => r.measured && (
    (r.pff.heightIn != null && parseHeightInches(r.current.height) !== r.pff.heightIn)
    || (r.pff.weight != null && r.current.weight !== r.pff.weight)
  )).map((r) => ({ prospectId: r.prospectId, name: r.name }));
}

/** Every field PFF would change, in prospect order then height, weight, birthday, eligible thru, jersey. */
export function bioChanges(rows: readonly BioRow[]): BioChange[] {
  const out: BioChange[] = [];
  for (const r of rows) {
    const add = (field: BioField, from: string | number | null, to: string | number, kind: BioChange["kind"]) =>
      out.push({ key: `${r.prospectId}:${field}`, prospectId: r.prospectId, name: r.name, field, from, to, kind, on: kind !== "differs" });

    const { heightIn, weight, dob, eligibleThru, jersey } = r.pff;
    // A measured size outranks PFF's listing.
    if (!r.measured && heightIn != null && parseHeightInches(r.current.height) !== heightIn) {
      add("height", r.current.height, heightText(heightIn), r.current.height.trim() === "" ? "fill" : "update");
    }
    if (!r.measured && weight != null && r.current.weight !== weight) {
      add("weight", r.current.weight, weight, r.current.weight == null ? "fill" : "update");
    }
    if (dob != null && r.current.birthday !== dob) {
      add("birthday", r.current.birthday, dob, r.current.birthday == null ? "fill" : "differs");
    }
    // PFF is the only source for this one, so its year wins like height and weight.
    if (eligibleThru != null && r.current.eligibleThru !== eligibleThru) {
      add("eligible_thru_year", r.current.eligibleThru, eligibleThru, r.current.eligibleThru == null ? "fill" : "update");
    }
    // His number now: a transfer or a switch shows up as an update, PFF's wins.
    if (jersey != null && r.current.jersey !== jersey) {
      add("jersey_number", r.current.jersey, jersey, r.current.jersey == null ? "fill" : "update");
    }
  }
  return out;
}

/** The changes grouped into one update per prospect. */
export function bioPatches(changes: readonly BioChange[]): Map<string, Partial<Record<BioField, string | number>>> {
  const out = new Map<string, Partial<Record<BioField, string | number>>>();
  for (const c of changes) out.set(c.prospectId, { ...out.get(c.prospectId), [c.field]: c.to });
  return out;
}
