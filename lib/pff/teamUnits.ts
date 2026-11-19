// A team's season units from PFF's season reports (line season grades plan,
// Stage 1, migration 103). Pure; client-safe (no key, no fetch).
//
// FULL-SEASON grades, never same-game ones: a same-game grade moves with the
// player's own day (a back who breaks tackles lifts his line's game grade, a
// receiver who torches a corner sinks that corner's), which is why the
// same-game cast (cast.ts) stays out of every score. A season grade barely
// moves from one game. His game is still inside the opponent's season (~1/12
// of it); accepted, no leave-one-out.
//
// Two reports per team-season, one read each (season + franchise_id, no
// week; checked 2026-11-19 on Virginia Tech 337 and Maryland 215, 2025):
//   /v1/facet/offense/run_blocking → { run_blocking: [...] }
//     every player with run-block snaps (QB / WR / TE / HB too); the line's
//     season positions are T / G / C.
//   /v1/facet/defense/summary      → { defense_summary: [...] }
//     every player with defensive snaps: DI / ED / LB / CB / S, plus the odd
//     offensive player with a snap or two. Alignment snaps (corner, slot, box,
//     fs, dl) add up to his defensive snaps.
// From them:
//   - OL run block: the linemen's run-block grades, weighted by run-block snaps.
//   - Front seven run defense: DI + ED + LB run-defense grades, weighted by
//     run-defense snaps.
//   - Coverage by alignment (outside / slot / box): each defender's coverage
//     grade, weighted by his coverage snaps from that spot, estimated as his
//     coverage snaps × his share of snaps there (PFF doesn't split coverage
//     snaps by alignment). A run-down linebacker with 400 box snaps but 50 in
//     coverage counts for ~45, not 400.
//   - Missed-tackle rate: misses ÷ (tackles + assists + misses) over every
//     defender, PFF's own per-player formula (checked: 5 / (19 + 16 + 5) = 12.5).
// PFF gives a player with a handful of snaps a default 60 and a 0 means "not
// graded" (cast.ts weightedGrade); snap weighting keeps either from counting.

import { round1, weightedGrade } from "./cast";

export type SeasonReport = "run_blocking" | "defense";

/** Where each report lives and the key its rows come under. */
export const SEASON_REPORTS: Record<SeasonReport, { path: string; key: string }> = {
  run_blocking: { path: "offense/run_blocking", key: "run_blocking" },
  defense: { path: "defense/summary", key: "defense_summary" },
};

/** One player's season run blocking, as stored (short keys). */
export interface PffRunBlockRow {
  id: number;
  name: string;
  pos: string;
  /** Games he played that season (PFF's player_game_count). Optional: absent on copies trimmed before it was kept. */
  gp?: number | null;
  /** Run-block snaps and grade; gap and zone splits kept for a later scheme match. */
  rb: number | null;
  g_rb: number | null;
  gap: number | null;
  g_gap: number | null;
  zone: number | null;
  g_zone: number | null;
}

