// A shared Big Board (/board/{token}, migration 105): one draft class's All
// board as the owner's Big Board shows it, for anyone with the link.
//
// The user (2026-11-25): "make my big board sharable ... like how i have my
// rosters as sharable ... per year so either 2027 or 2028 or 2029 etc and
// always full board not positional", with the columns from their screenshot
// (OVR, Smp, Name, Charted, Pre / Post, PosRk, Identity), plus "a % value for
// each player on how much of there sample they reached ... Just so an outside
// viewer understands its not complete".
//
// A snapshot: the Big Board builds the rows from the values on its own screen
// (sample dot, charted counts, the Pre grade that mirrors Dynasty, age) and
// saves them whenever it is open and they changed. The public page only reads
// them, so the two always match. Nothing personal goes in: no notes, tags,
// scores or prospect ids.
//
// Redacted (prospects.share_redacted, the user's call the same day: "hide who
// he is"): the row keeps its rank, sample, charted counts, grades, position
// rank and position, but reads "Redacted" with no school, age, height or
// weight. It's blanked here, before the save, so the real name is never in
// the shared rows.
//
// Pure and light on purpose: the public page imports it, so it must not pull in
// the scoring code.

import type { ProspectWithStats } from "../types";
import type { ChartedCounts } from "./chartedCounts";
import type { ProspectAge } from "./prospectAge";
import type { SampleSize } from "./sampleSize";
import type { SamplePlays } from "./aggregateMerge";
import { SAMPLE_FULL_PLAYS, SAMPLE_TIERS, samplePct, sampleTier, type SampleTier } from "./sampleTiers";

/** What a full sample counts, per position (the plays each sample dot reads). */
export const SHARED_SAMPLE_UNIT: Record<"QB" | "RB" | "WR" | "TE", string> = {
  QB: "throws", RB: "runs", WR: "routes", TE: "routes",
};

export interface SharedBoardSample {
  /** Plays charted toward the full sample. */
  n: number;
  /** A full sample at his position, when the snapshot was taken. */
  full: number;
  /** Whole percent of full, rounded down, capped at 100 (samplePct). */
  pct: number;
  tier: SampleTier;
}

export interface SharedBoardRow {
  /** Hidden on the link (prospects.share_redacted): name "Redacted", identity blank. */
  redacted: boolean;
  /** OVR rank; null = unranked. */
  ovr: number | null;
  /** Rank within his position; null = unranked. */
  posRank: number | null;
  name: string;
  pos: string;
  school: string;
  /** Whole years today; null when unknown. */
  age: number | null;
  /** The age is estimated from his high-school class, not a birthday. */
  ageEst: boolean;
  ht: string | null;
  wt: number | null;
  /** Pre-draft grade as the board shows it (the Dynasty mirror where there is one). */
  pre: number | null;
  post: number | null;
  /** Charted games / snaps / throws-runs-routes; null for a position without them. */
  games: number | null;
  snaps: number | null;
  plays: number | null;
  /** How much of a full sample is charted; null for a position without one. */
  sample: SharedBoardSample | null;
}

/** The Big Board values a shared row is built from (BigBoard.tsx). */
export interface SharedBoardInputs {
  /** The sample dots (sampleSize.ts). */
  samples: ReadonlyMap<string, SampleSize>;
  /** Exact QB / RB / TE sample plays (prospect_sample_counts, migration 102):
   *  the count for a player under the dot's sample floor, where the dot has none. */
  samplePlays?: ReadonlyMap<string, SamplePlays>;
  /** Charted counts (chartedCounts.ts). */
  counts: ReadonlyMap<string, ChartedCounts>;
  /** Pre grades that mirror the Dynasty Score (preGradeMirror.ts). */
  preGrades: ReadonlyMap<string, number>;
  /** Age today (useProspectScores). */
  ages: ReadonlyMap<string, ProspectAge>;
}

/** Plays charted toward his full sample: the dot's count, or under its floor
 *  (where the dot reads none) the exact count of the same plays. */
function sampleCount(p: ProspectWithStats, s: SampleSize, samplePlays?: ReadonlyMap<string, SamplePlays>): number {
  if (s.n != null) return s.n;
  // A WR's SAE sample is every route he ran (checked 2026-10-09).
  if (p.position === "WR") return p.total_routes ?? 0;
  const pos = p.position as "QB" | "RB" | "TE";
  return samplePlays?.get(p.id)?.[pos] ?? 0;
}

/**
 * One class's All board: every prospect in `year`, in OVR order with the
 * unranked after, in the order they come (as the Big Board's All tab sorts).
 */
/** What a Redacted row reads in place of his name. */
export const REDACTED_NAME = "Redacted";

