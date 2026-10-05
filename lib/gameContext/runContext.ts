// ============================================================
// Fill the automatic game context for a few prospects — SERVER-ONLY.
// ============================================================
// Tape-grading expansion, Stage 5. For every charted game of the given
// prospects (old and new):
//   1. Supporting cast (PFF, his linked games only): the game's offense facet,
//      both teams in one read, kept per user in pff_game_offense (read once
//      per game, ever). It also says which team he played for that day.
//   2. The CollegeFootballData game: his team and the PFF game's teams and
//      kickoff pick it from the shared CFD cache (lib/cfd/cache.ts, fetched
//      once per season); a game with no PFF link falls back to the charted
//      opponent (lib/cfd/match.ts).
//   3. Weather (the shared cfd_games row, once per game for every user): the
//      venue's coordinates and the kickoff → the Open-Meteo archive; domes are
//      skipped, a game from the last few days stays pending until the archive
//      has it.
//   4. One scouting_game_context row per charted game, written as the caller.
// Opponent defense SP+ is read by the app from cfd_team_seasons at display
// time, so an in-season SP+ update reaches every game without a rewrite.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../logger";
import type { CfdGet } from "../cfd/client";
import {
  cfdCache, ensureSeasonGames, ensureSeasonSp, ensureVenues, seasonGames, venuesById, type CfdCache,
} from "../cfd/cache";
import { matchCfdGame, type CfdMatch } from "../cfd/match";
import type { CfdGameWithWeather, WeatherStatus } from "../cfd/types";
import type { PffClient } from "../pff/client";
import { teamCast, trimOffenseRows, type PffOffenseRow, type TeamCast } from "../pff/cast";
import { isPostseasonGame, pffTeamSchool } from "../pff/match";
import { gameOffense, seasonTeams } from "../pff/ncaa";
import { opponentSchool } from "../scouting/opponentTier";
import {
  archiveReady, fetchArchive, kickoffMs, POINTS_PER_REQUEST, summarizeWindow, windowDates,
} from "../weather/openMeteo";
import type { ContextFillResult } from "./api";

const log = logger("lib/gameContext/runContext");
const LINKED = new Set(["auto", "confirmed"]);

interface ProspectRow { id: string; position: string; school: string | null; pff_player_id: number | null }
interface GameRow {
  id: string; prospect_id: string; season_year: number; opponent: string; game_type: string;
  pff_game_id: number | null; pff_match_status: string | null;
}
interface PffGameRow { game_id: string; franchise_id: number | null; snaps: number | null }

export interface ContextDeps {
  supabase: SupabaseClient;
  userId: string;
  /** null without PFF_API_KEY: no cast, CFD matching by the charted opponent only. */
  pff: PffClient | null;
  /** null without CFD_API_KEY: the shared cache is read but never refreshed. */
  cfd: CfdGet | null;
  fetchImpl?: typeof fetch;
  now?: number;
  /** Stop starting PFF reads after this time (ms since epoch). */
  deadline?: number;
}

export interface ContextRun {
  results: ContextFillResult[];
  /** CFD lists fetched this run, and CFD's calls left this month. */
  cfdFetched: string[];
  cfdRemaining: number | null;
}

const isLinked = (g: GameRow) => g.pff_game_id != null && LINKED.has(g.pff_match_status ?? "");

