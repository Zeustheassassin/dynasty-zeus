// ============================================================
// The shared CollegeFootballData cache (migration 065) — SERVER-ONLY.
// ============================================================
// Every user's charted games read the same public lists, so each is fetched
// once into cfd_games / cfd_team_seasons / cfd_venues and recorded in
// cfd_fetch_log, then served from there. CFD's free tier is ~1,000 calls a
// month, shared with the Recruits tab, so:
//   - a finished season's schedule and SP+ are fetched once, ever;
//   - the current season's are refreshed after a week (new scores, bowl and
//     playoff games, SP+ updates), or after a day when a charted game of that
//     season couldn't be found in it (a game added since);
//   - the FCS schedule is fetched only when a charted game isn't in the FBS
//     one (an FCS player's game against an FCS opponent);
//   - venues once, and again only when a matched game's venue is missing
//     (at most weekly).
// Writes go through the caller's own client (any signed-in user may add to
// the shared cache, like `recruits`).
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../logger";
import type { CfdGet } from "./client";
import {
  toCfdGameRow, toCfdTeamSeasonRows, toCfdVenueRow,
  type CfdGameWithWeather, type CfdTeamSeasonRow, type CfdVenueRow,
} from "./types";

const log = logger("lib/cfd/cache");

const DAY_MS = 86_400_000;
export const CURRENT_SEASON_REFRESH_MS = 7 * DAY_MS;
export const UNMATCHED_RETRY_MS = DAY_MS;
const UPSERT_CHUNK = 500;
const PAGE = 1000;

/** The season being played on `now`: August onward is that year's, before it last year's. */
export function currentSeason(now = Date.now()): number {
  const d = new Date(now);
  return d.getUTCMonth() >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

/** Should a list last fetched at `fetchedAt` be fetched again? */
export function isStale(season: number, fetchedAt: number | null, now: number, { unmatched = false } = {}): boolean {
  if (fetchedAt == null) return true;
  if (season < currentSeason(now)) return false;
  const age = now - fetchedAt;
  return age > CURRENT_SEASON_REFRESH_MS || (unmatched && age > UNMATCHED_RETRY_MS);
}

export interface CfdCache {
  supabase: SupabaseClient;
  /** null when CFD_API_KEY isn't set: the cache is read, never refreshed. */
  get: CfdGet | null;
  now: number;
  /** Lists fetched from CFD in this run (for the response and the logs). */
  fetched: string[];
  /** CFD's calls left this month, from the last response. */
  remaining: number | null;
}

export function cfdCache(supabase: SupabaseClient, get: CfdGet | null, now = Date.now()): CfdCache {
  return { supabase, get, now, fetched: [], remaining: null };
}

async function fetchedAt(c: CfdCache, key: string): Promise<number | null> {
  const { data, error } = await c.supabase.from("cfd_fetch_log").select("fetched_at").eq("key", key).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.fetched_at ? Date.parse(data.fetched_at as string) : null;
}

async function logFetch(c: CfdCache, key: string, rows: number, remaining: number | null): Promise<void> {
  c.fetched.push(key);
  if (remaining != null) c.remaining = remaining;
  const { error } = await c.supabase.from("cfd_fetch_log").upsert(
    { key, fetched_at: new Date(c.now).toISOString(), rows, calls_remaining: remaining }, { onConflict: "key" },
  );
  if (error) log.error("fetch log write failed", { key, err: error.message });
}

async function upsertChunks(c: CfdCache, table: string, rows: object[], onConflict: string): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const { error } = await c.supabase.from(table).upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

/** Fetches a season's schedule (FBS, or FCS) into cfd_games when it's stale. */
export async function ensureSeasonGames(
  c: CfdCache, season: number, classification: "fbs" | "fcs", { unmatched = false } = {},
): Promise<void> {
  const key = `games:${season}:${classification}`;
  if (!c.get || !isStale(season, await fetchedAt(c, key), c.now, { unmatched })) return;
  const { body, remaining } = await c.get<unknown[]>("/games", { year: season, seasonType: "both", classification });
  const rows = (Array.isArray(body) ? body : []).map(toCfdGameRow).filter((r) => r != null)
    .map((r) => ({ ...r, fetched_at: new Date(c.now).toISOString() }));
  await upsertChunks(c, "cfd_games", rows, "id");
  await logFetch(c, key, rows.length, remaining);
}

/** Fetches a season's SP+ into cfd_team_seasons when it's stale. */
export async function ensureSeasonSp(c: CfdCache, season: number): Promise<void> {
  const key = `sp:${season}`;
  if (!c.get || !isStale(season, await fetchedAt(c, key), c.now)) return;
  const { body, remaining } = await c.get<unknown>("/ratings/sp", { year: season });
  const rows = toCfdTeamSeasonRows(body, season).map((r) => ({ ...r, fetched_at: new Date(c.now).toISOString() }));
  await upsertChunks(c, "cfd_team_seasons", rows, "season,school");
  await logFetch(c, key, rows.length, remaining);
}

/** Fetches every venue into cfd_venues: once, or again (at most weekly) when one is missing. */
export async function ensureVenues(c: CfdCache, missing: boolean): Promise<void> {
  const key = "venues";
  if (!c.get) return;
  const at = await fetchedAt(c, key);
  if (at != null && !(missing && c.now - at > CURRENT_SEASON_REFRESH_MS)) return;
  const { body, remaining } = await c.get<unknown[]>("/venues", {});
  const rows = (Array.isArray(body) ? body : []).map(toCfdVenueRow).filter((r) => r != null)
    .map((r) => ({ ...r, fetched_at: new Date(c.now).toISOString() }));
  await upsertChunks(c, "cfd_venues", rows, "id");
  await logFetch(c, key, rows.length, remaining);
}

const GAME_COLUMNS =
  "id,season,week,season_type,start_date,start_time_tbd,completed,neutral_site,venue_id,venue,home_team,home_classification,home_points,away_team,away_classification,away_points,weather_status,temperature_f,wind_mph,humidity,gust_mph,precip_in,snow_in,weather_code,weather_fetched_at";

/** Every cached game of a season (FBS and any FCS fetched). */
export async function seasonGames(c: CfdCache, season: number): Promise<CfdGameWithWeather[]> {
  const out: CfdGameWithWeather[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await c.supabase.from("cfd_games").select(GAME_COLUMNS).eq("season", season)
      .order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as CfdGameWithWeather[]));
    if (!data || data.length < PAGE) return out;
  }
}

export async function venuesById(c: CfdCache, ids: readonly number[]): Promise<Map<number, CfdVenueRow>> {
  const out = new Map<number, CfdVenueRow>();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 200) {
    const { data, error } = await c.supabase.from("cfd_venues")
      .select("id,name,city,state,latitude,longitude,elevation,dome,grass,timezone").in("id", uniq.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const v of (data ?? []) as CfdVenueRow[]) out.set(v.id, v);
  }
  return out;
}

export type { CfdTeamSeasonRow };
