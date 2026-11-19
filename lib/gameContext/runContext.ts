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
//   4. Season units (line season grades plan, migration 103; RB / WR / TE
//      games linked to PFF): PFF's FULL-SEASON report for the opponent's
//      defense, and for an RB his own team's run blocking, of that game's
//      season. Kept per user in pff_team_season (a finished season read once,
//      the season in progress again once a week old) and boiled down by
//      lib/pff/teamUnits.ts. Until migration 103 is applied this step is
//      skipped and the rows are written without those columns.
//   5. One scouting_game_context row per charted game, written as the caller.
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
import { gameOffense, seasonTeams, teamSeasonFacet } from "../pff/ncaa";
import {
  defenseUnits, olRunBlock, SEASON_REPORTS, seasonReportStale, trimDefenseRows, trimRunBlockingRows,
  type PffDefenseRow, type PffRunBlockRow, type SeasonReport,
} from "../pff/teamUnits";
import { fetchLearnedOpponentNames } from "../scouting/learnedOpponentNames";
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
  const [pRes, gRes, fRes, learned] = await Promise.all([
    supabase.from("prospects").select("id,position,school,pff_player_id").in("id", prospectIds),
    supabase.from("scouting_games").select("id,prospect_id,season_year,opponent,game_type,pff_game_id,pff_match_status").in("prospect_id", prospectIds),
    supabase.from("prospect_game_pff").select("game_id,franchise_id,snaps").in("prospect_id", prospectIds),
    // Opponent names the user taught by linking games to PFF: an unlinked game typed the same way still finds its CFD game.
    fetchLearnedOpponentNames(supabase).catch((err: unknown) => {
      log.warn("learned opponent names unavailable", { err: String(err) });
      return new Map<string, string>();
    }),
  ]);
  const chartedSchool = (name: string | null | undefined) => opponentSchool(name, learned);
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
      chartedOpponentSchool: chartedSchool(g.opponent),
      chartedPostseason: isPostseasonGame(g),
      teamSchool: schoolOf(g.season_year, franchiseOf.get(g.id)) ?? chartedSchool(p?.school),
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
    const findable = (g: GameRow) => isLinked(g) || chartedSchool(g.opponent) != null;
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

  // ── 4. Season units ──
  const unitGames = new Map(games.map((g): [string, UnitGame] => {
    const franchise = franchiseOf.get(g.id) ?? null;
    const info = isLinked(g) ? pffSeason.get(g.season_year)?.games.find((x) => x.id === g.pff_game_id) : undefined;
    return [g.id, {
      prospectId: g.prospect_id, season: g.season_year, position: prospects.get(g.prospect_id)?.position ?? "",
      linked: isLinked(g), franchise,
      opponent: isLinked(g) ? opponentFranchise(franchise, offense.get(g.pff_game_id!), info) : null,
    }];
  }));
  const units = await seasonReports(deps, [...unitGames.values()].filter((u) => !unreached.has(u.prospectId)), now);
  for (const u of unitGames.values()) {
    if (reportsFor(u).some((r) => units.missing.has(reportKey(r.season, r.franchiseId, r.report)))) unreached.add(u.prospectId);
  }

  // ── 5. Context rows ──
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
      // Before migration 103 the columns don't exist: leave them out.
      ...(units.ready ? seasonUnitColumns(unitGames.get(g.id)!, units.reports, deps.pff != null) : {}),
    };
  });
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from("scouting_game_context").upsert(rows.slice(i, i + 200), { onConflict: "game_id" });
    if (error) throw new Error(error.message);
  }

  const castOk = new Set(rows.filter((x) => x.cast_status === "ok").map((x) => x.game_id));
  const unitsOk = new Set(rows.filter((x) => (x as { season_units_status?: string }).season_units_status === "ok").map((x) => x.game_id));
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
    if (unitsOk.has(g.id)) r.seasonUnits = (r.seasonUnits ?? 0) + 1;
  }
  return { results: [...results.values()], cfdFetched: cache.fetched, cfdRemaining: cache.remaining };
}

