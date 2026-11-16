// Fill 40s (the Prospect Data sheet, 2026-11-15): projected 40s from
// WalterFootball's position rankings now, and the combine's official times
// with the weigh-ins once they're out (nflverse's combine.csv, early March
// each year). Pure: reading the two sources, matching them to the user's
// prospects, and the changes the user reviews before anything is saved. The
// fetching is lib/server/fortyTimes.ts.
//
// WalterFootball, not NFL Draft Buzz (which lists a 40 for everyone): Draft
// Buzz answers automated requests with a Cloudflare challenge (cf-mitigated:
// challenge), i.e. it doesn't want them, and that's respected. Stick to the
// Model lists hardly any (3 of 56 RBs). WalterFootball projects its ranked
// players (2027: 22 QB, 19 RB, 29 WR, 22 TE) and its robots.txt allows all.
//
// A combine time is a real 40 (forty_time, source combine, the weigh-in as
// forty_weight) and counts in the RB speed floor. A projection goes in
// forty_projected and is shown only: it has no stated method or track record,
// and the floor charges up to 0.7 (speedFloor.ts).

import { normalizeRookieName } from "../helpers/formatting";
import type { FortySource } from "../types";
import { FORTY_MAX, FORTY_MIN, FORTY_WEIGHT_MAX, FORTY_WEIGHT_MIN } from "./speedFloor";

export const FORTY_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type FortyPos = (typeof FORTY_POSITIONS)[number];
export const isFortyPos = (s: string): s is FortyPos => (FORTY_POSITIONS as readonly string[]).includes(s);

/** forty_projected_from for WalterFootball's numbers. */
export const PROJECTED_FROM = "WalterFootball";

/** One player's 40 from a source. */
export interface FortyRow {
  name: string;
  school: string | null;
  position: FortyPos;
  forty: number;
  /** The combine's weigh-in, or the weight the site lists; null when none. */
  weight: number | null;
}

/** POST /api/scouting/forty-times's answer, for one class year and position. */
export interface FortyTimesResponse {
  year: number;
  position: FortyPos;
  /** The combine's 40s; null when that year's combine isn't in the data yet. */
  combine: FortyRow[] | null;
  combineError?: string;
  projected: FortyRow[];
  projectedError?: string;
}

// ── Reading the sources ─────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const text = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function fortyOf(raw: string | undefined): number | null {
  if (!raw || !/^\d\.\d{1,2}$/.test(raw.trim())) return null;
  const v = Math.round(Number(raw) * 100) / 100;
  return v >= FORTY_MIN && v <= FORTY_MAX ? v : null;
}

function weightOf(raw: string | undefined): number | null {
  const v = Number((raw ?? "").replace(/lbs?$/i, "").trim());
  return Number.isInteger(v) && v >= FORTY_WEIGHT_MIN && v <= FORTY_WEIGHT_MAX ? v : null;
}

/**
 * One WalterFootball rankings page (/RBRankings2027.php): a panel per ranked
 * prospect (id="prpSlot_N") whose heading reads "Jadan Baugh*, RB, Florida
 * Height: 6-0. Weight: 228. Projected 40 Time: 4.50. …" (the * marks an
 * underclassman; the name is a scouting-report link or plain text). Players
 * listed without a projected 40 are left out.
 */
export function parseWalterFootballPage(html: string, position: FortyPos): FortyRow[] {
  const rows: FortyRow[] = [];
  for (const chunk of html.split(/id="prpSlot_\d+"/).slice(1)) {
    const heading = text(/<b>([\s\S]*?)<\/b>/.exec(chunk)?.[1] ?? "");
    const who = /^(.+?)\s*\**\s*,\s*([A-Z0-9/-]+)\s*,\s*(.+?)\s+Height:/.exec(heading);
    const forty = fortyOf(/Projected 40 Time:\s*(\d\.\d{1,2})/.exec(heading)?.[1]);
    if (!who || forty == null) continue;
    rows.push({
      name: who[1].replace(/\*+$/, "").trim(), school: who[3].trim() || null, position, forty,
      weight: weightOf(/Weight:\s*(\d+)/.exec(heading)?.[1]),
    });
  }
  return rows;
}

