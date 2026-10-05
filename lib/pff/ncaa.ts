// ============================================================
// PFF NCAA endpoints used for matching — SERVER-ONLY (lib/pff/client.ts).
// ============================================================
// Shapes checked against real responses on 2026-10-04:
//   /v1/players?league=ncaa&name=…          { players: PffPlayer[] }
//   /v1/player/offense/summary?…&season=…   { offense_summary: { weeks: PffWeekRow[], … } }
//     one row per game he has snaps in; team names are PFF's six-letter codes
//     ("OHIOST"), so names come from the season's team list
//   /v1/teams?league=ncaa&season=…          { teams, franchise_groups, games } (~830 KB)
//   /v1/games?league=ncaa&season&week&franchise_id   { games: PffGameInfo[] } (has_stats)
// ============================================================

import { PffError, type PffClient } from "./client";

export interface PffTeamRef {
  id: number;
  abbreviation: string;
  city: string;
  nickname: string;
}

export interface PffPlayer {
  id: number;
  first_name: string;
  last_name: string;
  position: string;
  /** YYYY-MM-DD; often null for NCAA. */
  dob: string | null;
  /** Feet and inches as one number: 602 = 6'2". */
  height: number | null;
  weight: number | null;
  current_class: string | null;
  current_eligible_year: number | null;
  /** His CURRENT team. */
  team: PffTeamRef | null;
}

/** One game of a player's week-by-week report. Stat columns vary by report. */
export interface PffWeekRow {
  game_id: number;
  week: number;
  player_franchise_id: number;
  home_franchise_id: number;
  away_franchise_id: number;
  home_team_name: string;
  away_team_name: string;
  position?: string;
  [stat: string]: unknown;
}

export interface PffTeam {
  franchise_id: number;
  abbreviation: string;
  city: string;
  nickname: string;
}

export interface PffScheduleGame {
  id: number;
  home_franchise_id: number;
  away_franchise_id: number;
  week: number;
  start: string;
}

export interface PffSeasonTeams {
  teams: Map<number, PffTeam>;
  games: PffScheduleGame[];
}

export interface PffGameInfo {
  id: number;
  week: number;
  season: number;
  start: string;
  home_franchise_id: number;
  away_franchise_id: number;
  /** False when PFF hasn't charted the game. */
  has_stats: boolean;
  lock_status?: string;
}

/** Free-text directory search (PFF forwards `name` as its `q`). */
export async function searchPlayers(client: PffClient, name: string): Promise<PffPlayer[]> {
  const body = await client.get<{ players?: PffPlayer[] }>("/v1/players", { league: "ncaa", name });
  return body.players ?? [];
}

export async function getPlayer(client: PffClient, id: number): Promise<PffPlayer | null> {
  const body = await client.get<{ players?: PffPlayer[] }>("/v1/players", { league: "ncaa", id });
  return body.players?.[0] ?? null;
}

/** His offensive rows for one season, one per game he played. [] when PFF has none. */
export async function offenseWeeks(client: PffClient, playerId: number, season: number): Promise<PffWeekRow[]> {
  try {
    const body = await client.get<{ offense_summary?: { weeks?: PffWeekRow[] } }>(
      "/v1/player/offense/summary", { league: "ncaa", player_id: playerId, season },
    );
    return body.offense_summary?.weeks ?? [];
  } catch (err) {
    if (err instanceof PffError && err.status === 404) return [];
    throw err;
  }
}

// The season team list is ~830 KB and the same for everyone, so a warm server
// instance keeps it for half a day (and shares one in-flight fetch).
const TEAMS_TTL_MS = 12 * 60 * 60_000;
const teamsCache = new Map<number, { at: number; value: Promise<PffSeasonTeams> }>();

