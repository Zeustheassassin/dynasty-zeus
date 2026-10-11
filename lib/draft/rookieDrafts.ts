// ============================================================
// Rookie drafts: which Sleeper drafts count, and the trimmed pick shape that is saved.
// ============================================================
// Pure — imported by the Draft History route, the consensus compile and the client. Saved picks
// (sleeper_draft_snapshots, migration 070) use the SavedDraftPick shape, a subset of Sleeper's own
// pick object, so code reading a saved draft and code reading a fresh one see the same fields.
// ============================================================

import { ROOKIE_DRAFT_MAX_ROUNDS } from "../helpers/season";

/** The parts of a Sleeper draft object these rules read. */
export interface RookieDraftLike {
  draft_id: string;
  season: string;
  status: string;
  settings?: { rounds?: number } | null;
  rounds?: number;
}

/** A draft's round count; unknown counts as a long (startup) draft. */
export function draftRounds(d: RookieDraftLike): number {
  return d.settings?.rounds ?? d.rounds ?? 99;
}

/** Short enough to be a rookie draft rather than a startup/full-roster one. */
export function isRookieLengthDraft(d: RookieDraftLike): boolean {
  return draftRounds(d) <= ROOKIE_DRAFT_MAX_ROUNDS;
}

/** A draft that hasn't finished: picks can still change. */
export function isOpenDraft(d: RookieDraftLike): boolean {
  return d.status === "pre_draft" || d.status === "drafting" || d.status === "paused";
}

/** Draft History's filter: rookie-length drafts only. Past classes count once complete; the current
 *  class (`rookieYear`) also while it's drafting or paused, so its partial picks show as a live ADP
 *  read. */
export function isHistoryRookieDraft(d: RookieDraftLike, rookieYear: string): boolean {
  if (!isRookieLengthDraft(d)) return false;
  if (d.season !== rookieYear) return d.status === "complete";
  return d.status === "complete" || d.status === "drafting" || d.status === "paused";
}

/** One pick, trimmed to the fields Draft History and the compile read. */
export interface SavedDraftPick {
  pick_no: number;
  round: number;
  draft_slot: number;
  player_id: string;
  picked_by: string | null;
  metadata: {
    first_name?: string;
    last_name?: string;
    position?: string;
    team?: string;
    years_exp?: string | number | null;
  };
}

/** One rookie draft in a /api/draft-history answer. `leagueId` is the season's own league id. */
export interface DraftHistoryDraft {
  leagueId: string;
  season: string;
  draftId: string;
  picks: SavedDraftPick[];
}

/** POST /api/draft-history { leagueIds } → each finished league's drafts (its own season and up to
 *  DRAFT_HISTORY_PREVIOUS_SEASONS back), the league ids it ran out of time for (ask again), and how
 *  long to wait first when Sleeper asked to slow down. */
export interface DraftHistoryResponse {
  leagues: Array<{ leagueId: string; drafts: DraftHistoryDraft[] }>;
  pending: string[];
  retryAfterMs?: number;
  /** Where this answer's completed drafts came from, and how many Sleeper requests it made. */
  stats: { savedDrafts: number; fetchedDrafts: number; liveDrafts: number; sleeperRequests: number };
}

const KEPT_METADATA = ["first_name", "last_name", "position", "team", "years_exp"] as const;

/** Sleeper's /draft/{id}/picks body trimmed to SavedDraftPick (about half the size: reactions,
 *  injury status, news timestamps etc. dropped). A pick without a numeric pick_no is skipped.
 *  Null when the body isn't an array (a failed fetch). */
export function trimDraftPicks(raw: unknown): SavedDraftPick[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SavedDraftPick[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const pickNo = Number(p.pick_no);
    if (!Number.isFinite(pickNo)) continue;
    const meta = (p.metadata && typeof p.metadata === "object" ? p.metadata : {}) as Record<string, unknown>;
    const metadata: SavedDraftPick["metadata"] = {};
    for (const key of KEPT_METADATA) {
      if (meta[key] !== undefined) (metadata as Record<string, unknown>)[key] = meta[key];
    }
    out.push({
      pick_no: pickNo,
      round: Number(p.round) || 0,
      draft_slot: Number(p.draft_slot) || 0,
      player_id: p.player_id == null ? "" : String(p.player_id),
      picked_by: p.picked_by == null || p.picked_by === "" ? null : String(p.picked_by),
      metadata,
    });
  }
  return out;
}
