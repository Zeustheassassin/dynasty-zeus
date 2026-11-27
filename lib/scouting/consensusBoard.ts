// ============================================================
// Consensus big board (stage 6 of the 2026-11-26 scouting plan, migration 109)
// ============================================================
// The user uploads a consensus big board CSV for one draft class (rank,
// player name, position, college: the same source as the 2026-11-05 file)
// on the Due now reminder (every 30 days, or at declarations / the Senior
// Bowl / the combine / the week before the draft). Each matched QB / RB / WR
// / TE keeps his rank; until his real pick is applied, Dynasty+ reads it as
// a projected pick (dynastyScore.ts projectedCapital: capital only, averaged
// over the picks within 25% of the rank, undrafted past pick 257). Those it
// doesn't name show "not on consensus" and no Dynasty+.
//
// A save replaces the class's consensus: every skill prospect in it gets his
// rank or null, and the class and time of the upload (save_prospect_consensus).
// A prospect moved to another class since stops reading it (consensus_class).
//
// Matching, reviewed before anything saves (the 11/5 dedupe rules):
//   1. by name at his position in the class (normalizeRookieName drops case,
//      periods, apostrophes incl. curly ones, hyphens and Jr / Sr / II–V;
//      fortyFill.ts matchFortyRows), two rows of his name settled by school;
//      ticked, or unticked when the schools differ (a transfer, or someone
//      else);
//   2. by name and school at another skill position: unticked;
//   3. by last name, position and school with another first name (a
//      nickname: "Boobie" / "Ethan" Feaster): unticked.
// A row two prospects claim goes to neither. Rows naming a prospect in
// another class are listed, not saved (the user moves him first).
// Pure.
// ============================================================

import { normalizeRookieName } from "../helpers/formatting";
import { csvFields, isFortyPos, matchFortyRows, schoolKey, type FortyPos } from "./fortyFill";
import { LAST_PICK, projectedCapital, projectedPickWindow } from "./dynastyScore";

export interface ConsensusRow {
  rank: number;
  name: string;
  /** As the list has it, upper case ("EDGE", "WR"). */
  position: string;
  school: string | null;
}

// ── The CSV ─────────────────────────────────────────────────────────────────

const COLUMN_PATTERNS = {
  rank: /^(rank|rk|#|overall|ovr)$/,
  name: /(^name$|player)/,
  position: /^(pos|position)$/,
  school: /(college|school|team)/,
} as const;

/**
 * A consensus big board CSV: a header row naming rank, player name, position
 * and college / school (any order), then one player per line. Lines without a
 * whole-number rank or a name are skipped and counted. Throws when the header
 * lacks a rank, name or position column.
 */
export function parseConsensusCsv(text: string): { rows: ConsensusRow[]; skipped: number } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const head = csvFields(lines[0] ?? "").map((h) => h.trim().toLowerCase());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const iRank = col(COLUMN_PATTERNS.rank);
  const iName = col(COLUMN_PATTERNS.name);
  const iPos = col(COLUMN_PATTERNS.position);
  const iSchool = col(COLUMN_PATTERNS.school);
  if (iRank < 0 || iName < 0 || iPos < 0) {
    throw new Error("The first line should name the columns: Rank, Player Name, Position, College.");
  }
  const rows: ConsensusRow[] = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const f = csvFields(line);
    const rank = Number((f[iRank] ?? "").trim());
    const name = (f[iName] ?? "").trim();
    if (!Number.isInteger(rank) || rank < 1 || !name) { skipped++; continue; }
    rows.push({
      rank, name,
      position: (f[iPos] ?? "").trim().toUpperCase(),
      school: iSchool >= 0 ? (f[iSchool] ?? "").trim() || null : null,
    });
  }
  return { rows, skipped };
}

/** The board's position a list's position stands for: QB, RB (HB, FB), WR, TE; null for the rest. */
export function skillPosition(pos: string): FortyPos | null {
  const p = pos.trim().toUpperCase();
  if (p === "HB" || p === "FB") return "RB";
  return isFortyPos(p) ? p : null;
}

