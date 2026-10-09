// ============================================================
// The Draft Hub's rookie board, built from the user's Scouting prospects.
// ============================================================
// Draft board sync, Stage 3 (the user's rules, 2026-10-09):
//   - The order is the Scouting Big Board's OVR (prospects.overall_rank) for
//     the class, and nothing else: no dragging or typed ranks here.
//   - Ranked prospects first; unranked always below, by Dynasty Score, then name.
//   - Dynasty, Dynasty+ and the sample dot are the scores saved on the last Big
//     Board visit (prospects.board_scores, lib/scouting/boardScores.ts). The
//     board never computes them.
//   - FC value is FantasyCalc's, matched by name until the Sleeper link
//     (Stage 5), and only against FantasyCalc's rookies of the board's class
//     (fcClassValues), so a prospect never takes a same-named veteran's value.
// ============================================================

import { normalizeRookieName } from "./formatting";
import { nflDraftSlotLabel } from "../draftRound";
import type { BoardScores, Prospect } from "../types";

export const DRAFT_BOARD_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

/** The prospect columns the board reads. */
export const DRAFT_BOARD_COLUMNS =
  "id,name,position,school,draft_class_year,overall_rank,draft_round,draft_pick,draft_team,board_scores";

export type DraftBoardProspect =
  Pick<Prospect, "id" | "name" | "position" | "school" | "draft_class_year" | "overall_rank" | "draft_round" | "draft_pick" | "draft_team">
  & { board_scores?: BoardScores | null };

const byName = (a: DraftBoardProspect, b: DraftBoardProspect) =>
  a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** The board's order: OVR first (ties by name), then the unranked by Dynasty Score (none last), then name. */
export function sortDraftBoard<T extends DraftBoardProspect>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const ra = a.overall_rank, rb = b.overall_rank;
    if (ra != null && rb != null) return ra - rb || byName(a, b);
    if (ra != null) return -1;
    if (rb != null) return 1;
    const da = a.board_scores?.dynasty ?? null, db = b.board_scores?.dynasty ?? null;
    if (da != null && db != null && da !== db) return db - da;
    if (da != null && db == null) return -1;
    if (db != null && da == null) return 1;
    return byName(a, b);
  });
}

/** "NYJ · R1 · #3" once he's drafted (an NFL team is set), else null. */
export function nflDraftLabel(p: Pick<DraftBoardProspect, "draft_team" | "draft_round" | "draft_pick">): string | null {
  if (!p.draft_team) return null;
  return nflDraftSlotLabel({ team: p.draft_team, round: p.draft_round, pick: p.draft_pick });
}

/** The newest saved_at among the rows' saved scores, or null. */
export function latestScoresSavedAt(rows: readonly DraftBoardProspect[]): string | null {
  let latest: string | null = null;
  for (const p of rows) {
    const at = p.board_scores?.saved_at;
    if (at && (latest == null || at > latest)) latest = at;
  }
  return latest;
}

// ── FantasyCalc ─────────────────────────────────────────────

export interface FcClassEntry {
  value: number;
  position: string;
}

interface FcRawEntry {
  value?: unknown;
  player?: {
    name?: string;
    firstName?: string;
    lastName?: string;
    position?: string;
    maybeYoe?: number | null;
    maybeTeam?: string | null;
    maybeDraftInfo?: { year?: number | null } | null;
  };
}

/**
 * FantasyCalc's players who can be in class `classYear`, by normalized name:
 * drafted that year, or not drafted yet (no draft info, no NFL experience and
 * no team). That leaves out veterans, whose names prospects share (T.J. Moore
 * would otherwise take DJ Moore's value), and last class's undrafted rookies
 * once they've signed. The cost: this class's undrafted rookies drop out once
 * they sign, until the Sleeper link.
 */
export function fcClassValues(fcRaw: readonly unknown[], classYear: number): Map<string, FcClassEntry> {
  const out = new Map<string, FcClassEntry>();
  for (const raw of fcRaw) {
    const { value, player } = (raw ?? {}) as FcRawEntry;
    if (!player || player.position === "PICK" || typeof value !== "number" || value <= 0) continue;
    const draftYear = player.maybeDraftInfo?.year;
    const team = (player.maybeTeam ?? "").trim().toUpperCase();
    const eligible = typeof draftYear === "number"
      ? draftYear === classYear
      : !player.maybeYoe && (team === "" || team === "FA");
    if (!eligible) continue;
    const name = player.name || `${player.firstName ?? ""} ${player.lastName ?? ""}`.trim();
    const key = normalizeRookieName(name);
    // FantasyCalc lists by value, so a repeated name keeps the higher one.
    if (key && !out.has(key)) out.set(key, { value, position: player.position ?? "" });
  }
  return out;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

/**
 * A prospect's FC value from fcClassValues, or 0. An exact name counts at any
 * position; a near miss (1 letter off, 2 for long names) only at his own.
 */
export function fcValueFor(name: string, position: string, fc: ReadonlyMap<string, FcClassEntry>): number {
  const norm = normalizeRookieName(name);
  if (!norm) return 0;
  const exact = fc.get(norm);
  if (exact) return exact.value;
  const maxDist = norm.length <= 12 ? 1 : 2;
  let best = 0, bestDist = Infinity;
  for (const [key, e] of fc) {
    if (e.position !== position || Math.abs(key.length - norm.length) > maxDist) continue;
    const d = levenshtein(norm, key);
    if (d <= maxDist && d < bestDist) { bestDist = d; best = e.value; }
  }
  return best;
}

// ── Snapshots ───────────────────────────────────────────────

/** One row of a saved board (big_board_snapshots.snapshot_data). */
export interface DraftBoardSnapshotRow {
  prospect_id: string;
  /** Sleeper id: none until the Sleeper link (Stage 5). */
  player_id: null;
  name: string;
  position: string;
  school: string | null;
  /** NFL team, once drafted. */
  team: string | null;
  /** Place on the board, 1..N. */
  rank: number;
  ovr: number | null;
  tier: number | null;
  fc_value: number;
  dynasty: number | null;
  plus: number | null;
  nfl_draft: { team: string; round: number | null; pick: number | null } | null;
}

/** The board as a snapshot, in board order. */
export function draftBoardSnapshotRows(
  board: readonly DraftBoardProspect[],
  tiers: Readonly<Record<string, number>>,
  fcFor: (p: DraftBoardProspect) => number,
): DraftBoardSnapshotRow[] {
  return board.map((p, i) => ({
    prospect_id: p.id,
    player_id: null,
    name: p.name,
    position: p.position,
    school: p.school || null,
    team: p.draft_team || null,
    rank: i + 1,
    ovr: p.overall_rank,
    tier: tiers[p.id] ?? null,
    fc_value: fcFor(p),
    dynasty: p.board_scores?.dynasty ?? null,
    plus: p.board_scores?.plus ?? null,
    nfl_draft: p.draft_team || p.draft_round != null || p.draft_pick != null
      ? { team: p.draft_team ?? "", round: p.draft_round, pick: p.draft_pick }
      : null,
  }));
}

// ── Tiers and notes (rookie_board_tiers, keyed by prospect id) ──

/** A stored tiers map, keeping only whole-number tiers. */
export function readTiers(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) if (typeof v === "number" && Number.isInteger(v) && v > 0) out[k] = v;
  return out;
}

/** A stored notes map, keeping only non-empty text. */
export function readNotes(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string" && v.trim()) out[k] = v;
  return out;
}
