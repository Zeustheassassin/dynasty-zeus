// ============================================================
// Measured size (stage 5 of the 2026-11-26 scouting plan, migration 108)
// ============================================================
// A measured height and weight replace the prospect's listed ones (PFF's or
// typed) and say where they were measured. Two ways in, both on the Prospect
// Data sheet's Measured sizes panel, both reviewed before anything saves:
//   - the combine, read from nflverse's combine.csv (the file Fill 40s reads;
//     POST /api/scouting/combine-sizes), heights in whole inches;
//   - a pasted list for the Senior Bowl, Shrine Bowl, a pro day or another
//     all-star game, with the source and the day picked: any list with a name,
//     a height (6003, 6'0 3/8", 6-0 3/8, 72.375) and a weight per line.
// Precedence (the plan): the combine, then the most recent other measurement,
// then PFF / listed. A measurement that loses is listed as kept, never saved.
// What he was listed at before the first measurement is kept in listed_height
// / listed_weight to show the change; "Back to listed" (Edit Bio) restores it.
// Fill from PFF leaves a measured size alone (pffBio.ts).
//
// height / weight keep holding the numbers every score reads (frame flags,
// the light-inside flag, role-fit size floors, Speed Score without a
// weigh-in), so those follow a measurement with no change of their own. A
// height keeps the eighths it was measured to; parseHeightInches reads it to
// the nearest inch.
//
// Matching. The combine: by name at his position in his class
// (fortyFill.ts matchFortyRows), a different school unticked, then by name and
// school at another skill position (matchCombineSizes). A pasted list:
// across every QB / RB / WR / TE in the classes shown, by his whole name in
// the line (else the line starting with it, punctuation dropped); a line that
// names a different position, or a measurement day outside his class's draft
// cycle, comes in unticked.
// Pure.
// ============================================================

import { normalizeRookieName } from "../helpers/formatting";
import type { SizeSource } from "../types";
import { csvFields, isFortyPos, matchFortyRows, schoolKey, type FortyMatch, type FortyPos } from "./fortyFill";

export const SIZE_SOURCES: readonly { key: SizeSource; label: string; short: string; at: string }[] = [
  { key: "combine",     label: "Combine",       short: "C",  at: "at the combine" },
  { key: "senior_bowl", label: "Senior Bowl",   short: "SB", at: "at the Senior Bowl" },
  { key: "shrine_bowl", label: "Shrine Bowl",   short: "SH", at: "at the Shrine Bowl" },
  { key: "pro_day",     label: "Pro day",       short: "PD", at: "at his pro day" },
  { key: "all_star",    label: "All-star game", short: "AS", at: "at an all-star game" },
];

/**
 * The sources a pasted list can be: the combine last, for a player its data
 * spells differently ("De'Zhaun-Ryan Stribling"); the rest of the combine
 * comes from nflverse.
 */
export const PASTE_SOURCES = [...SIZE_SOURCES.filter((s) => s.key !== "combine"), SIZE_SOURCES[0]];

export const isSizeSource = (s: unknown): s is SizeSource => SIZE_SOURCES.some((x) => x.key === s);
export const sizeSourceInfo = (s: SizeSource | null | undefined) => SIZE_SOURCES.find((x) => x.key === s) ?? null;

/** Plausible measured heights and weights; anything outside is read as not a size. */
export const HEIGHT_MIN_IN = 60;
export const HEIGHT_MAX_IN = 84;
export const WEIGHT_MIN = 150;
export const WEIGHT_MAX = 400;

// ── Heights ─────────────────────────────────────────────────────────────────

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Eighths of an inch → 6'0 3/8" (6'0" on a whole inch). */
export function measuredHeightText(eighths: number): string {
  const e = Math.round(eighths);
  const inches = Math.floor(e / 8);
  const frac = e % 8;
  const at = `${Math.floor(inches / 12)}'${inches % 12}`;
  if (frac === 0) return `${at}"`;
  const g = gcd(frac, 8);
  return `${at} ${frac / g}/${8 / g}"`;
}

const inRange = (eighths: number) => eighths >= HEIGHT_MIN_IN * 8 && eighths <= HEIGHT_MAX_IN * 8;

