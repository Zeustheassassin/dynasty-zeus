// ============================================================
// Import PFF's stats for one prospect's matched charted games — SERVER-ONLY.
// ============================================================
// Reads only the games the user charted (Stage 1's links), never season
// totals. Per season of charted games:
//   1. the season's schedule (cached, ncaa.ts) gives each PFF game's week;
//   2. each weekly player report, asked for just those weeks, returns his row
//      in each charted game plus PFF's aggregate over exactly them;
//   3. the season-level reports (play action, blitz, 20+ yard targets) are
//      asked for the same weeks and come back as one aggregate row;
//   4. WR / TE: his team's man / zone facet and passers' facet over those
//      weeks give his man / zone split and the team's dropbacks.
// Calls per prospect-season: QB 5, RB 3, WR / TE 5 (+ the cached schedule).
// A charted game PFF has no row for (not graded yet) is reported as missing
// and left out of every number, the aggregates included.
// ============================================================

import { logger } from "../logger";
import type { PffClient } from "./client";
import { playerAggregate, playerWeeks, seasonTeams, teamFacet, type PffStatRow } from "./ncaa";
import {
  AGGREGATE_REPORTS, extractGameStats, extractSeasonStats, NEEDS_TEAM_FACETS, WEEKLY_REPORTS,
  type PffGameStats, type PffPos, type PffReportKey, type PffSeasonStats,
} from "./stats";

const log = logger("lib/pff/runImport");

export interface GameToImport {
  id: string;
  season_year: number;
  pff_game_id: number;
}

export interface ImportedGame {
  gameId: string;
  pffGameId: number;
  season: number;
  week: number;
  franchiseId: number | null;
  position: string | null;
  stats: PffGameStats;
  raw: Partial<Record<PffReportKey, PffStatRow>>;
}

export interface ImportedSeason {
  season: number;
  /** The PFF games the aggregate covers (the imported ones), ascending. */
  pffGameIds: number[];
  weeks: number[];
  franchiseIds: number[];
  stats: PffSeasonStats;
  raw: Partial<Record<PffReportKey, PffStatRow | PffStatRow[]>>;
}

export interface MissingGame {
  gameId: string;
  reason: string;
}

export interface ProspectImport {
  games: ImportedGame[];
  seasons: ImportedSeason[];
  missing: MissingGame[];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ascending = (xs: Iterable<number>) => [...new Set(xs)].sort((a, b) => a - b);

/** week_totals is one row per team he played for in those weeks: one in college. */
function oneTotal(rows: PffStatRow[], context: string): PffStatRow | null {
  if (rows.length <= 1) return rows[0] ?? null;
  log.warn("PFF returned more than one aggregate row; using the one with the most games", { context, rows: rows.length });
  return [...rows].sort((a, b) => (num(b.player_game_count) ?? 0) - (num(a.player_game_count) ?? 0))[0];
}

export async function importProspect(
  client: PffClient,
  pos: PffPos,
  playerId: number,
  games: readonly GameToImport[],
): Promise<ProspectImport> {
  const out: ProspectImport = { games: [], seasons: [], missing: [] };
  const seasons = ascending(games.map((g) => g.season_year));

  for (const season of seasons) {
    const schedule = await seasonTeams(client, season);
    const weekOf = new Map(schedule.games.map((g) => [g.id, g.week]));
    const planned: { game: GameToImport; week: number }[] = [];
    for (const game of games.filter((g) => g.season_year === season)) {
      const week = weekOf.get(game.pff_game_id);
      if (week == null) out.missing.push({ gameId: game.id, reason: `PFF game ${game.pff_game_id} isn't on PFF's ${season} schedule` });
      else planned.push({ game, week });
    }
    if (planned.length === 0) continue;
    const pffIds = new Set(planned.map((p) => p.game.pff_game_id));

    // His row in each charted game, by report, and PFF's total over them.
    const rowsByGame = new Map<number, Partial<Record<PffReportKey, PffStatRow>>>();
    const totals: Partial<Record<PffReportKey, PffStatRow>> = {};
    for (const [path, key] of WEEKLY_REPORTS[pos]) {
      const r = await playerWeeks(client, path, key, playerId, season, ascending(planned.map((p) => p.week)));
      for (const row of r.weeks) {
        const gid = num(row.game_id) ?? num((row.game as PffStatRow | undefined)?.game_id);
        if (gid == null) continue;
        if (!pffIds.has(gid)) {
          // Can't happen for a game matched from his own log (one game a week);
          // logged so a total that covers an extra game gets noticed.
          log.warn("PFF row for a game that wasn't asked for", { playerId, season, gid, report: key });
          continue;
        }
        rowsByGame.set(gid, { ...rowsByGame.get(gid), [key]: row });
      }
      const total = oneTotal(r.totals, `${playerId} ${season} ${key}`);
      if (total) totals[key] = total;
    }

    const imported: ImportedGame[] = [];
    for (const { game, week } of planned) {
      const rows = rowsByGame.get(game.pff_game_id);
      if (!rows) {
        out.missing.push({ gameId: game.id, reason: "PFF has no stats for him in this game yet" });
        continue;
      }
      const any = Object.values(rows)[0] as PffStatRow;
      imported.push({
        gameId: game.id,
        pffGameId: game.pff_game_id,
        season,
        week,
        franchiseId: num(any.player_franchise_id),
        position: typeof any.position === "string" ? any.position : null,
        stats: extractGameStats(rows),
        raw: rows,
      });
    }
    if (imported.length === 0) continue;
    out.games.push(...imported);

    // The rest is asked for the imported games' weeks only, so every
    // aggregate covers the same games as the per-game rows.
    const weeks = ascending(imported.map((g) => g.week));
    for (const [path, key] of AGGREGATE_REPORTS[pos]) {
      const row = await playerAggregate(client, path, key, playerId, season, weeks);
      if (row) totals[key] = row;
    }

    const franchiseIds = ascending(imported.map((g) => g.franchiseId).filter((f): f is number => f != null));
    const scheme: PffStatRow[] = [];
    const teamPassing: PffStatRow[] = [];
    if (NEEDS_TEAM_FACETS[pos]) {
      for (const franchiseId of franchiseIds) {
        const fw = ascending(imported.filter((g) => g.franchiseId === franchiseId).map((g) => g.week));
        const mine = (await teamFacet(client, "receiving/scheme", "receiving_scheme", season, fw, franchiseId))
          .find((r) => num(r.player_id) === playerId);
        if (mine) scheme.push(mine);
        const passers = await teamFacet(client, "passing/summary", "passing_summary", season, fw, franchiseId);
        teamPassing.push(...passers.filter((r) => num(r.franchise_id) == null || num(r.franchise_id) === franchiseId));
      }
    }

    out.seasons.push({
      season,
      pffGameIds: ascending(imported.map((g) => g.pffGameId)),
      weeks,
      franchiseIds,
      stats: extractSeasonStats(totals, scheme, teamPassing),
      raw: { ...totals, ...(NEEDS_TEAM_FACETS[pos] ? { receiving_scheme: scheme, team_passing: teamPassing } : {}) },
    });
  }
  return out;
}