export async function fillGameContext(deps: ContextDeps, prospectIds: readonly string[]): Promise<ContextRun> {
  const { supabase, userId } = deps;
  const now = deps.now ?? Date.now();
  const [pRes, gRes, fRes] = await Promise.all([
    supabase.from("prospects").select("id,position,school,pff_player_id").in("id", prospectIds),
    supabase.from("scouting_games").select("id,prospect_id,season_year,opponent,game_type,pff_game_id,pff_match_status").in("prospect_id", prospectIds),
    supabase.from("prospect_game_pff").select("game_id,franchise_id,snaps").in("prospect_id", prospectIds),
  ]);
  const loadErr = pRes.error ?? gRes.error;
  if (loadErr) throw new Error(loadErr.message);
  const prospects = new Map(((pRes.data ?? []) as ProspectRow[]).map((p) => [p.id, p]));
  const games = (gRes.data ?? []) as GameRow[];
  // prospect_game_pff is migration 063; without it, his team comes from the facet alone.
  const pffRowByGame = new Map(((fRes.error ? [] : fRes.data ?? []) as PffGameRow[]).map((r) => [r.game_id, r]));

  const results = new Map<string, ContextFillResult>(prospectIds.map((id) => [id, { prospectId: id, games: 0 }]));
  const unreached = new Set<string>();

  // ── 1. PFF offense facets (cast + his team that day) ──
  const offense = new Map<number, PffOffenseRow[]>();
  const linkedIds = [...new Set(games.filter(isLinked).map((g) => g.pff_game_id!))];
  if (deps.pff && linkedIds.length) {
    const { data, error } = await supabase.from("pff_game_offense").select("pff_game_id,rows").in("pff_game_id", linkedIds);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { pff_game_id: number; rows: PffOffenseRow[] }[]) offense.set(r.pff_game_id, r.rows);
    for (const id of linkedIds) {
      if (offense.has(id)) continue;
      if (deps.deadline != null && Date.now() > deps.deadline) {
        for (const g of games) if (g.pff_game_id === id) unreached.add(g.prospect_id);
        continue;
      }
      const rows = trimOffenseRows(await gameOffense(deps.pff, id));
      offense.set(id, rows);
      if (rows.length) {
        const { error: upErr } = await supabase.from("pff_game_offense").upsert(
          { user_id: userId, pff_game_id: id, rows, fetched_at: new Date(now).toISOString() }, { onConflict: "user_id,pff_game_id" },
        );
        if (upErr) throw new Error(upErr.message);
      }
    }
  }

  // His team in each game: his own facet row, else his PFF stats row, else another game that season.
  const franchiseOf = new Map<string, number>();
  for (const g of games) {
    const p = prospects.get(g.prospect_id);
    const me = isLinked(g) && p?.pff_player_id != null ? offense.get(g.pff_game_id!)?.find((r) => r.id === p.pff_player_id) : undefined;
    const f = me?.team ?? pffRowByGame.get(g.id)?.franchise_id ?? null;
    if (f != null) franchiseOf.set(g.id, f);
  }
  for (const g of games) {
    if (franchiseOf.has(g.id)) continue;
    const same = games.find((o) => o.prospect_id === g.prospect_id && o.season_year === g.season_year && franchiseOf.has(o.id));
    if (same) franchiseOf.set(g.id, franchiseOf.get(same.id)!);
  }

  // ── 2. CFD match ──
  const cache = cfdCache(supabase, deps.cfd, now);
  const seasons = [...new Set(games.map((g) => g.season_year))].sort();
  const pffSeason = new Map<number, Awaited<ReturnType<typeof seasonTeams>> | null>();
  for (const s of seasons) {
    pffSeason.set(s, deps.pff && games.some((g) => g.season_year === s && isLinked(g)) ? await seasonTeams(deps.pff, s, now).catch((err) => {
      log.warn("PFF season teams failed", { season: s, err: String(err) });
      return null;
    }) : null);
  }
  const schoolOf = (season: number, franchiseId: number | null | undefined) =>
    franchiseId == null ? null : pffTeamSchool(pffSeason.get(season)?.teams.get(franchiseId) ?? null);

  const matchOne = (g: GameRow, season: CfdGameWithWeather[]): CfdMatch => {
    const p = prospects.get(g.prospect_id);
    const info = isLinked(g) ? pffSeason.get(g.season_year)?.games.find((x) => x.id === g.pff_game_id) : undefined;
    return matchCfdGame({
      season: g.season_year,
      chartedOpponentSchool: opponentSchool(g.opponent),
      chartedPostseason: isPostseasonGame(g),
      teamSchool: schoolOf(g.season_year, franchiseOf.get(g.id)) ?? opponentSchool(p?.school ?? ""),
      pff: info ? {
        homeSchool: schoolOf(g.season_year, info.home_franchise_id),
        awaySchool: schoolOf(g.season_year, info.away_franchise_id),
        start: info.start || null,
      } : null,
    }, season);
  };

  const matches = new Map<string, CfdMatch>();
  const cfdGames = new Map<number, CfdGameWithWeather>();
  for (const s of seasons) {
    const inSeason = games.filter((g) => g.season_year === s);
    await ensureSeasonGames(cache, s, "fbs");
    await ensureSeasonSp(cache, s);
    let list = await seasonGames(cache, s);
    // A game that should be findable (linked to PFF, or a recognized opponent)
    // but isn't in the cached FBS schedule: an FCS-vs-FCS game, or one added since.
    const findable = (g: GameRow) => isLinked(g) || opponentSchool(g.opponent) != null;
    if (deps.cfd && inSeason.some((g) => findable(g) && matchOne(g, list).status !== "auto")) {
      await ensureSeasonGames(cache, s, "fbs", { unmatched: true });
      await ensureSeasonGames(cache, s, "fcs", { unmatched: true });
      list = await seasonGames(cache, s);
    }
    for (const g of inSeason) matches.set(g.id, matchOne(g, list));
    for (const x of list) cfdGames.set(x.id, x);
  }

  // ── 3. Weather ──
  const matchedGames = [...new Set([...matches.values()].map((m) => m.cfdGameId).filter((id): id is number => id != null))]
    .map((id) => cfdGames.get(id)!).filter(Boolean);
  const needVenue = matchedGames.filter((x) => x.venue_id != null);
  let venues = await venuesById(cache, needVenue.map((x) => x.venue_id!));
  if (needVenue.some((x) => !venues.has(x.venue_id!))) {
    await ensureVenues(cache, true);
    venues = await venuesById(cache, needVenue.map((x) => x.venue_id!));
  }
  const weatherUpdates = await fillWeather(matchedGames, venues, now, deps.fetchImpl);
  for (const u of weatherUpdates) {
    const { error } = await supabase.from("cfd_games").update(u.patch).eq("id", u.id);
    if (error) throw new Error(`cfd_games weather: ${error.message}`);
    Object.assign(cfdGames.get(u.id)!, u.patch);
  }

  // ── 4. Context rows ──
  const fetchedAt = new Date(now).toISOString();
  const rows = games.filter((g) => !unreached.has(g.prospect_id)).map((g) => {
    const p = prospects.get(g.prospect_id);
    const m = matches.get(g.id)!;
    const franchise = franchiseOf.get(g.id) ?? null;
    const facet = isLinked(g) ? offense.get(g.pff_game_id!) : undefined;
    const cast: TeamCast | null = facet?.length && franchise != null ? teamCast(facet, franchise, p?.pff_player_id) : null;
    const me = facet?.find((r) => r.id === p?.pff_player_id);
    return {
      game_id: g.id, user_id: userId, prospect_id: g.prospect_id,
      cfd_game_id: m.cfdGameId, cfd_match_status: m.status, cfd_match_note: m.note,
      team_school: m.teamSchool, opponent_school: m.opponentSchool,
      cast_status: !isLinked(g) || !deps.pff ? "no_pff" : cast ? "ok" : "no_team",
      pff_franchise_id: franchise,
      team_snaps: cast?.teamSnaps ?? null,
      his_snaps: me?.snaps ?? pffRowByGame.get(g.id)?.snaps ?? null,
      ol_pass_block: cast?.olPassBlock ?? null, ol_pass_block_snaps: cast?.olPassBlockSnaps ?? null,
      ol_run_block: cast?.olRunBlock ?? null, ol_run_block_snaps: cast?.olRunBlockSnaps ?? null,
      qb_pass_grade: cast?.qbPassGrade ?? null, qb_name: cast?.qbName ?? null,
      qb_pff_id: cast?.qbPlayerId ?? null, qb_dropbacks: cast?.qbDropbacks ?? null,
      fetched_at: fetchedAt,
    };
  });
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from("scouting_game_context").upsert(rows.slice(i, i + 200), { onConflict: "game_id" });
    if (error) throw new Error(error.message);
  }

  const castOk = new Set(rows.filter((x) => x.cast_status === "ok").map((x) => x.game_id));
  for (const g of games) {
    const r = results.get(g.prospect_id)!;
    if (unreached.has(g.prospect_id)) { r.error = "Not reached this batch; run again"; continue; }
    const m = matches.get(g.id)!;
    const cg = m.cfdGameId != null ? cfdGames.get(m.cfdGameId) : undefined;
    r.games++;
    if (m.status === "auto") r.matched = (r.matched ?? 0) + 1;
    else (r.unmatched ??= []).push({ gameId: g.id, reason: m.note });
    const ws = cg?.weather_status;
    if (ws === "ok" || ws === "dome") r.weather = (r.weather ?? 0) + 1;
    if (ws === "pending") r.weatherPending = (r.weatherPending ?? 0) + 1;
    if (castOk.has(g.id)) r.cast = (r.cast ?? 0) + 1;
  }
  return { results: [...results.values()], cfdFetched: cache.fetched, cfdRemaining: cache.remaining };
}

