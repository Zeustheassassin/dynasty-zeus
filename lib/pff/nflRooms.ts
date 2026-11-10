// ============================================================
// NFL position rooms from PFF (lib/nflRooms.ts) — SERVER-ONLY.
// ============================================================
// About 35 reads: the team list, the prior season's team passing table and
// offense summary (every player, one read), and each team's depth chart.
//
// PFF's roster endpoint serves the LIVE depth chart whatever season is asked
// (checked 2026-11-10: season 2026 and 2027 gave the same Eagles chart; a past
// season gives an older one). So a load right after the draft captures the
// rooms after free agency and the draft, and a load in-season captures how
// the rookies have played; the Post-Draft tab warns about the latter. Grades
// and snap shares always come from the finished prior season.
// ============================================================

import { buildNflRooms, type NflRoomsResponse, type PffNflTeam, type PffOffenseRow, type PffRosterRow, type PffTeamPassingRow } from "../nflRooms";
import { logger } from "../logger";
import { PffError, type PffClient } from "./client";

const log = logger("lib/pff/nflRooms");

interface Rows<T> { rows?: T[] }

/** Every team's room for a draft year (see the header). Throws when the team list or the season's grades can't be read. */
export async function loadNflRooms(client: PffClient, year: number, now = new Date()): Promise<NflRoomsResponse> {
  const season = year - 1;
  const teams = (await client.get<Rows<PffNflTeam>>("/v2/nfl/teams", { season })).rows ?? [];
  if (!teams.length) throw new Error(`PFF has no NFL teams for ${season}`);
  const passing = (await client.get<Rows<PffTeamPassingRow>>("/v2/nfl/teams/stats", {
    season, category: "offense-passing", weekGroup: "REG",
  })).rows ?? [];
  const offense = (await client.get<{ offense_summary?: PffOffenseRow[] }>("/v1/facet/offense/summary", {
    league: "nfl", season,
  })).offense_summary ?? [];
  if (!offense.length) throw new Error(`PFF has no ${season} NFL grades yet`);

  const rosters = new Map<number, PffRosterRow[]>();
  for (const t of teams) {
    try {
      rosters.set(t.franchiseId, (await client.get<Rows<PffRosterRow>>(`/v2/nfl/teams/${t.franchiseId}/roster`, { season: year })).rows ?? []);
    } catch (err) {
      // The draft year's directory may not exist yet; the live chart is the same either way.
      if (err instanceof PffError && (err.status === 400 || err.status === 404)) {
        try {
          rosters.set(t.franchiseId, (await client.get<Rows<PffRosterRow>>(`/v2/nfl/teams/${t.franchiseId}/roster`, { season })).rows ?? []);
          continue;
        } catch (err2) {
          log.warn("depth chart not read", { team: t.name, err: String(err2) });
          continue;
        }
      }
      if (err instanceof PffError && err.status === 429) throw err;
      log.warn("depth chart not read", { team: t.name, err: String(err) });
    }
  }
  return buildNflRooms({ year, asOf: now.toISOString(), teams, passing, offense, rosters });
}