export function buildSharedBoardRows(
  prospects: readonly ProspectWithStats[],
  year: number,
  inputs: SharedBoardInputs,
): SharedBoardRow[] {
  const inClass = prospects.filter((p) => p.draft_class_year === year);
  const ordered = inClass
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (a.p.overall_rank ?? Infinity) - (b.p.overall_rank ?? Infinity) || a.i - b.i)
    .map(({ p }) => p);
  return ordered.map((p) => {
    const s = inputs.samples.get(p.id);
    let sample: SharedBoardSample | null = null;
    if (s) {
      const n = sampleCount(p, s, inputs.samplePlays);
      sample = { n, full: s.full, pct: samplePct(n, s.full), tier: s.n != null ? s.tier : sampleTier(n, s.full) };
    }
    const c = inputs.counts.get(p.id);
    const age = inputs.ages.get(p.id);
    const shown: SharedBoardRow = {
      redacted: false,
      ovr: p.overall_rank ?? null,
      posRank: p.personal_rank ?? null,
      name: p.name,
      pos: p.position,
      school: p.school ?? "",
      age: age ? Math.floor(age.years) : null,
      ageEst: age?.estimated ?? false,
      ht: p.height || null,
      wt: p.weight ?? null,
      pre: inputs.preGrades.get(p.id) ?? p.pre_draft_grade ?? null,
      post: p.post_draft_grade ?? null,
      games: c?.games ?? null,
      snaps: c?.snaps ?? null,
      plays: c?.plays ?? null,
      sample,
    };
    return p.share_redacted ? redact(shown) : shown;
  });
}

/** A row with who he is taken out: rank, sample, counts, grades and position stay. */
function redact(r: SharedBoardRow): SharedBoardRow {
  return { ...r, redacted: true, name: REDACTED_NAME, school: "", age: null, ageEst: false, ht: null, wt: null };
}

/** What a save compares, field by field (jsonb doesn't keep key order). */
export function sharedBoardKey(rows: readonly SharedBoardRow[]): string {
  return JSON.stringify(rows.map((r) => [
    r.redacted, r.ovr, r.posRank, r.name, r.pos, r.school, r.age, r.ageEst, r.ht, r.wt, r.pre, r.post,
    r.games, r.snaps, r.plays, r.sample?.n ?? null, r.sample?.full ?? null, r.sample?.pct ?? null, r.sample?.tier ?? null,
  ]));
}

const TIERS = new Set<string>(SAMPLE_TIERS.map((t) => t.tier));

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown, max: number): string | null => (typeof v === "string" ? v.slice(0, max) : null);

function parseSample(v: unknown): SharedBoardSample | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const n = num(o.n);
  const full = num(o.full);
  const pct = num(o.pct);
  if (n == null || full == null || pct == null || typeof o.tier !== "string" || !TIERS.has(o.tier)) return null;
  return { n, full, pct: Math.max(0, Math.min(100, pct)), tier: o.tier as SampleTier };
}

/** Saved rows back from the database, each field checked; a row without a name is dropped. */
export function parseSharedBoardRows(raw: unknown): SharedBoardRow[] {
  if (!Array.isArray(raw)) return [];
  const out: SharedBoardRow[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const name = text(o.name, 120);
    if (!name) continue;
    const row: SharedBoardRow = {
      redacted: false,
      ovr: num(o.ovr),
      posRank: num(o.posRank),
      name,
      pos: text(o.pos, 8) ?? "",
      school: text(o.school, 120) ?? "",
      age: num(o.age),
      ageEst: o.ageEst === true,
      ht: text(o.ht, 16) || null,
      wt: num(o.wt),
      pre: num(o.pre),
      post: num(o.post),
      games: num(o.games),
      snaps: num(o.snaps),
      plays: num(o.plays),
      sample: parseSample(o.sample),
    };
    out.push(o.redacted === true ? redact(row) : row);
  }
  return out;
}

/** Each position's full sample as the rows have it (the constants when no row says). */
export function sharedFullSamples(rows: readonly SharedBoardRow[]): Record<"QB" | "RB" | "WR" | "TE", number> {
  const out = { ...SAMPLE_FULL_PLAYS };
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.sample || seen.has(r.pos) || !(r.pos in out)) continue;
    out[r.pos as keyof typeof out] = r.sample.full;
    seen.add(r.pos);
  }
  return out;
}

/** A shared board as the public page reads it. */
export interface SharedBoard {
  classYear: number;
  rows: SharedBoardRow[];
  updatedAt: string;
}

export type SharedBoardResult =
  | { status: "ready"; board: SharedBoard }
  | { status: "missing" }
  | { status: "error" };

/** A link token (migration 105): 32 lowercase hex characters. */
export const SHARE_TOKEN_RE = /^[0-9a-f]{32}$/;

/** One class's share as the owner's hub holds it. */
export interface BoardShare {
  classYear: number;
  token: string;
  rows: SharedBoardRow[];
  updatedAt: string;
}

export const boardSharePath = (token: string) => `/board/${token}`;