interface WeatherUpdate { id: number; patch: Record<string, unknown> }

/** Weather for every matched game that hasn't got it (or was pending and can be read now). */
export async function fillWeather(
  games: readonly CfdGameWithWeather[],
  venues: ReadonlyMap<number, { latitude: number | null; longitude: number | null; dome: boolean | null }>,
  now: number,
  fetchImpl: typeof fetch = fetch,
): Promise<WeatherUpdate[]> {
  const out: WeatherUpdate[] = [];
  const stamp = new Date(now).toISOString();
  const status = (id: number, s: WeatherStatus) => out.push({ id, patch: { weather_status: s, weather_fetched_at: stamp } });
  const groups = new Map<string, { id: number; lat: number; lon: number; kickoff: number }[]>();
  for (const g of games) {
    if (g.weather_status === "ok" || g.weather_status === "dome" || g.weather_status === "no_location") continue;
    const v = g.venue_id != null ? venues.get(g.venue_id) : undefined;
    if (v?.dome) { status(g.id, "dome"); continue; }
    const k = g.start_date ? kickoffMs(g.start_date, g.start_time_tbd) : null;
    if (v?.latitude == null || v?.longitude == null || k == null) { status(g.id, "no_location"); continue; }
    if (!archiveReady(k, now)) { if (g.weather_status !== "pending") status(g.id, "pending"); continue; }
    const w = windowDates(k);
    const key = `${w.start}|${w.end}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push({ id: g.id, lat: v.latitude, lon: v.longitude, kickoff: k });
  }
  for (const [key, pts] of groups) {
    const [start, end] = key.split("|");
    for (let i = 0; i < pts.length; i += POINTS_PER_REQUEST) {
      const chunk = pts.slice(i, i + POINTS_PER_REQUEST);
      let hourly;
      try {
        hourly = await fetchArchive(chunk.map((c) => ({ latitude: c.lat, longitude: c.lon })), start, end, fetchImpl);
      } catch (err) {
        log.warn("Open-Meteo archive failed; leaving these games pending", { start, games: chunk.length, err: String(err) });
        continue;
      }
      chunk.forEach((c, j) => {
        const s = summarizeWindow(hourly[j], c.kickoff);
        out.push({ id: c.id, patch: s ? { weather_status: "ok", ...s, weather_fetched_at: stamp } : { weather_status: "pending", weather_fetched_at: stamp } });
      });
    }
  }
  return out;
}

export type { CfdCache };