/** The draft class a file's name says ("consensus-big-board-2027-20261127.csv" → 2027), when it's one of `years`. */
export function classFromFileName(fileName: string, years: readonly number[]): number | null {
  for (const m of fileName.matchAll(/(?<!\d)(20[2-4]\d)(?!\d)/g)) {
    const y = Number(m[1]);
    if (years.includes(y)) return y;
  }
  return null;
}

// ── Matching ────────────────────────────────────────────────────────────────

export interface ConsensusProspect {
  id: string;
  name: string;
  position: string;
  school: string | null;
  draft_class_year: number | null;
  draft_round?: number | null;
  consensus_rank?: number | null;
  consensus_class?: number | null;
  consensus_at?: string | null;
}

export type ConsensusHow = "name" | "school_differs" | "other_position" | "name_differs";

export interface ConsensusMatch {
  prospectId: string;
  name: string;
  position: string;
  school: string | null;
  row: ConsensusRow;
  how: ConsensusHow;
  /** Ticked to save: his name at his position, the schools agreeing (or one blank). */
  on: boolean;
  /** Why it comes in unticked. */
  note?: string;
  /** His rank on the class's last upload, if he had one. */
  was: number | null;
  /** His round is set: the rank is saved but Dynasty+ keeps reading his real pick. */
  drafted: boolean;
}

export interface ConsensusReview {
  year: number;
  /** Rows read, every position. */
  rows: number;
  /** QB / RB / WR / TE rows. */
  skillRows: number;
  /** By consensus rank. */
  matches: ConsensusMatch[];
  /** The class's skill prospects no row names: "not on consensus" once saved. */
  missing: { id: string; name: string; position: string; school: string | null; was: number | null }[];
  /** Skill rows naming no one on the board, by rank. */
  unmatched: ConsensusRow[];
  /** Skill rows naming a prospect in another class: listed, not saved. */
  otherClass: { row: ConsensusRow; prospectId: string; name: string; classYear: number }[];
  /** Prospects whose name the list has at his position but couldn't be settled (two rows, or a row two prospects share). */
  unsettled: { id: string; name: string; position: string }[];
}

interface NamedConsensusRow { name: string; school: string | null; position: FortyPos; row: ConsensusRow }

const SUFFIX = /\b(jr|sr|ii|iii|iv|v)\b\.?/g;
/** "Ellis Robinson IV" → "robinson": the last word once suffixes and punctuation are out. */
function lastName(name: string): string {
  const words = name.toLowerCase().replace(SUFFIX, " ").replace(/[^a-z\s]+/g, "").trim().split(/\s+/);
  return words[words.length - 1] ?? "";
}

const sameSchoolKnown = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && schoolKey(a) === schoolKey(b);

/** His rank on the class's last upload, read only while the upload was for his class. */
export function consensusRankOf(p: Pick<ConsensusProspect, "draft_class_year" | "consensus_rank" | "consensus_class">): number | null {
  const r = p.consensus_rank;
  return p.consensus_class != null && p.consensus_class === p.draft_class_year && r != null && Number.isInteger(r) && r >= 1 ? r : null;
}

