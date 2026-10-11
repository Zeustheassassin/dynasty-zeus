// ============================================================
// Saved Sleeper drafts — SERVER-ONLY.
// ============================================================
// Reads and writes the two shared tables from migration 070 through the service role:
//   - sleeper_draft_snapshots: picks of completed rookie-length drafts, saved once, never overwritten.
//   - sleeper_league_seasons: each league-season's previous_league_id + completed rookie draft ids,
//     and whether that list is final (never re-checked).
// Only the server writes them, and only with what it fetched from Sleeper itself — a browser write
// would let one user plant picks every other user then sees.
//
// Nothing here throws. With no service-role key (local dev, previews), the migration not applied, or
// a Supabase error, reads come back empty and writes are logged and skipped, so callers fall back to
// asking Sleeper exactly as they did before these tables existed.
// ============================================================

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { logger } from "@/lib/logger";
import type { SavedDraftPick } from "@/lib/draft/rookieDrafts";

const log = logger("lib/server/draftSnapshots");

/** Draft ids per `.in()` read — keeps the request URL short and each response around 1 MB. */
const READ_CHUNK = 100;
/** Rows per write — ~10 KB of picks each. */
const WRITE_CHUNK = 50;

export interface SavedDraft {
  draftId: string;
  leagueId: string | null;
  season: string;
  picks: SavedDraftPick[];
}

export interface DraftSnapshotInput extends SavedDraft {
  rounds: number | null;
}

export interface LeagueSeasonRow {
  league_id: string;
  season: string;
  previous_league_id: string | null;
  rookie_draft_ids: string[];
  final: boolean;
}

function errMessage(err: unknown): string {
  return err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err);
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Saved picks for whichever of `draftIds` have them. A failed read stops early — the drafts not
 *  read are simply fetched from Sleeper by the caller. */
export async function readSavedDrafts(draftIds: string[]): Promise<Map<string, SavedDraft>> {
  const out = new Map<string, SavedDraft>();
  const client = getSupabaseAdmin();
  const ids = Array.from(new Set(draftIds));
  if (!client || ids.length === 0) return out;
  for (const chunk of chunks(ids, READ_CHUNK)) {
    try {
      const { data, error } = await client
        .from("sleeper_draft_snapshots")
        .select("draft_id, league_id, season, picks")
        .in("draft_id", chunk);
      if (error) throw error;
      for (const row of (data ?? []) as Array<{ draft_id: string; league_id: string | null; season: string; picks: unknown }>) {
        if (!Array.isArray(row.picks)) continue;
        out.set(row.draft_id, {
          draftId: row.draft_id,
          leagueId: row.league_id,
          season: row.season,
          picks: row.picks as SavedDraftPick[],
        });
      }
    } catch (err) {
      log.warn("saved draft read failed — fetching the rest from Sleeper", { err: errMessage(err), drafts: ids.length });
      break;
    }
  }
  return out;
}

/** Saves completed drafts' picks. Never overwrites a saved draft (a completed draft doesn't change),
 *  and skips one with no picks. Returns how many rows were sent without an error. */
export async function saveDrafts(drafts: DraftSnapshotInput[]): Promise<number> {
  const client = getSupabaseAdmin();
  if (!client) return 0;
  const byId = new Map<string, DraftSnapshotInput>();
  // The table CHECKs a 4-digit season — one bad row would fail its whole chunk, so it's left out.
  for (const d of drafts) if (d.picks.length > 0 && /^\d{4}$/.test(d.season)) byId.set(d.draftId, d);
  let saved = 0;
  for (const chunk of chunks(Array.from(byId.values()), WRITE_CHUNK)) {
    const rows = chunk.map((d) => ({
      draft_id: d.draftId,
      league_id: d.leagueId,
      season: d.season,
      rounds: d.rounds,
      pick_count: d.picks.length,
      picks: d.picks,
    }));
    try {
      const { error } = await client
        .from("sleeper_draft_snapshots")
        .upsert(rows, { onConflict: "draft_id", ignoreDuplicates: true });
      if (error) throw error;
      saved += rows.length;
    } catch (err) {
      log.warn("saving drafts failed", { err: errMessage(err), drafts: rows.length });
    }
  }
  return saved;
}

/** Saved league-season rows for whichever of `leagueIds` have one (empty on a failed read). */
export async function readLeagueSeasons(leagueIds: string[]): Promise<Map<string, LeagueSeasonRow>> {
  const out = new Map<string, LeagueSeasonRow>();
  const client = getSupabaseAdmin();
  const ids = Array.from(new Set(leagueIds));
  if (!client || ids.length === 0) return out;
  for (const chunk of chunks(ids, READ_CHUNK)) {
    try {
      const { data, error } = await client
        .from("sleeper_league_seasons")
        .select("league_id, season, previous_league_id, rookie_draft_ids, final")
        .in("league_id", chunk);
      if (error) throw error;
      for (const row of (data ?? []) as LeagueSeasonRow[]) {
        out.set(row.league_id, {
          league_id: row.league_id,
          season: row.season,
          previous_league_id: row.previous_league_id ?? null,
          rookie_draft_ids: Array.isArray(row.rookie_draft_ids) ? row.rookie_draft_ids : [],
          final: row.final === true,
        });
      }
    } catch (err) {
      log.warn("league-season read failed — checking those with Sleeper", { err: errMessage(err), leagues: ids.length });
      break;
    }
  }
  return out;
}

/** Saves (or updates) league-season rows. */
export async function saveLeagueSeasons(rows: LeagueSeasonRow[]): Promise<void> {
  const client = getSupabaseAdmin();
  const valid = rows.filter((r) => /^\d{4}$/.test(r.season)); // same CHECK as saveDrafts
  if (!client || valid.length === 0) return;
  const checkedAt = new Date().toISOString();
  for (const chunk of chunks(valid, WRITE_CHUNK)) {
    try {
      const { error } = await client
        .from("sleeper_league_seasons")
        .upsert(chunk.map((r) => ({ ...r, checked_at: checkedAt })), { onConflict: "league_id" });
      if (error) throw error;
    } catch (err) {
      log.warn("saving league-seasons failed", { err: errMessage(err), leagues: chunk.length });
    }
  }
}
