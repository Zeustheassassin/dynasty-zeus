// NFL position rooms for Dynasty+'s team inputs (stage 4 of the landing-spot
// plan): each team's QB / RB / WR / TE on PFF's live depth chart, with the
// prior season's PFF grades and snap shares, and the prior season's pass rate
// over expectation and target shares. Built by POST /api/scouting/nfl-rooms
// (lib/pff/nflRooms.ts reads PFF); the Post-Draft tab saves each drafted
// prospect's own room on his row (prospects.landing_inputs, migration 091),
// and lib/scouting/teamLanding.ts suggests his inputs from it.
//
// Types and pure functions only: safe to import from client code.

import { nflTeamId } from "./nflDraft";

export type RoomPos = "QB" | "RB" | "WR" | "TE";
export const ROOM_POSITIONS: readonly RoomPos[] = ["QB", "RB", "WR", "TE"];

/** One player on a team's live depth chart. */
export interface RoomPlayer {
  pffId: number;
  name: string;
  pos: RoomPos;
  /** Depth order in his slot (1 = first); the lowest over his slots. */
  depth: number;
  /** In his first season (PFF eligibility year ≥ the draft year): this draft's
   *  rookies and undrafted signings. Rookie competition counts drafted ones. */
  rookie: boolean;
  /** Prior-season PFF offense grade; null without graded snaps. */
  grade: number | null;
  /** Prior-season PFF passing grade (QBs); null without one. */
  passGrade: number | null;
  /** Share of his prior-season team's offensive snaps, 0–1; null without snaps. */
  share: number | null;
  /** YYYY-MM-DD, when PFF has it. */
  birthDate: string | null;
}

/**
 * A position's grade bars for the prior season, from its regulars (players on
 * REGULAR_SHARE or more of their team's snaps): `regular` is their bottom
 * quarter (a drafted rookie is expected to pass a regular graded below it),
 * `star` their top quarter (counts even after an injury-shortened season).
 */
export interface PositionBar { regular: number; star: number }

export interface NflTeamRoom {
  /** ESPN's team id (lib/nflDraft.ts), the id prospects' draft_team resolves to. */
  teamId: number;
  /** "Philadelphia Eagles". */
  name: string;
  players: RoomPlayer[];
  /** Prior-season pass rate over expectation (0.045 = +4.5%); null when PFF has none. */
  passOe: number | null;
  /** Prior-season share of plays that were passes, 0–1. */
  passPct: number | null;
  /** Prior-season share of targets by position, 0–1. */
  targetShare: { RB: number | null; WR: number | null; TE: number | null };
}

/** POST /api/scouting/nfl-rooms's answer. */
export interface NflRoomsResponse {
  /** The draft year whose rooms these are. */
  year: number;
  /** The season the grades, snaps and pass rates come from (year − 1). */
  season: number;
  /** When the depth charts were read (ISO). */
  asOf: string;
  bars: Record<RoomPos, PositionBar | null>;
  teams: NflTeamRoom[];
  /** Teams whose depth chart couldn't be read, by name. */
  missing: string[];
}

// ── PFF row shapes (only the fields read here) ──────────────────────────────

/** /v2/nfl/teams row. */
export interface PffNflTeam { franchiseId: number; name: string }
/** /v2/nfl/teams/stats?category=offense-passing row. */
export interface PffTeamPassingRow {
  teamId: number;
  name: string;
  isPassOe?: number | null;
  passPlayPct?: number | null;
  targetShareWR?: number | null;
  targetShareTE?: number | null;
  targetShareRB?: number | null;
}
/** /v1/facet/offense/summary row. */
export interface PffOffenseRow {
  player_id: number;
  franchise_id?: number | null;
  position?: string | null;
  grades_offense?: number | null;
  grades_pass?: number | null;
  snap_counts_total?: number | null;
}
/** /v2/nfl/teams/{team}/roster row. */
export interface PffRosterRow {
  playerId: number;
  name: string;
  position?: string | null;
  depthOrder?: number | null;
  eligibilityYear?: number | null;
  birthDate?: string | null;
}

/** PFF's position code as a room position: HB is a running back; FB and everything else isn't a room. */
export function roomPos(code: string | null | undefined): RoomPos | null {
  switch ((code ?? "").toUpperCase()) {
    case "QB": return "QB";
    case "HB": case "RB": return "RB";
    case "WR": return "WR";
    case "TE": return "TE";
    default: return null;
  }
}