/** One CSV line's fields ("a","b, c",d → a | b, c | d). */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === "\"" && line[i + 1] === "\"") { cur += "\""; i++; }
      else if (c === "\"") quoted = false;
      else cur += c;
    } else if (c === "\"") quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * nflverse's combine.csv for one draft year: QB / RB / WR / TE who ran a 40,
 * with the weigh-in. `inYear` counts every player of that year, so 0 means the
 * year's combine isn't in the file yet.
 */
export function parseCombineCsv(csv: string, year: number): { rows: FortyRow[]; inYear: number } {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
  const head = csvFields(lines[0] ?? "");
  const col = (k: string) => head.indexOf(k);
  const [iSeason, iName, iPos, iSchool, iWt, iForty] = ["season", "player_name", "pos", "school", "wt", "forty"].map(col);
  if ([iSeason, iName, iPos, iForty].some((i) => i < 0)) throw new Error("combine.csv: missing a season / player_name / pos / forty column");
  const rows: FortyRow[] = [];
  let inYear = 0;
  for (const line of lines.slice(1)) {
    const f = csvFields(line);
    if (Number(f[iSeason]) !== year) continue;
    inYear++;
    const pos = (f[iPos] ?? "").trim().toUpperCase();
    const forty = fortyOf(f[iForty]);
    if (!isFortyPos(pos) || forty == null) continue;
    rows.push({
      name: f[iName].trim(), school: iSchool >= 0 ? f[iSchool].trim() || null : null,
      position: pos, forty, weight: iWt >= 0 ? weightOf(f[iWt]) : null,
    });
  }
  return { rows, inYear };
}

// ── Matching ────────────────────────────────────────────────────────────────

// The few schools the sources spell differently from each other in ways the
// "St." → "State" rule doesn't catch.
const SCHOOL_ALIASES: Record<string, string> = {
  olemiss: "mississippi", pitt: "pittsburgh", usc: "southerncalifornia", lsu: "louisianastate",
  ucf: "centralflorida", smu: "southernmethodist", tcu: "texaschristian", byu: "brighamyoung",
  fau: "floridaatlantic", fiu: "floridainternational", utsa: "texassanantonio", unlv: "nevadalasvegas",
  uconn: "connecticut", umass: "massachusetts", miamifl: "miami",
};

/** A school name reduced for comparing: "Penn St." and "Penn State" match, as do "Ole Miss" and "Mississippi". */
export function schoolKey(school: string): string {
  const t = school.toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\((fl|fla|florida)\)/g, "fl")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bst\b\.?/g, "state")
    .replace(/\buniversity( of)?\b|\buniv\b\.?/g, " ")
    .replace(/[^a-z0-9]/g, "");
  return SCHOOL_ALIASES[t] ?? t;
}

/** Same school, or one side doesn't say. Exact keys only: "Texas" and "Texas State" are different schools. */
export function sameSchool(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true; // nothing to disagree on
  return schoolKey(a) === schoolKey(b);
}

export interface FortyProspect {
  id: string;
  name: string;
  school: string | null;
  position: string;
  draft_class_year: number | null;
}

export interface FortyMatch { row: FortyRow; schoolDiffers: boolean }

/**
 * Each prospect's row by name (suffixes and punctuation dropped,
 * normalizeRookieName), at his position, for prospects in `year`'s class. Two
 * rows with his name: the one from his school, else none. A row goes to one
 * prospect at most; two prospects claiming it get neither.
 */
export function matchFortyRows(
  prospects: readonly FortyProspect[], rows: readonly FortyRow[], year: number,
): Map<string, FortyMatch> {
  const byName = new Map<string, FortyRow[]>();
  for (const r of rows) {
    const k = `${r.position}|${normalizeRookieName(r.name)}`;
    byName.set(k, [...(byName.get(k) ?? []), r]);
  }
  const found = new Map<string, FortyMatch>();
  const claims = new Map<FortyRow, string[]>();
  for (const p of prospects) {
    if (p.draft_class_year !== year || !isFortyPos(p.position)) continue;
    let cands = byName.get(`${p.position}|${normalizeRookieName(p.name)}`) ?? [];
    if (cands.length > 1 && p.school) cands = cands.filter((r) => r.school && sameSchool(r.school, p.school));
    if (cands.length !== 1) continue;
    const row = cands[0];
    claims.set(row, [...(claims.get(row) ?? []), p.id]);
    found.set(p.id, { row, schoolDiffers: !sameSchool(row.school, p.school) });
  }
  for (const ids of claims.values()) if (ids.length > 1) for (const id of ids) found.delete(id);
  return found;
}