/** n/d of an inch in eighths, or null when it isn't a fraction under one. */
function fractionEighths(n: string | undefined, d: string | undefined): number | null {
  if (n == null || d == null) return 0;
  const num = Number(n);
  const den = Number(d);
  if (!(den > 0) || !(num >= 0) || num >= den) return null;
  return Math.round((num / den) * 8);
}

interface HeightHit { eighths: number; index: number; length: number }

// 6'0 3/8", 6’0”, 6-0 3/8, 6 ft 0 in. Not after a digit (a broad jump's 10'4").
const FT_IN = /(?<![\d.])([4-7])\s*(?:'|’|′|-|ft\.?)\s*(\d{1,2})(?!\d)(?:\s+(\d{1,2})\s*\/\s*(\d{1,2}))?\s*(?:"|”|″|''|in\.?)?/g;
// Scouts' code: feet, two digits of inches, eighths (6003 = 6'0 3/8").
const SCOUT = /(?<![\d./])([4-7])(\d{2})([0-7])(?![\d./])/g;
// Inches: 72.375, or 72 3/8.
const INCHES = /(?<![\d./])([5-8]\d)(?:\.(\d{1,4})|\s+(\d{1,2})\s*\/\s*(\d{1,2}))(?![\d./])/g;

function heightHits(line: string, re: RegExp, read: (m: RegExpExecArray) => number | null): HeightHit[] {
  const out: HeightHit[] = [];
  for (const m of line.matchAll(re)) {
    const e = read(m as RegExpExecArray);
    if (e != null && inRange(e)) out.push({ eighths: e, index: m.index ?? 0, length: m[0].length });
  }
  return out;
}

function findHeight(line: string): HeightHit | null {
  const ftIn = heightHits(line, FT_IN, (m) => {
    const inch = Number(m[2]);
    const f = fractionEighths(m[3], m[4]);
    return inch > 11 || f == null ? null : (Number(m[1]) * 12 + inch) * 8 + f;
  });
  if (ftIn.length) return ftIn[0];
  const scout = heightHits(line, SCOUT, (m) => {
    const inch = Number(m[2]);
    return inch > 11 ? null : (Number(m[1]) * 12 + inch) * 8 + Number(m[3]);
  });
  if (scout.length) return scout[0];
  const inches = heightHits(line, INCHES, (m) => {
    if (m[2] != null) return Math.round(Number(`${m[1]}.${m[2]}`) * 8);
    const f = fractionEighths(m[3], m[4]);
    return f == null ? null : Number(m[1]) * 8 + f;
  });
  return inches[0] ?? null;
}

/**
 * Height text → eighths of an inch, for a measured or a listed height
 * ("6'0 3/8\"", "6-2", "6003", "72.375"); null when unreadable. The whole text
 * must be the height.
 */
export function parseMeasuredHeight(text: string | null | undefined): number | null {
  const s = (text ?? "").trim();
  if (!s) return null;
  const hit = findHeight(s);
  return hit && hit.index === 0 && s.slice(hit.length).trim() === "" ? hit.eighths : null;
}

// A weight: 150–399, a whole number, maybe "lbs". Not part of another number.
const WEIGHT = /(?<![\d./'’-])(1[5-9]\d|[23]\d\d)(?:\s*(?:lbs?|pounds)\.?)?(?![\d./])/gi;

export interface LineSize {
  /** Eighths of an inch; null when the line has no height. */
  heightEighths: number | null;
  weight: number | null;
}

/** The first height and the first weight in one pasted line; null when it has neither. */
export function lineSize(line: string): LineSize | null {
  const h = findHeight(line);
  const rest = h ? line.slice(0, h.index) + " ".repeat(h.length) + line.slice(h.index + h.length) : line;
  let weight: number | null = null;
  for (const m of rest.matchAll(WEIGHT)) {
    const w = Number(m[1]);
    if (w >= WEIGHT_MIN && w <= WEIGHT_MAX) { weight = w; break; }
  }
  if (!h && weight == null) return null;
  return { heightEighths: h?.eighths ?? null, weight };
}

// ── A pasted list ───────────────────────────────────────────────────────────

/** "Jadan Baugh Jr." → " jadan baugh ": lower case, suffixes and punctuation out, words padded for whole-word search. */
function wordsOf(s: string): string {
  return ` ${s.toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, " ").replace(/[^a-z]+/g, " ").trim()} `;
}

// Position tokens a list may carry; the skill ones map to the board's positions.
// Upper case and standing alone, so an initial ("C.J.", "S.") or a name ("De'Von") isn't one.
const POSITION_TOKEN = /(?<![\w.'’])(QB|RB|HB|FB|WR|TE|OT|OG|OL|IOL|C|DT|DE|DL|EDGE|LB|ILB|OLB|CB|DB|S|FS|SS|K|P|LS|ATH)(?![\w.'’])/;
const SKILL_TOKENS = ["QB", "RB", "HB", "FB", "WR", "TE"];
const SAME_POSITION: Record<string, readonly string[]> = {
  QB: ["QB"], RB: ["RB", "HB", "FB"], WR: ["WR"], TE: ["TE"],
};

/** The position the line names, if any (upper case). */
function linePosition(line: string): string | null {
  return POSITION_TOKEN.exec(line)?.[1] ?? null;
}

/**
 * The line's first few words run together, one more each time ("1. C.J.
 * Allen LB" → cj, cjallen, cjallenlb …), for a name spelled with different
 * punctuation. Whole words only, so "Will Lee" never fits "Will Leeson".
 */
function leadKeys(line: string): Set<string> {
  const keys = new Set<string>();
  let acc = "";
  for (const tok of line.split(/\s+/).slice(0, 6)) {
    acc += normalizeRookieName(tok);
    if (acc) keys.add(acc);
  }
  return keys;
}

/** The draft a measurement on this day belongs to: January–April is that spring's draft, May on the next one. */
export function draftYearOf(measuredOn: string): number | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(measuredOn);
  if (!m) return null;
  return Number(m[2]) >= 5 ? Number(m[1]) + 1 : Number(m[1]);
}

export interface SizeProspect {
  id: string;
  name: string;
  position: string;
  school: string | null;
  draft_class_year: number | null;
  height: string | null;
  weight: number | null;
  size_source?: SizeSource | null;
  size_measured_on?: string | null;
  listed_height?: string | null;
  listed_weight?: number | null;
}

/** One prospect's measurement from a source, ready for sizeChanges. */
export interface SizeMatch {
  measurement: Measurement;
  /** Set when it comes in unticked: what to check first. */
  note?: string;
  /** The pasted line it came from. */
  line?: string;
}

export interface Measurement {
  source: SizeSource;
  /** YYYY-MM-DD; null for the combine. */
  measuredOn: string | null;
  heightEighths: number | null;
  weight: number | null;
}

export interface PastedList {
  matches: Map<string, SizeMatch>;
  /** Lines with a size that named no one in the pool: a QB / RB / WR / TE's, or one with no position. */
  unmatched: string[];
  /** Lines that fit two prospects equally. */
  ambiguous: string[];
  /** Prospects named on more than one line: left out. */
  repeated: { id: string; name: string }[];
  /** Lines read as a size (the rest of the paste is headers and blanks). */
  sized: number;
}

/**
 * Each prospect's line in a pasted list. A line counts when it has a height
 * or a weight; it goes to the one prospect whose whole name is in it (the
 * longest name when two fit, as "Will Lee" and "Will Lee Smith"), else whose
 * name it starts with once punctuation is dropped ("C.J. Allen" for CJ
 * Allen). A prospect on two lines gets neither.
 */
export function matchPastedList(
  text: string, pool: readonly SizeProspect[], source: SizeSource, measuredOn: string,
): PastedList {
  const names = pool.map((p) => ({ p, words: wordsOf(p.name), squashed: normalizeRookieName(p.name) }))
    .filter((n) => n.words.trim() !== "" && n.squashed !== "");
  // The combine is undated (it outranks the rest whenever it was), so its day is neither saved nor checked.
  const combine = source === "combine";
  const cycle = combine ? null : draftYearOf(measuredOn);
  const byProspect = new Map<string, { line: string; size: LineSize }[]>();
  const unmatched: string[] = [];
  const ambiguous: string[] = [];
  let sized = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const size = lineSize(line);
    if (!size) continue;
    sized++;
    const pos = linePosition(line);
    const lw = wordsOf(line);
    let fits = names.filter((n) => lw.includes(n.words));
    if (fits.length === 0) {
      const keys = leadKeys(line);
      fits = names.filter((n) => keys.has(n.squashed));
    }
    if (fits.length > 1) {
      const longest = Math.max(...fits.map((n) => n.words.length));
      fits = fits.filter((n) => n.words.length === longest);
    }
    if (fits.length === 0) {
      // A lineman or a defender isn't on the board; only a skill player's line is worth a look.
      if (!pos || SKILL_TOKENS.includes(pos)) unmatched.push(line);
      continue;
    }
    if (fits.length > 1) { ambiguous.push(line); continue; }
    const id = fits[0].p.id;
    byProspect.set(id, [...(byProspect.get(id) ?? []), { line, size }]);
  }
  const matches = new Map<string, SizeMatch>();
  const repeated: PastedList["repeated"] = [];
  for (const p of pool) {
    const hits = byProspect.get(p.id);
    if (!hits) continue;
    if (hits.length > 1) { repeated.push({ id: p.id, name: p.name }); continue; }
    const { line, size } = hits[0];
    const pos = linePosition(line);
    const notes = [
      pos && SAME_POSITION[p.position] && !SAME_POSITION[p.position].includes(pos) && pos !== "ATH"
        ? `the list has him at ${pos}` : null,
      cycle != null && p.draft_class_year != null && p.draft_class_year !== cycle
        ? `he's in your ${p.draft_class_year} class; a ${measuredOn} measurement is for the ${cycle} draft` : null,
    ].filter((x): x is string => x != null);
    matches.set(p.id, {
      measurement: { source, measuredOn: combine ? null : measuredOn, heightEighths: size.heightEighths, weight: size.weight },
      line,
      ...(notes.length ? { note: notes.join("; ") } : {}),
    });
  }
  return { matches, unmatched, ambiguous, repeated, sized };
}

// ── The combine (nflverse combine.csv) ──────────────────────────────────────

export interface CombineSizeRow {
  name: string;
  school: string | null;
  position: FortyPos;
  heightEighths: number | null;
  weight: number | null;
}

/** POST /api/scouting/combine-sizes's answer for one draft year. */
export interface CombineSizesResponse {
  year: number;
  /** Every QB / RB / WR / TE measured that year; null when that year's combine isn't in the file yet. */
  rows: CombineSizeRow[] | null;
}

/**
 * nflverse's combine.csv for one draft year: every QB / RB / WR / TE with a
 * height or a weight (ht "6-2", wt 228), whether or not he ran. `inYear`
 * counts every player of that year, so 0 means its combine isn't in yet.
 */
export function parseCombineSizes(csv: string, year: number): { rows: CombineSizeRow[]; inYear: number } {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
  const head = csvFields(lines[0] ?? "");
  const col = (k: string) => head.indexOf(k);
  const [iSeason, iName, iPos, iSchool, iHt, iWt] = ["season", "player_name", "pos", "school", "ht", "wt"].map(col);
  if ([iSeason, iName, iPos, iHt, iWt].some((i) => i < 0)) throw new Error("combine.csv: missing a season / player_name / pos / ht / wt column");
  const rows: CombineSizeRow[] = [];
  let inYear = 0;
  for (const line of lines.slice(1)) {
    const f = csvFields(line);
    if (Number(f[iSeason]) !== year) continue;
    inYear++;
    const pos = (f[iPos] ?? "").trim().toUpperCase();
    if (!isFortyPos(pos)) continue;
    const heightEighths = parseMeasuredHeight(f[iHt]);
    const w = Number((f[iWt] ?? "").trim());
    const weight = Number.isInteger(w) && w >= WEIGHT_MIN && w <= WEIGHT_MAX ? w : null;
    if (heightEighths == null && weight == null) continue;
    rows.push({
      name: f[iName].trim(), school: iSchool >= 0 ? f[iSchool].trim() || null : null,
      position: pos, heightEighths, weight,
    });
  }
  return { rows, inYear };
}

/**
 * One class's combine rows → measurements: by name at his position
 * (matchFortyRows, a different school unticked), then, for the rest, by name
 * at any skill position when the school agrees too (the combine had Eli
 * Heidenreich at RB, the board at WR; a size doesn't depend on it).
 */
export function matchCombineSizes(
  cls: readonly SizeProspect[], rows: readonly CombineSizeRow[], year: number,
): Map<string, SizeMatch> {
  const found = new Map(matchFortyRows<CombineSizeRow>(cls, rows, year));
  const used = new Set([...found.values()].map((m) => m.row));
  const byName = new Map<string, CombineSizeRow[]>();
  for (const r of rows) {
    const k = normalizeRookieName(r.name);
    byName.set(k, [...(byName.get(k) ?? []), r]);
  }
  for (const p of cls) {
    if (found.has(p.id) || p.draft_class_year !== year || !isFortyPos(p.position) || !p.school) continue;
    const cands = (byName.get(normalizeRookieName(p.name)) ?? [])
      .filter((r) => !used.has(r) && r.school && schoolKey(r.school) === schoolKey(p.school!));
    if (cands.length !== 1) continue;
    found.set(p.id, { row: cands[0], schoolDiffers: false });
    used.add(cands[0]);
  }
  return combineMatches(found);
}

/** matchFortyRows' combine matches → measurements, a different school unticked. */
export function combineMatches(found: ReadonlyMap<string, FortyMatch<CombineSizeRow>>): Map<string, SizeMatch> {
  const out = new Map<string, SizeMatch>();
  for (const [id, { row, schoolDiffers }] of found) {
    out.set(id, {
      measurement: { source: "combine", measuredOn: null, heightEighths: row.heightEighths, weight: row.weight },
      ...(schoolDiffers ? { note: `the combine lists him at ${row.school}` } : {}),
    });
  }
  return out;
}

// ── What saving would change ────────────────────────────────────────────────

const dayText = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};