// ── Season units (line season grades plan, migration 103) ────

/** One charted game, as the season-units step sees it. */
export interface UnitGame {
  prospectId: string;
  season: number;
  position: string;
  /** Linked to its PFF game. */
  linked: boolean;
  /** His PFF franchise that day, and the opponent's. */
  franchise: number | null;
  opponent: number | null;
}

/**
 * The other team in a PFF game: from the game's offense facet (both teams'
 * players), else PFF's schedule. Null when neither says.
 */
export function opponentFranchise(
  franchise: number | null,
  facet: readonly PffOffenseRow[] | undefined,
  scheduled: { home_franchise_id: number; away_franchise_id: number } | undefined,
): number | null {
  if (franchise == null) return null;
  const teams = new Set((facet ?? []).map((r) => r.team));
  if (teams.size === 2 && teams.has(franchise)) return [...teams].find((t) => t !== franchise)!;
  if (scheduled?.home_franchise_id === franchise) return scheduled.away_franchise_id;
  if (scheduled?.away_franchise_id === franchise) return scheduled.home_franchise_id;
  return null;
}

export const reportKey = (season: number, franchiseId: number, report: SeasonReport) => `${season}|${franchiseId}|${report}`;

export interface ReportNeed { season: number; franchiseId: number; report: SeasonReport }

/** The season reports a game needs: an RB his team's run blocking and the opponent's defense; a WR / TE the opponent's defense; a QB none. */
export function reportsFor(g: UnitGame): ReportNeed[] {
  if (!g.linked || g.franchise == null || g.opponent == null) return [];
  const pos = g.position.toUpperCase();
  const defense: ReportNeed = { season: g.season, franchiseId: g.opponent, report: "defense" };
  if (pos === "RB") return [{ season: g.season, franchiseId: g.franchise, report: "run_blocking" }, defense];
  return pos === "WR" || pos === "TE" ? [defense] : [];
}

/** A stored report: its trimmed rows and when PFF was read. */
export interface StoredReport { rows: readonly unknown[]; fetchedAt: string }

const UNIT_POSITIONS = new Set(["RB", "WR", "TE"]);

/** A game's season-unit columns on scouting_game_context (migration 103). */
export function seasonUnitColumns(g: UnitGame, reports: ReadonlyMap<string, StoredReport>, pffOn: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {
    opp_pff_franchise_id: g.opponent,
    ol_run_block_season: null, ol_run_block_season_snaps: null,
    opp_front7_run_def: null, opp_front7_run_def_snaps: null,
    opp_cov_outside: null, opp_cov_outside_snaps: null,
    opp_cov_slot: null, opp_cov_slot_snaps: null,
    opp_cov_box: null, opp_cov_box_snaps: null,
    opp_mt_rate: null, opp_tackle_attempts: null,
    season_units_status: null, season_units_at: null,
  };
  if (!UNIT_POSITIONS.has(g.position.toUpperCase())) return { ...out, season_units_status: "n/a" };
  if (!g.linked || !pffOn) return { ...out, season_units_status: "no_pff" };
  if (g.franchise == null || g.opponent == null) return { ...out, season_units_status: "no_team" };
  const read: string[] = [];
  const need = reportsFor(g);
  for (const r of need) {
    const rep = reports.get(reportKey(r.season, r.franchiseId, r.report));
    if (!rep) continue;
    read.push(rep.fetchedAt);
    if (r.report === "run_blocking") {
      const ol = olRunBlock(rep.rows as PffRunBlockRow[]);
      out.ol_run_block_season = ol.grade; out.ol_run_block_season_snaps = ol.snaps;
    } else if (rep.rows.length) {
      const d = defenseUnits(rep.rows as PffDefenseRow[]);
      out.opp_front7_run_def = d.frontSeven.grade; out.opp_front7_run_def_snaps = d.frontSeven.snaps;
      out.opp_cov_outside = d.coverage.outside.grade; out.opp_cov_outside_snaps = d.coverage.outside.snaps;
      out.opp_cov_slot = d.coverage.slot.grade; out.opp_cov_slot_snaps = d.coverage.slot.snaps;
      out.opp_cov_box = d.coverage.box.grade; out.opp_cov_box_snaps = d.coverage.box.snaps;
      out.opp_mt_rate = d.missedTackles.rate; out.opp_tackle_attempts = d.missedTackles.attempts;
    }
  }
  const defense = reports.get(reportKey(g.season, g.opponent, "defense"));
  out.season_units_status = defense?.rows.length ? "ok" : "no_data";
  const oldest = read.map((t) => Date.parse(t)).filter(Number.isFinite).sort((a, b) => a - b)[0];
  out.season_units_at = oldest != null ? new Date(oldest).toISOString() : null;
  return out;
}