// ── The changes to review ───────────────────────────────────────────────────

export interface FortyFillProspect extends FortyProspect {
  forty_time?: number | null;
  forty_source?: FortySource | null;
  forty_weight?: number | null;
  forty_projected?: number | null;
  forty_projected_from?: string | null;
}

export interface FortyChange {
  key: string;
  prospectId: string;
  name: string;
  kind: "combine" | "projected";
  /** What's on file now, for the review line. */
  from: string;
  /** What's saved: the time and, for the combine, the weigh-in. */
  time: number;
  weight: number | null;
  /** Ticked to start with. */
  on: boolean;
  /** Why it's unticked, or anything to check. */
  note?: string;
}

const num = (v: number | string | null | undefined) => (v == null ? null : Number(v));

function currentText(p: FortyFillProspect): string {
  const t = num(p.forty_time);
  if (t == null) return "blank";
  const w = num(p.forty_weight);
  return `${t.toFixed(2)}${p.forty_source === "pro_day" ? " pro day" : " combine"}${w != null ? ` at ${w} lb` : ""}`;
}

/**
 * What saving would change. Combine: a time where there's none or only a pro
 * day (the combine's laser time wins over a hand-timed one), the weigh-in
 * where it's missing; a combine time that disagrees with one you typed stays
 * unticked. Projected: only for prospects with no real 40 (nor one coming in
 * this run), when it's new or moved. A row from a different school stays
 * unticked.
 */
export function fortyChanges(
  prospects: readonly FortyFillProspect[],
  combine: ReadonlyMap<string, FortyMatch>,
  projected: ReadonlyMap<string, FortyMatch>,
): FortyChange[] {
  const out: FortyChange[] = [];
  for (const p of prospects) {
    const time = num(p.forty_time);
    const weighIn = num(p.forty_weight);
    const c = combine.get(p.id);
    if (c) {
      const sameTime = time === c.row.forty && p.forty_source !== "pro_day";
      const weightOk = c.row.weight == null || weighIn === c.row.weight;
      if (!(sameTime && weightOk)) {
        const typedDiffers = time != null && p.forty_source !== "pro_day" && time !== c.row.forty;
        const notes = [
          c.schoolDiffers ? `the combine lists him at ${c.row.school}` : null,
          typedDiffers ? "differs from the combine time you have" : null,
        ].filter((x): x is string => x != null);
        out.push({
          key: `${p.id}|combine`, prospectId: p.id, name: p.name, kind: "combine", from: currentText(p),
          time: c.row.forty, weight: c.row.weight ?? weighIn, on: !c.schoolDiffers && !typedDiffers,
          ...(notes.length ? { note: notes.join("; ") } : {}),
        });
      }
      continue;
    }
    const pr = projected.get(p.id);
    if (!pr || time != null) continue;
    if (num(p.forty_projected) === pr.row.forty && p.forty_projected_from === PROJECTED_FROM) continue;
    const had = num(p.forty_projected);
    out.push({
      key: `${p.id}|projected`, prospectId: p.id, name: p.name, kind: "projected",
      from: had != null ? `~${had.toFixed(2)} projected` : "blank",
      time: pr.row.forty, weight: null, on: !pr.schoolDiffers,
      ...(pr.schoolDiffers ? { note: `${PROJECTED_FROM} lists him at ${pr.row.school}` } : {}),
    });
  }
  return out;
}

export type FortyPatch = Partial<Pick<FortyFillProspect, "forty_time" | "forty_source" | "forty_weight" | "forty_projected" | "forty_projected_from">>;

/** The update per prospect for the ticked changes. */
export function fortyPatches(changes: readonly FortyChange[]): Map<string, FortyPatch> {
  const out = new Map<string, FortyPatch>();
  for (const c of changes) {
    const patch: FortyPatch = c.kind === "combine"
      ? { forty_time: c.time, forty_source: "combine", ...(c.weight != null ? { forty_weight: c.weight } : {}) }
      : { forty_projected: c.time, forty_projected_from: PROJECTED_FROM };
    out.set(c.prospectId, { ...(out.get(c.prospectId) ?? {}), ...patch });
  }
  return out;
}
