// ============================================================
// NFL draft results into the shared cache (migration 090) — SERVER-ONLY.
// ============================================================
// A finished draft never changes, so a year with round 7 stored is served
// from cfd_draft_picks and never fetched again. An unfinished one (loaded
// during draft weekend, or a year CFD hasn't filled yet) is fetched again at
// most hourly. Writes go through the caller's own client, like the other
// cfd_* caches (any signed-in user may add to them).
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CfdGet } from "./client";
import { isCompleteDraft, toDraftPickRow, type CfdDraftPick, type DraftPickRow } from "../nflDraft";

export const DRAFT_REFRESH_MS = 3_600_000;
const COLS = "year,overall,round,pick,nfl_team_id,nfl_team,position,name,college";
const UPSERT_CHUNK = 500;

export interface DraftYearLoad {
  picks: DraftPickRow[];
  /** CFD was called this time. */
  fetched: boolean;
  /** CFD's calls left this month, when it was called. */
  remaining: number | null;
}

async function readYear(supabase: SupabaseClient, year: number): Promise<DraftPickRow[]> {
  const { data, error } = await supabase.from("cfd_draft_picks").select(COLS).eq("year", year).order("overall");
  if (error) throw new Error(error.message);
  return (data ?? []) as DraftPickRow[];
}

/** A year's picks: from the cache, fetched from CFD first when unfinished and not fetched in the last hour. */
export async function loadDraftYear(
  supabase: SupabaseClient, get: CfdGet | null, year: number, now = Date.now(),
): Promise<DraftYearLoad> {
  const stored = await readYear(supabase, year);
  if (isCompleteDraft(stored) || !get) return { picks: stored, fetched: false, remaining: null };

  const key = `draft:${year}`;
  const { data: logRow, error: logErr } = await supabase.from("cfd_fetch_log").select("fetched_at").eq("key", key).maybeSingle();
  if (logErr) throw new Error(logErr.message);
  const last = logRow?.fetched_at ? Date.parse(logRow.fetched_at as string) : null;
  if (last != null && now - last < DRAFT_REFRESH_MS) return { picks: stored, fetched: false, remaining: null };

  const res = await get<CfdDraftPick[]>("/draft/picks", { year });
  const rows = (Array.isArray(res.body) ? res.body : [])
    .map(toDraftPickRow)
    .filter((r): r is DraftPickRow => r != null && r.year === year)
    .sort((a, b) => a.overall - b.overall);
  const stamp = new Date(now).toISOString();
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK).map((r) => ({ ...r, fetched_at: stamp }));
    const { error } = await supabase.from("cfd_draft_picks").upsert(chunk, { onConflict: "year,overall" });
    if (error) throw new Error(error.message);
  }
  const { error: writeLogErr } = await supabase.from("cfd_fetch_log").upsert(
    { key, fetched_at: stamp, rows: rows.length, calls_remaining: res.remaining }, { onConflict: "key" },
  );
  if (writeLogErr) throw new Error(writeLogErr.message);
  return { picks: rows.length ? rows : stored, fetched: true, remaining: res.remaining };
}