/** "the Senior Bowl, Jan 27, 2027" / "the combine". */
function measuredText(source: SizeSource, on: string | null | undefined): string {
  const info = sizeSourceInfo(source);
  return `${info?.label ?? source}${on ? `, ${dayText(on)}` : ""}`;
}

/** Why this measurement can't replace the one on file, or null when it can. */
export function keptBecause(current: SizeProspect, m: Measurement): string | null {
  const cur = current.size_source ?? null;
  if (cur == null || m.source === "combine") return null;
  if (cur === "combine") return "his combine numbers are on file, and the combine outranks the rest";
  const curOn = current.size_measured_on ?? "";
  if (m.measuredOn != null && m.measuredOn < curOn) return `a later measurement is on file (${measuredText(cur, curOn)})`;
  return null;
}

export type SizePatch = {
  height?: string;
  weight?: number;
  size_source: SizeSource;
  size_measured_on: string | null;
  listed_height?: string | null;
  listed_weight?: number | null;
};

export interface SizeChange {
  /** `${prospectId}|size` */
  key: string;
  prospectId: string;
  name: string;
  position: string;
  source: SizeSource;
  measuredOn: string | null;
  /** On file now: 6'1" 212 (listed). */
  from: string;
  /** After saving: 6'0 3/8" 205. */
  to: string;
  patch: SizePatch;
  on: boolean;
  note?: string;
}