/** Snap share that makes a player one of his position's regulars. */
export const REGULAR_SHARE = 0.4;

const quantile = (sorted: readonly number[], p: number) => sorted[Math.floor(p * (sorted.length - 1))];

/** Each position's grade bars from a season's offense summary (see PositionBar). */
export function positionBars(rows: readonly PffOffenseRow[]): Record<RoomPos, PositionBar | null> {
  const shares = snapShares(rows);
  const out = { QB: null, RB: null, WR: null, TE: null } as Record<RoomPos, PositionBar | null>;
  for (const pos of ROOM_POSITIONS) {
    const grades = rows
      .filter((r) => roomPos(r.position) === pos && r.grades_offense != null && (shares.get(r.player_id) ?? 0) >= REGULAR_SHARE)
      .map((r) => r.grades_offense!)
      .sort((a, b) => a - b);
    if (grades.length >= 4) out[pos] = { regular: quantile(grades, 0.25), star: quantile(grades, 0.75) };
  }
  return out;
}

/** Each player's share of his team's offensive snaps: his snaps over the most any teammate played. */
export function snapShares(rows: readonly PffOffenseRow[]): Map<number, number> {
  const teamMax = new Map<number, number>();
  for (const r of rows) {
    if (r.franchise_id == null) continue;
    teamMax.set(r.franchise_id, Math.max(teamMax.get(r.franchise_id) ?? 0, r.snap_counts_total ?? 0));
  }
  const out = new Map<number, number>();
  for (const r of rows) {
    const max = r.franchise_id != null ? teamMax.get(r.franchise_id) : undefined;
    if (max && r.snap_counts_total) out.set(r.player_id, Math.min(1, r.snap_counts_total / max));
  }
  return out;
}

const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * The rooms of every team whose depth chart was read, joined with the prior
 * season's grades and snap shares (by PFF player id, so a veteran who changed
 * teams brings his grade along) and team pass rates (by team name).
 */
export function buildNflRooms(input: {
  year: number;
  asOf: string;
  teams: readonly PffNflTeam[];
  passing: readonly PffTeamPassingRow[];
  offense: readonly PffOffenseRow[];
  /** Depth-chart rows by PFF franchise id; a team without an entry is missing. */
  rosters: ReadonlyMap<number, readonly PffRosterRow[]>;
}): NflRoomsResponse {
  const { year, asOf, teams, passing, offense, rosters } = input;
  const shares = snapShares(offense);
  const graded = new Map(offense.map((r) => [r.player_id, r]));
  const passingByTeam = new Map<number, PffTeamPassingRow>();
  for (const r of passing) {
    const id = nflTeamId(r.name);
    if (id != null) passingByTeam.set(id, r);
  }

  const out: NflTeamRoom[] = [];
  const missing: string[] = [];
  for (const t of teams) {
    const teamId = nflTeamId(t.name);
    if (teamId == null) continue;
    const roster = rosters.get(t.franchiseId);
    if (!roster) { missing.push(t.name); continue; }
    const byId = new Map<number, RoomPlayer>();
    for (const r of roster) {
      const pos = roomPos(r.position);
      if (!pos) continue;
      const depth = r.depthOrder ?? 99;
      const seen = byId.get(r.playerId);
      if (seen) { seen.depth = Math.min(seen.depth, depth); continue; }
      const g = graded.get(r.playerId);
      byId.set(r.playerId, {
        pffId: r.playerId,
        name: r.name,
        pos,
        depth,
        rookie: r.eligibilityYear != null && r.eligibilityYear >= year,
        grade: num(g?.grades_offense),
        passGrade: pos === "QB" ? num(g?.grades_pass) : null,
        share: shares.get(r.playerId) ?? null,
        birthDate: r.birthDate ?? null,
      });
    }
    const pass = passingByTeam.get(teamId);
    out.push({
      teamId,
      name: t.name,
      players: [...byId.values()].sort((a, b) => a.depth - b.depth || (b.grade ?? -1) - (a.grade ?? -1)),
      passOe: num(pass?.isPassOe),
      passPct: num(pass?.passPlayPct),
      targetShare: { RB: num(pass?.targetShareRB), WR: num(pass?.targetShareWR), TE: num(pass?.targetShareTE) },
    });
  }
  return { year, season: year - 1, asOf, bars: positionBars(offense), teams: out, missing };
}