interface SeasonReportRow { season: number; franchise_id: number; report: SeasonReport; rows: unknown[]; fetched_at: string }

// PostgREST reports a table it doesn't know (migration 103 not applied) as PGRST205 (or 42P01).
const tableMissing = (e: { code?: string; message: string }) =>
  e.code === "PGRST205" || e.code === "42P01" || (/pff_team_season/.test(e.message) && /schema cache|does not exist/i.test(e.message));

/**
 * The reports these games need: the stored copy while it's current, else a
 * fresh PFF read (stored right away, empty or not, so a team PFF has nothing
 * for isn't asked again until the copy goes stale). Past the deadline a stale
 * copy still serves; a report never read is `missing` (its prospects wait for
 * the next batch). `ready` = migration 103 is applied.
 */
async function seasonReports(
  deps: ContextDeps, games: readonly UnitGame[], now: number,
): Promise<{ ready: boolean; reports: Map<string, StoredReport>; missing: Set<string> }> {
  const { supabase, userId } = deps;
  const reports = new Map<string, StoredReport>();
  const missing = new Set<string>();
  const needed = new Map<string, ReportNeed>();
  if (deps.pff) for (const g of games) for (const r of reportsFor(g)) needed.set(reportKey(r.season, r.franchiseId, r.report), r);

  const seasons = [...new Set([...needed.values()].map((r) => r.season))];
  const franchises = [...new Set([...needed.values()].map((r) => r.franchiseId))];
  // With nothing to read this still asks once, to learn whether migration 103 is in.
  const { data, error } = needed.size
    ? await supabase.from("pff_team_season").select("season,franchise_id,report,rows,fetched_at").in("season", seasons).in("franchise_id", franchises)
    : await supabase.from("pff_team_season").select("season").limit(1);
  if (error) {
    if (tableMissing(error)) return { ready: false, reports, missing };
    throw new Error(error.message);
  }
  const stored = new Map<string, StoredReport>();
  for (const r of (needed.size ? data ?? [] : []) as SeasonReportRow[]) {
    stored.set(reportKey(r.season, r.franchise_id, r.report), { rows: r.rows ?? [], fetchedAt: r.fetched_at });
  }

  for (const [key, need] of needed) {
    const have = stored.get(key);
    if (have && !seasonReportStale(need.season, have.fetchedAt, now)) { reports.set(key, have); continue; }
    if (deps.deadline != null && Date.now() > deps.deadline) {
      if (have) reports.set(key, have); else missing.add(key);
      continue;
    }
    const { path, key: bodyKey } = SEASON_REPORTS[need.report];
    const raw = await teamSeasonFacet(deps.pff!, path, bodyKey, need.season, need.franchiseId);
    const rows = need.report === "defense" ? trimDefenseRows(raw, need.franchiseId) : trimRunBlockingRows(raw, need.franchiseId);
    const fetchedAt = new Date(now).toISOString();
    const { error: upErr } = await supabase.from("pff_team_season").upsert(
      { user_id: userId, season: need.season, franchise_id: need.franchiseId, report: need.report, rows, fetched_at: fetchedAt },
      { onConflict: "user_id,season,franchise_id,report" },
    );
    if (upErr) throw new Error(upErr.message);
    reports.set(key, { rows, fetchedAt });
  }
  return { ready: true, reports, missing };
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