export function seasonTeams(client: PffClient, season: number, now = Date.now()): Promise<PffSeasonTeams> {
  const hit = teamsCache.get(season);
  if (hit && now - hit.at < TEAMS_TTL_MS) return hit.value;
  const value = client
    .get<{ teams?: PffTeam[]; games?: PffScheduleGame[] }>("/v1/teams", { league: "ncaa", season })
    .then((body) => ({
      teams: new Map((body.teams ?? []).map((t) => [t.franchise_id, {
        franchise_id: t.franchise_id, abbreviation: t.abbreviation, city: t.city, nickname: t.nickname,
      }])),
      games: (body.games ?? []).map((g) => ({
        id: g.id, home_franchise_id: g.home_franchise_id, away_franchise_id: g.away_franchise_id, week: g.week, start: g.start,
      })),
    }));
  teamsCache.set(season, { at: now, value });
  value.catch(() => teamsCache.delete(season));
  return value;
}

// ── Stats for a set of weeks (Stage 2 import) ────────────────
// The `week` filter takes a comma-separated list (checked 2026-10-05). A
// player report then returns his row for each of those games (`weeks`) and
// PFF's own aggregate over exactly them (`week_totals`); the reports PFF keeps
// season-level (passing/concept, passing/pressure, receiving/depth) return
// just the aggregate, as a one-row list. Facets with season + weeks +
// franchise return every player of that team aggregated over those weeks.

export type PffStatRow = Record<string, unknown>;

/** The response's report object: the known key, else the only key. */
function reportBody(body: unknown, key: string): unknown {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  if (key in obj) return obj[key];
  const keys = Object.keys(obj).filter((k) => k !== "restricted");
  return keys.length === 1 ? obj[keys[0]] : null;
}

async function getOrEmpty<T>(run: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof PffError && err.status === 404) return empty;
    throw err;
  }
}

/** His rows for the given weeks of one season, and PFF's total over them. */
export async function playerWeeks(
  client: PffClient, path: string, key: string, playerId: number, season: number, weeks: readonly number[],
): Promise<{ weeks: PffStatRow[]; totals: PffStatRow[] }> {
  return getOrEmpty(async () => {
    const body = await client.get(`/v1/player/${path}`, { league: "ncaa", player_id: playerId, season, week: weeks.join(",") });
    const r = reportBody(body, key) as { weeks?: PffStatRow[]; week_totals?: PffStatRow[] } | null;
    return { weeks: r?.weeks ?? [], totals: r?.week_totals ?? [] };
  }, { weeks: [], totals: [] });
}

/** A season-level report aggregated over the given weeks (one row, or none). */
export async function playerAggregate(
  client: PffClient, path: string, key: string, playerId: number, season: number, weeks: readonly number[],
): Promise<PffStatRow | null> {
  return getOrEmpty(async () => {
    const body = await client.get(`/v1/player/${path}`, { league: "ncaa", player_id: playerId, season, week: weeks.join(",") });
    const r = reportBody(body, key);
    return Array.isArray(r) ? ((r[0] as PffStatRow | undefined) ?? null) : null;
  }, null);
}

/** Every player of one team, aggregated over the given weeks of one season. */
export async function teamFacet(
  client: PffClient, path: string, key: string, season: number, weeks: readonly number[], franchiseId: number,
): Promise<PffStatRow[]> {
  return getOrEmpty(async () => {
    const body = await client.get(`/v1/facet/${path}`, { league: "ncaa", season, week: weeks.join(","), franchise_id: franchiseId });
    const r = reportBody(body, key);
    return Array.isArray(r) ? (r as PffStatRow[]) : [];
  }, []);
}

/** Every offensive player of BOTH teams in one game, with that game's snaps
 *  and grades (Stage 5 supporting cast; PFF ignores franchise_id here). */
export async function gameOffense(client: PffClient, gameId: number): Promise<PffStatRow[]> {
  return getOrEmpty(async () => {
    const body = await client.get("/v1/facet/offense/summary", { league: "ncaa", game_id: gameId });
    const r = reportBody(body, "offense_summary");
    return Array.isArray(r) ? (r as PffStatRow[]) : [];
  }, []);
}

/** A team's game(s) in one week, with whether PFF has charted them. */
export async function weekGames(client: PffClient, season: number, week: number, franchiseId: number): Promise<PffGameInfo[]> {
  const body = await client.get<{ games?: PffGameInfo[] }>("/v1/games", {
    league: "ncaa", season, week, franchise_id: franchiseId,
  });
  return body.games ?? [];
}