export interface SizeKept { id: string; name: string; why: string }

const sizeText = (height: string | null | undefined, weight: number | null | undefined) =>
  `${(height ?? "").trim() || "no height"} ${weight ?? "no weight"}`;

/** "6'1" 212 (listed)" / "6'0" 205 (Senior Bowl, Jan 27, 2027)". */
export function onFileText(p: SizeProspect): string {
  const src = p.size_source ?? null;
  return `${sizeText(p.height, p.weight)} (${src ? measuredText(src, p.size_measured_on) : "listed"})`;
}

/**
 * Every prospect a measurement would change, in pool order, and the ones it
 * can't (an outranking measurement on file). A measurement with the numbers
 * and the mark already on file is left out; one with the numbers but not the
 * mark (a listed 6'0" 205 measured at 6'0" 205) is a change, since it stops
 * PFF overwriting them. A field the measurement doesn't have stays as it is.
 */
export function sizeChanges(
  pool: readonly SizeProspect[], matches: ReadonlyMap<string, SizeMatch>,
): { changes: SizeChange[]; kept: SizeKept[] } {
  const changes: SizeChange[] = [];
  const kept: SizeKept[] = [];
  for (const p of pool) {
    const m = matches.get(p.id);
    if (!m) continue;
    const meas = m.measurement;
    const why = keptBecause(p, meas);
    if (why) { kept.push({ id: p.id, name: p.name, why }); continue; }
    const height = meas.heightEighths != null ? measuredHeightText(meas.heightEighths) : null;
    const sameHeight = meas.heightEighths == null || parseMeasuredHeight(p.height) === meas.heightEighths;
    const sameWeight = meas.weight == null || p.weight === meas.weight;
    const sameMark = p.size_source === meas.source && (p.size_measured_on ?? null) === meas.measuredOn;
    if (sameHeight && sameWeight && sameMark) continue;
    const patch: SizePatch = {
      ...(height != null && !sameHeight ? { height } : {}),
      ...(meas.weight != null && !sameWeight ? { weight: meas.weight } : {}),
      size_source: meas.source,
      size_measured_on: meas.measuredOn,
      // The first measurement keeps what he was listed at.
      ...(p.size_source == null ? { listed_height: (p.height ?? "").trim() || null, listed_weight: p.weight ?? null } : {}),
    };
    const notes = [
      m.note ?? null,
      meas.heightEighths == null ? "no height in it: his stays" : null,
      meas.weight == null ? "no weight in it: his stays" : null,
    ].filter((x): x is string => x != null);
    changes.push({
      key: `${p.id}|size`, prospectId: p.id, name: p.name, position: p.position,
      source: meas.source, measuredOn: meas.measuredOn,
      from: onFileText(p),
      to: sizeText(patch.height ?? p.height, patch.weight ?? p.weight),
      patch, on: m.note == null,
      ...(notes.length ? { note: notes.join("; ") } : {}),
    });
  }
  return { changes, kept };
}

