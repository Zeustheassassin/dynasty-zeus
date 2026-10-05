// A charted game's supporting cast, from PFF's offense facet for that game
// (tape-grading expansion, Stage 5). Pure; client-safe (no key, no fetch).
//
// One read, `/v1/facet/offense/summary?league=ncaa&game_id=`, returns every
// offensive player of BOTH teams in the game (PFF ignores franchise_id with a
// game_id; checked 2026-10-05) with his snaps and that game's grades. From
// his team's rows:
//   - the offensive line's pass-block and run-block grades, each the average
//     of the linemen's game grades weighted by their pass-block / run-block
//     snaps (a lineman with no such snaps, or no grade, doesn't count);
//   - his quarterback's passing grade: the QB with the most dropbacks, never
//     the prospect himself;
//   - the team's offensive snaps (the most any of its players played), which
//     with his own snaps gives the snap share behind the left-early flag.
// PFF data, so stored per user only (pff_game_offense / scouting_game_context).

/** One player's row as stored (short keys: ~35 rows per game). */
export interface PffOffenseRow {
  id: number;
  name: string;
  pos: string;
  team: number;
  snaps: number | null;
  /** Dropbacks / designed runs he was on the field for, as PFF counts them. */
  pass: number | null;
  run: number | null;
  /** Pass-block and run-block snaps. */
  pb: number | null;
  rb: number | null;
  g_pb: number | null;
  g_rb: number | null;
  g_pass: number | null;
  g_off: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** PFF's facet rows → stored rows (players without an id or team are dropped). */
export function trimOffenseRows(raw: readonly Record<string, unknown>[]): PffOffenseRow[] {
  const out: PffOffenseRow[] = [];
  for (const r of raw) {
    const id = num(r.player_id), team = num(r.franchise_id);
    if (id == null || team == null) continue;
    out.push({
      id,
      name: typeof r.player === "string" ? r.player : "",
      pos: typeof r.position === "string" ? r.position : "",
      team,
      snaps: num(r.snap_counts_total),
      pass: num(r.snap_counts_pass),
      run: num(r.snap_counts_run),
      pb: num(r.snap_counts_pass_block),
      rb: num(r.snap_counts_run_block),
      g_pb: num(r.grades_pass_block),
      g_rb: num(r.grades_run_block),
      g_pass: num(r.grades_pass),
      g_off: num(r.grades_offense),
    });
  }
  return out;
}

/** Game spots PFF gives linemen (LT, LG, C, RG, RT; T / G / OL in older games). */
export function isLineman(pos: string): boolean {
  return /^(L|R)?(T|G)$|^C$|^OL$/.test(pos.toUpperCase());
}

export interface TeamCast {
  /** The team's offensive snaps (the most any of its players played). */
  teamSnaps: number | null;
  olPassBlock: number | null;
  olPassBlockSnaps: number;
  olRunBlock: number | null;
  olRunBlockSnaps: number;
  /** His quarterback (most dropbacks, not the prospect himself). */
  qbPassGrade: number | null;
  qbName: string | null;
  qbPlayerId: number | null;
  qbDropbacks: number | null;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Snap-weighted mean grade; a 0 grade on a handful of snaps is PFF's "not graded", not a real 0. */
function weightedGrade(rows: readonly PffOffenseRow[], snaps: (r: PffOffenseRow) => number | null, grade: (r: PffOffenseRow) => number | null) {
  let s = 0, sg = 0;
  for (const r of rows) {
    const n = snaps(r) ?? 0, g = grade(r);
    if (!(n > 0) || g == null || g <= 0) continue;
    s += n; sg += n * g;
  }
  return { grade: s > 0 ? round1(sg / s) : null, snaps: s };
}

/** His team's supporting cast in one game. `excludePlayerId` = the prospect's PFF id. */
export function teamCast(rows: readonly PffOffenseRow[], franchiseId: number, excludePlayerId?: number | null): TeamCast {
  const team = rows.filter((r) => r.team === franchiseId);
  const line = team.filter((r) => isLineman(r.pos));
  const pb = weightedGrade(line, (r) => r.pb, (r) => r.g_pb);
  const rb = weightedGrade(line, (r) => r.rb, (r) => r.g_rb);
  const qb = team
    .filter((r) => r.pos.toUpperCase() === "QB" && r.id !== excludePlayerId && (r.pass ?? 0) > 0)
    .sort((a, b) => (b.pass ?? 0) - (a.pass ?? 0))[0];
  const snaps = team.map((r) => r.snaps ?? 0);
  return {
    teamSnaps: snaps.length ? Math.max(...snaps) || null : null,
    olPassBlock: pb.grade, olPassBlockSnaps: pb.snaps,
    olRunBlock: rb.grade, olRunBlockSnaps: rb.snaps,
    qbPassGrade: qb?.g_pass ?? null,
    qbName: qb?.name ?? null,
    qbPlayerId: qb?.id ?? null,
    qbDropbacks: qb?.pass ?? null,
  };
}