/** One defender's season, as stored (short keys). */
export interface PffDefenseRow {
  id: number;
  name: string;
  pos: string;
  /** Games he played that season (PFF's player_game_count). */
  gp?: number | null;
  snaps: number | null;
  /** Run-defense snaps and grade. */
  rd: number | null;
  g_rd: number | null;
  /** Coverage snaps and grade. */
  cov: number | null;
  g_cov: number | null;
  /** Snaps by alignment: corner, slot, box, free safety, on the line. */
  corner: number | null;
  slot: number | null;
  box: number | null;
  fs: number | null;
  dl: number | null;
  /** Missed tackles, tackles, assists, and the tackling grade. */
  mt: number | null;
  tk: number | null;
  ast: number | null;
  g_tkl: number | null;
  /** Pass rush (not used yet; kept so a QB test needs no re-read). */
  pr: number | null;
  g_pr: number | null;
  press: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Rows with a player id, and of this franchise when PFF says which. */
function playerRows(raw: readonly Record<string, unknown>[], franchiseId?: number) {
  return raw.filter((r) => {
    if (num(r.player_id) == null) return false;
    const f = num(r.franchise_id);
    return franchiseId == null || f == null || f === franchiseId;
  });
}

const text = (v: unknown) => (typeof v === "string" ? v : "");

export function trimRunBlockingRows(raw: readonly Record<string, unknown>[], franchiseId?: number): PffRunBlockRow[] {
  return playerRows(raw, franchiseId).map((r) => ({
    id: num(r.player_id)!,
    name: text(r.player),
    pos: text(r.position),
    gp: num(r.player_game_count),
    rb: num(r.snap_counts_run_block),
    g_rb: num(r.grades_run_block),
    gap: num(r.gap_snap_counts_run_block),
    g_gap: num(r.gap_grades_run_block),
    zone: num(r.zone_snap_counts_run_block),
    g_zone: num(r.zone_grades_run_block),
  }));
}

export function trimDefenseRows(raw: readonly Record<string, unknown>[], franchiseId?: number): PffDefenseRow[] {
  return playerRows(raw, franchiseId).map((r) => ({
    id: num(r.player_id)!,
    name: text(r.player),
    pos: text(r.position),
    gp: num(r.player_game_count),
    snaps: num(r.snap_counts_defense),
    rd: num(r.snap_counts_run_defense),
    g_rd: num(r.grades_run_defense),
    cov: num(r.snap_counts_coverage),
    g_cov: num(r.grades_coverage_defense),
    corner: num(r.snap_counts_corner),
    slot: num(r.snap_counts_slot),
    box: num(r.snap_counts_box),
    fs: num(r.snap_counts_fs),
    dl: num(r.snap_counts_dl),
    mt: num(r.missed_tackles),
    tk: num(r.tackles),
    ast: num(r.assists),
    g_tkl: num(r.grades_tackle),
    pr: num(r.snap_counts_pass_rush),
    g_pr: num(r.grades_pass_rush_defense),
    press: num(r.total_pressures),
  }));
}

/** Season positions on the line (T / G / C; the game spots too, like cast.ts). */
export function isSeasonLineman(pos: string): boolean {
  return /^(L|R)?(T|G)$|^C$|^OL$/.test(pos.toUpperCase());
}

const FRONT_SEVEN = new Set(["DI", "ED", "LB", "DL", "DT", "NT", "DE", "EDGE", "OLB", "ILB", "MLB"]);
const SECONDARY = new Set(["CB", "S", "FS", "SS", "DB"]);

/** Interior line, edge and linebackers (and the older position names). */
export function isFrontSeven(pos: string): boolean {
  return FRONT_SEVEN.has(pos.toUpperCase());
}

/** A defensive position: the front seven or the secondary (not an offensive player's stray snap). */
export function isDefender(pos: string): boolean {
  return isFrontSeven(pos) || SECONDARY.has(pos.toUpperCase());
}

/** A grade and the snaps behind it (0 snaps → grade null). */
export interface GradeWeight {
  grade: number | null;
  snaps: number;
}

export function olRunBlock(rows: readonly PffRunBlockRow[]): GradeWeight {
  return weightedGrade(rows.filter((r) => isSeasonLineman(r.pos)), (r) => r.rb, (r) => r.g_rb);
}

export function frontSevenRunDefense(rows: readonly PffDefenseRow[]): GradeWeight {
  return weightedGrade(rows.filter((r) => isFrontSeven(r.pos)), (r) => r.rd, (r) => r.g_rd);
}

export type CoverageSpot = "outside" | "slot" | "box";

/** His coverage snaps from one spot: coverage snaps × his share of snaps there. */
export function coverageSnapsAt(r: PffDefenseRow, spot: CoverageSpot): number {
  const at = spot === "outside" ? r.corner : spot === "slot" ? r.slot : r.box;
  const all = (r.corner ?? 0) + (r.slot ?? 0) + (r.box ?? 0) + (r.fs ?? 0) + (r.dl ?? 0);
  if (!(all > 0) || !((at ?? 0) > 0) || !((r.cov ?? 0) > 0)) return 0;
  return (r.cov! * at!) / all;
}

export function coverageByAlignment(rows: readonly PffDefenseRow[]): Record<CoverageSpot, GradeWeight> {
  const at = (spot: CoverageSpot) => {
    const w = weightedGrade(rows.filter((r) => isDefender(r.pos)), (r) => coverageSnapsAt(r, spot), (r) => r.g_cov);
    return { grade: w.grade, snaps: Math.round(w.snaps) };
  };
  return { outside: at("outside"), slot: at("slot"), box: at("box") };
}

/** The defense's missed-tackle rate (%), and the tackle attempts behind it. */
export function missedTackleRate(rows: readonly PffDefenseRow[]): { rate: number | null; attempts: number } {
  let mt = 0, att = 0;
  for (const r of rows) {
    if (!isDefender(r.pos)) continue;
    const m = r.mt ?? 0;
    mt += m;
    att += m + (r.tk ?? 0) + (r.ast ?? 0);
  }
  return { rate: att > 0 ? round1((100 * mt) / att) : null, attempts: att };
}

export interface DefenseUnits {
  frontSeven: GradeWeight;
  coverage: Record<CoverageSpot, GradeWeight>;
  missedTackles: { rate: number | null; attempts: number };
}

export function defenseUnits(rows: readonly PffDefenseRow[]): DefenseUnits {
  return { frontSeven: frontSevenRunDefense(rows), coverage: coverageByAlignment(rows), missedTackles: missedTackleRate(rows) };
}

/**
 * Games PFF charted the team that season: the most any of its players
 * played. PFF charts every FBS game, so an FCS team's report covers only its
 * games against FBS teams (one or two, maybe just the charted game itself).
 */
export function reportGames(rows: readonly { gp?: number | null }[]): number | null {
  let most = 0;
  for (const r of rows) if ((r.gp ?? 0) > most) most = r.gp!;
  return most > 0 ? most : null;
}

/**
 * A season grade from fewer games than this isn't used as context: from one
 * or two games it's close to the same game's grade (the thing the plan
 * avoids), and early in a season it's noise. FBS teams play 12–15.
 */
export const MIN_SEASON_GAMES = 6;

// ── Leaving his game out ─────────────────────────────────────
// A season grade still holds the charted game itself (~1/12 of it), and his
// play moves it: a back who breaks tackles raises the opponent's missed-tackle
// rate and lowers its front seven's grades. The read-only run of 2026-11-19
// showed it inflating every effect (RB MTF vs MT rate: +8.2% held out with the
// game in, +1.5% with it out). So each game's units come from the season
// MINUS that game, player by player: counts subtract; a grade comes back out
// of its snap-weighted mean, (S·gS − s·gs) / (S − s). PFF's season grade
// isn't exactly that mean, so it's a close approximation.
//
// The game's rows: `/v1/facet/defense/summary?game_id=` (both teams' defenders,
// at their GAME spots, so they're matched to the season rows by player id),
// kept per user in pff_game_defense; his own line's from the offense facet
// already kept for the cast (pff_game_offense).

/** One defender's game, as stored: the season row's fields plus his team. */
export interface PffGameDefenseRow extends PffDefenseRow {
  team: number;
}

export function trimGameDefenseRows(raw: readonly Record<string, unknown>[]): PffGameDefenseRow[] {
  const out: PffGameDefenseRow[] = [];
  for (const r of raw) {
    const team = num(r.franchise_id);
    const [row] = trimDefenseRows([r]);
    if (team == null || !row) continue;
    out.push({ ...row, team });
  }
  return out;
}

/** A season mean grade with one game taken back out; null when nothing's left. */
export function gradeWithout(S: number | null, gS: number | null, s: number | null, gs: number | null): number | null {
  const SS = S ?? 0, ss = s ?? 0;
  if (gS == null || !(SS > 0)) return null;
  if (!(ss > 0) || gs == null || gs <= 0) return gS;
  if (SS - ss <= 0) return null;
  return Math.min(100, Math.max(0, (SS * gS - ss * gs) / (SS - ss)));
}

const minus = (a: number | null, b: number | null | undefined) => (a == null ? null : Math.max(0, a - (b ?? 0)));
const gpWithout = (gp: number | null | undefined, played: boolean) => (gp == null ? gp : played ? Math.max(0, gp - 1) : gp);

/** The opponent's season defense with one game's rows taken out (match by player id). */
export function defenseWithoutGame(season: readonly PffDefenseRow[], game: readonly PffDefenseRow[]): PffDefenseRow[] {
  const inGame = new Map(game.map((r) => [r.id, r]));
  return season.map((x) => {
    const y = inGame.get(x.id);
    if (!y) return x;
    return {
      ...x,
      gp: gpWithout(x.gp, (y.snaps ?? 0) > 0),
      snaps: minus(x.snaps, y.snaps),
      rd: minus(x.rd, y.rd), g_rd: gradeWithout(x.rd, x.g_rd, y.rd, y.g_rd),
      cov: minus(x.cov, y.cov), g_cov: gradeWithout(x.cov, x.g_cov, y.cov, y.g_cov),
      corner: minus(x.corner, y.corner), slot: minus(x.slot, y.slot), box: minus(x.box, y.box), fs: minus(x.fs, y.fs), dl: minus(x.dl, y.dl),
      mt: minus(x.mt, y.mt), tk: minus(x.tk, y.tk), ast: minus(x.ast, y.ast),
      pr: minus(x.pr, y.pr), g_pr: gradeWithout(x.pr, x.g_pr, y.pr, y.g_pr), press: minus(x.press, y.press),
    };
  });
}

/** His team's season run blocking with one game taken out (the game's offense facet rows, cast.ts). */
export function runBlockingWithoutGame(
  season: readonly PffRunBlockRow[],
  game: readonly { id: number; snaps: number | null; rb: number | null; g_rb: number | null }[],
): PffRunBlockRow[] {
  const inGame = new Map(game.map((r) => [r.id, r]));
  return season.map((x) => {
    const y = inGame.get(x.id);
    if (!y) return x;
    return { ...x, gp: gpWithout(x.gp, (y.snaps ?? 0) > 0), rb: minus(x.rb, y.rb), g_rb: gradeWithout(x.rb, x.g_rb, y.rb, y.g_rb) };
  });
}

/**
 * PFF's grading of a game settles within days; a game is taken out only once
 * it's this old, and only from a season report read after that (an earlier
 * copy may not hold it yet, so there's nothing to take out).
 */
export const GAME_SETTLED_MS = 10 * 86_400_000;

export function gameSettledBy(kickoff: string | null | undefined, at: string | number): boolean {
  if (!kickoff) return true;
  const k = Date.parse(kickoff), t = typeof at === "number" ? at : Date.parse(at);
  return !Number.isFinite(k) || (Number.isFinite(t) && t >= k + GAME_SETTLED_MS);
}

// ── When to read a report again ──────────────────────────────

/** A season's reports stop changing once its bowls are played: a copy read on or after Feb 1 of the next year is final. */
export function seasonReportFinal(season: number, fetchedAt: string | number): boolean {
  const at = typeof fetchedAt === "number" ? fetchedAt : Date.parse(fetchedAt);
  return Number.isFinite(at) && at >= Date.UTC(season + 1, 1, 1);
}

/** The season in progress is read again once its copy is a week old. */
export const SEASON_REPORT_REFRESH_MS = 7 * 86_400_000;

export function seasonReportStale(season: number, fetchedAt: string | number | null | undefined, now = Date.now()): boolean {
  if (fetchedAt == null) return true;
  const at = typeof fetchedAt === "number" ? fetchedAt : Date.parse(fetchedAt);
  if (!Number.isFinite(at)) return true;
  return !seasonReportFinal(season, at) && now - at > SEASON_REPORT_REFRESH_MS;
}