// ── On file ─────────────────────────────────────────────────────────────────

/** His listed numbers back and the measurement off (Edit Bio → Back to listed). */
export function backToListedPatch(p: SizeProspect): {
  height: string; weight: number | null; size_source: null; size_measured_on: null; listed_height: null; listed_weight: null;
} {
  return {
    height: p.listed_height ?? "", weight: p.listed_weight ?? null,
    size_source: null, size_measured_on: null, listed_height: null, listed_weight: null,
  };
}

/** The chip after a measured size ("SB"), or null when it's listed. */
export function measuredShort(p: Pick<SizeProspect, "size_source">): string | null {
  return sizeSourceInfo(p.size_source)?.short ?? null;
}

/** The report page's fact after his size: "measured at the Senior Bowl (listed 6'1" 212)", or null when listed. */
export function measuredFact(p: Pick<SizeProspect, "size_source" | "listed_height" | "listed_weight">): string | null {
  const info = sizeSourceInfo(p.size_source);
  if (!info) return null;
  const listed = (p.listed_height ?? "").trim() || p.listed_weight != null ? ` (listed ${sizeText(p.listed_height, p.listed_weight)})` : "";
  return `measured ${info.at}${listed}`;
}

/** "Measured: Senior Bowl, Jan 27, 2027. Listed 6'1" 212.", or null when listed. */
export function measuredTitle(p: Pick<SizeProspect, "size_source" | "size_measured_on" | "listed_height" | "listed_weight">): string | null {
  const src = p.size_source ?? null;
  if (!src) return null;
  const listed = (p.listed_height ?? "").trim() || p.listed_weight != null
    ? ` Listed ${sizeText(p.listed_height, p.listed_weight)}.` : "";
  return `Measured: ${measuredText(src, p.size_measured_on)}.${listed}`;
}