/** Every QB / RB / WR / TE in `year`'s class matched to the list, with what's left over on each side. */
export function reviewConsensus(
  rows: readonly ConsensusRow[], prospects: readonly ConsensusProspect[], year: number,
): ConsensusReview {
  const skill: NamedConsensusRow[] = [];
  for (const r of rows) {
    const pos = skillPosition(r.position);
    if (pos) skill.push({ name: r.name, school: r.school, position: pos, row: r });
  }
  const pool = prospects.filter((p) => p.draft_class_year === year && isFortyPos(p.position));
  const was = (p: ConsensusProspect) => consensusRankOf(p);
  const drafted = (p: ConsensusProspect) => p.draft_round != null;

  const matches = new Map<string, ConsensusMatch>();
  const used = new Set<NamedConsensusRow>();
  const add = (p: ConsensusProspect, r: NamedConsensusRow, how: ConsensusHow, note?: string) => {
    matches.set(p.id, {
      prospectId: p.id, name: p.name, position: p.position, school: p.school, row: r.row, how,
      on: how === "name", was: was(p), drafted: drafted(p), ...(note ? { note } : {}),
    });
    used.add(r);
  };

  const namePos = (x: { position: string; name: string }) => `${x.position}|${normalizeRookieName(x.name)}`;

  // 1. Name at his position.
  const byId = new Map(pool.map((p) => [p.id, p]));
  for (const [id, m] of matchFortyRows<NamedConsensusRow>(pool, skill, year)) {
    const p = byId.get(id)!;
    if (m.schoolDiffers) add(p, m.row, "school_differs", `the list has him at ${m.row.school}`);
    else add(p, m.row, "name");
  }

  // Whom the list names at his position but pass 1 couldn't settle (two rows of
  // his name, or a row two prospects share): left for the user, not guessed at.
  const rowKeys = new Set(skill.map(namePos));
  const unsettled = pool.filter((p) => !matches.has(p.id) && rowKeys.has(namePos(p)))
    .map((p) => ({ id: p.id, name: p.name, position: p.position }));
  const unsettledKeys = new Set(unsettled.map(namePos));

  // 2. Name and school at another skill position; 3. last name, position and
  // school. Each takes an open row and closes it, so no row goes to two.
  for (const p of pool) {
    if (matches.has(p.id) || unsettledKeys.has(namePos(p))) continue;
    const open = skill.filter((r) => !used.has(r));
    const key = normalizeRookieName(p.name);
    const other = open.filter((r) => r.position !== p.position && normalizeRookieName(r.name) === key && sameSchoolKnown(r.school, p.school));
    if (other.length === 1) { add(p, other[0], "other_position", `the list has him at ${other[0].row.position}`); continue; }
    const last = lastName(p.name);
    const near = last ? open.filter((r) => r.position === p.position && normalizeRookieName(r.name) !== key
      && lastName(r.name) === last && sameSchoolKnown(r.school, p.school)) : [];
    if (near.length === 1) add(p, near[0], "name_differs", `the list says ${near[0].name}`);
  }

  // Rows left: someone in another class, or no one on the board.
  const otherByNamePos = new Map<string, ConsensusProspect[]>();
  for (const p of prospects) {
    if (p.draft_class_year === year || !isFortyPos(p.position)) continue;
    otherByNamePos.set(namePos(p), [...(otherByNamePos.get(namePos(p)) ?? []), p]);
  }
  const otherClass: ConsensusReview["otherClass"] = [];
  const unmatched: ConsensusRow[] = [];
  for (const r of skill) {
    if (used.has(r) || unsettledKeys.has(namePos(r))) continue; // matched, or shown under unsettled
    const elsewhere = otherByNamePos.get(namePos(r)) ?? [];
    if (elsewhere.length === 1 && elsewhere[0].draft_class_year != null) {
      otherClass.push({ row: r.row, prospectId: elsewhere[0].id, name: elsewhere[0].name, classYear: elsewhere[0].draft_class_year });
    } else {
      unmatched.push(r.row);
    }
  }

  const missing = pool.filter((p) => !matches.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, position: p.position, school: p.school, was: was(p) }));
  return {
    year,
    rows: rows.length,
    skillRows: skill.length,
    matches: [...matches.values()].sort((a, b) => a.row.rank - b.row.rank || a.name.localeCompare(b.name)),
    missing,
    unmatched: unmatched.sort((a, b) => a.rank - b.rank),
    otherClass: otherClass.sort((a, b) => a.row.rank - b.row.rank),
    unsettled,
  };
}

/** What save_prospect_consensus takes: { prospect id: rank } for the ticked matches. */
export function consensusSaveRanks(review: ConsensusReview, ticked: ReadonlySet<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of review.matches) if (ticked.has(m.prospectId)) out.set(m.prospectId, m.row.rank);
  return out;
}

/**
 * The class's skill prospects as the save leaves them (the RPC does the same
 * on the server): his rank or null, the class, the time.
 */
export function applyConsensusSave<P extends ConsensusProspect>(
  prospects: readonly P[], year: number, ranks: ReadonlyMap<string, number>, at: string,
): P[] {
  return prospects.map((p) => (p.draft_class_year === year && isFortyPos(p.position)
    ? { ...p, consensus_rank: ranks.get(p.id) ?? null, consensus_class: year, consensus_at: at }
    : p));
}

// ── On the board ────────────────────────────────────────────────────────────

/** Each class's last consensus upload (its newest consensus_at among prospects still in it). */
export function classConsensusAt(prospects: readonly ConsensusProspect[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const p of prospects) {
    if (p.consensus_at == null || p.consensus_class == null || p.consensus_class !== p.draft_class_year) continue;
    const cur = out.get(p.consensus_class);
    if (!cur || Date.parse(p.consensus_at) > Date.parse(cur)) out.set(p.consensus_class, p.consensus_at);
  }
  return out;
}

/** The newest consensus upload of any class, or null before the first (Due now's "last upload"). */
export function latestConsensusAt(prospects: readonly { consensus_at?: string | null }[]): string | null {
  let best: string | null = null;
  for (const p of prospects) {
    if (p.consensus_at && (!best || Date.parse(p.consensus_at) > Date.parse(best))) best = p.consensus_at;
  }
  return best;
}

export type ConsensusStatus =
  | { kind: "ranked"; rank: number; at: string | null }
  /** On his class's last upload's check, not on the list. */
  | { kind: "off"; at: string }
  /** His class has an upload, but he wasn't in the class then (added or moved since). */
  | { kind: "unchecked"; at: string };

/** Where he stands on his class's consensus board; null when his class has no upload yet. */
export function consensusStatus(p: ConsensusProspect, classAt: ReadonlyMap<number, string>): ConsensusStatus | null {
  const rank = consensusRankOf(p);
  if (rank != null) return { kind: "ranked", rank, at: p.consensus_at ?? null };
  const at = p.draft_class_year != null ? classAt.get(p.draft_class_year) : undefined;
  if (!at) return null;
  if (p.consensus_class === p.draft_class_year && p.consensus_at === at) return { kind: "off", at };
  return { kind: "unchecked", at };
}

/** "Nov 27, 2026" (local time). */
export function consensusDayText(at: string | null | undefined): string {
  const d = at ? new Date(at) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
}

/**
 * "consensus #40 (Nov 27, 2026), picks 30–50 averaged", plus the undrafted
 * stretch past LAST_PICK and the QB / RB scale.
 */
export function projectedCapitalLabel(rank: number, pos: string | null | undefined, at?: string | null): string {
  const { from, to } = projectedPickWindow(rank);
  const day = consensusDayText(at);
  const picks = from === to ? `pick ${from}` : `picks ${from}–${to} averaged`;
  const udfa = to <= LAST_PICK ? ""
    : from > LAST_PICK ? ", all past the last pick (undrafted)"
    : `, ${LAST_PICK + 1}–${to} as undrafted`;
  const scale = pos === "QB" ? ", on the QB scale" : pos === "RB" ? ", on the RB scale" : "";
  return `consensus #${rank}${day ? ` (${day})` : ""}, ${picks}${udfa}${scale}`;
}

/** Projected capital for a consensus rank (re-exported for the review panel). */
export { projectedCapital };

/** The Dynasty+ cell's tooltip when there's no projection: why not. */
export function notOnConsensusTitle(s: Exclude<ConsensusStatus, { kind: "ranked" }>, classYear: number | null): string {
  const day = consensusDayText(s.at);
  return s.kind === "off"
    ? `Not on the consensus big board of ${day}, so there's no projected pick: Dynasty+ shows once his real round is set.`
    : `Not checked against the consensus board: he joined the ${classYear ?? ""} class after the upload of ${day}. Re-upload it (Big Board → Consensus board) to place him.`;
}
