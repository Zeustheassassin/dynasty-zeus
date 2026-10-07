// ============================================================
// PFF numbers over a prospect's charted games — client-safe, pure.
// ============================================================
// Counts are the per-game rows summed (they equal PFF's own total over those
// games). Grades, aDOT and the PFF-only splits (play action, blitz, 20+ yard
// targets, man / zone, team dropbacks) come from PFF's aggregate over the
// charted weeks of each season (prospect_season_pff). Rates are always
// computed from summed counts (YPRR = PFF yards ÷ PFF routes), never as an
// average of per-game rates.
//
// What counts as current: a game row only while the game is still linked to
// the same PFF game; a season aggregate only while it covers exactly the
// season's current game rows. A stale aggregate blanks every aggregate value
// (rather than showing a grade over a different set of games) until the next
// import refreshes it.
//
// Two seasons combine by weight (a season's grade counts by the plays behind
// it, e.g. routes for the route grade). PFF's own site can't combine seasons
// either; within one season the numbers match PFF exactly.
// ============================================================

import type { ScoutingGame } from "../types";
import {
  GAME_AVERAGE_KEYS, GAME_STAT_KEYS, SEASON_AVERAGE_KEYS, SEASON_AVERAGE_WEIGHT, SEASON_STAT_KEYS,
  type GameStatKey, type PffGameRow, type PffGameStats, type PffSeasonRow, type SeasonStatKey,
} from "./stats";

/**
 * Plays with the ball in his hands, the denominator for fumbles: dropbacks
 * (sacks and scrambles included) + designed runs + catches. Scrambles are in
 * both PFF's dropbacks and its rush attempts, so they're taken out once.
 * Null when PFF has none of the four.
 */
export function touchesOf(s: Pick<PffGameStats, "all_dropbacks" | "rush_att" | "scrambles" | "receptions">): number | null {
  if (s.all_dropbacks == null && s.rush_att == null && s.receptions == null) return null;
  return (s.all_dropbacks ?? 0) + (s.rush_att ?? 0) - (s.scrambles ?? 0) + (s.receptions ?? 0);
}

export interface PffTotals {
  /** Charted games linked to a PFF game. */
  linked: number;
  /** Linked games with PFF stats imported for that same PFF game. */
  games: number;
  /** Seasons with imported games, and how many have a current aggregate. */
  seasons: number;
  seasonsCurrent: number;
  /** Per-game counts summed (null where no game had the column). Averages stay null. */
  sum: Record<GameStatKey, number | null>;
  /** From PFF's aggregates: null unless every season's aggregate is current. */
  agg: Record<SeasonStatKey, number | null>;
}

const LINKED = new Set(["auto", "confirmed"]);

type LinkedGame = Pick<ScoutingGame, "id" | "prospect_id" | "pff_game_id" | "pff_match_status">;

/** Whether the charted game is linked to a PFF game (Stage 1). */
export function isLinkedGame(g: Pick<ScoutingGame, "pff_game_id" | "pff_match_status">): boolean {
  return g.pff_game_id != null && LINKED.has(g.pff_match_status ?? "");
}

/** The stored row for a charted game, if it's for the PFF game it's linked to now. */
export function currentGameRow<R extends Pick<PffGameRow, "pff_game_id">>(
  g: Pick<ScoutingGame, "pff_game_id" | "pff_match_status">, row: R | undefined,
): R | null {
  return row && isLinkedGame(g) && row.pff_game_id === g.pff_game_id ? row : null;
}

const sameIds = (a: readonly number[], b: readonly number[]) => {
  if (a.length !== b.length) return false;
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  return x.every((v, i) => v === y[i]);
};

/** Whether a season aggregate covers exactly these game rows. */
export function seasonIsCurrent(row: Pick<PffSeasonRow, "pff_game_ids"> | undefined, games: readonly Pick<PffGameRow, "pff_game_id">[]): boolean {
  return row != null && games.length > 0 && sameIds(row.pff_game_ids, games.map((g) => g.pff_game_id));
}

function emptyRecord<K extends string>(keys: readonly K[]): Record<K, number | null> {
  const r = {} as Record<K, number | null>;
  for (const k of keys) r[k] = null;
  return r;
}

const add = (a: number | null, b: number | null) => (b == null ? a : (a ?? 0) + b);

/** One prospect's totals from his current game rows and season rows. */
export function totalsFor(
  linked: number, rows: readonly PffGameRow[], seasonRows: ReadonlyMap<number, PffSeasonRow>,
): PffTotals {
  const sum = emptyRecord(GAME_STAT_KEYS);
  for (const r of rows) for (const k of GAME_STAT_KEYS) if (!GAME_AVERAGE_KEYS.has(k)) sum[k] = add(sum[k], r[k]);

  const bySeason = new Map<number, PffGameRow[]>();
  for (const r of rows) bySeason.set(r.season, [...(bySeason.get(r.season) ?? []), r]);
  const current = [...bySeason].filter(([season, gs]) => seasonIsCurrent(seasonRows.get(season), gs));

  const agg = emptyRecord(SEASON_STAT_KEYS);
  if (current.length > 0 && current.length === bySeason.size) {
    const averages = new Set<string>(SEASON_AVERAGE_KEYS);
    for (const k of SEASON_STAT_KEYS) {
      if (averages.has(k)) continue;
      for (const [season] of current) agg[k] = add(agg[k], seasonRows.get(season)![k]);
    }
    for (const k of SEASON_AVERAGE_KEYS) {
      const parts = current
        .map(([season, gs]) => ({
          v: seasonRows.get(season)![k],
          w: gs.reduce((s, g) => s + (g[SEASON_AVERAGE_WEIGHT[k]] ?? 0), 0),
        }))
        .filter((p): p is { v: number; w: number } => p.v != null);
      if (parts.length === 0) continue;
      const wSum = parts.reduce((s, p) => s + p.w, 0);
      agg[k] = wSum > 0
        ? parts.reduce((s, p) => s + p.v * p.w, 0) / wSum
        : parts.reduce((s, p) => s + p.v, 0) / parts.length;
    }
  }
  return { linked, games: rows.length, seasons: bySeason.size, seasonsCurrent: current.length, sum, agg };
}

/** Every prospect with a linked charted game → his PFF totals over them. */
export function buildPffTotals(
  games: readonly LinkedGame[], gameRows: readonly PffGameRow[], seasonRows: readonly PffSeasonRow[],
): Map<string, PffTotals> {
  const rowByGame = new Map(gameRows.map((r) => [r.game_id, r]));
  const seasonsByProspect = new Map<string, Map<number, PffSeasonRow>>();
  for (const s of seasonRows) {
    const m = seasonsByProspect.get(s.prospect_id) ?? new Map<number, PffSeasonRow>();
    m.set(s.season, s);
    seasonsByProspect.set(s.prospect_id, m);
  }
  const byProspect = new Map<string, { linked: number; rows: PffGameRow[] }>();
  for (const g of games) {
    if (!isLinkedGame(g)) continue;
    const e = byProspect.get(g.prospect_id) ?? { linked: 0, rows: [] };
    e.linked++;
    const row = currentGameRow(g, rowByGame.get(g.id));
    if (row) e.rows.push(row);
    byProspect.set(g.prospect_id, e);
  }
  const out = new Map<string, PffTotals>();
  for (const [id, e] of byProspect) out.set(id, totalsFor(e.linked, e.rows, seasonsByProspect.get(id) ?? new Map()));
  return out;
}

/** One game as totals: its counts, and its own grades / aDOT standing in for the aggregate. */
export function gameAsTotals(row: PffGameRow): PffTotals {
  const t = totalsFor(1, [row], new Map());
  for (const k of SEASON_AVERAGE_KEYS) t.agg[k] = row[k];
  return t;
}

// ── Derived values ───────────────────────────────────────────
// Every PFF number the app shows, by key. Analysis / Compare columns
// (components/scouting/stats/pffCols.ts), the Big Board's PFF band and the
// game logs all read these, so each is defined once.

const round = (v: number | null, dp: number) => (v == null || !Number.isFinite(v) ? null : parseFloat(v.toFixed(dp)));
const ratio = (n: number | null, d: number | null, dp = 2) => (n == null || d == null || d === 0 ? null : round(n / d, dp));
const pct = (n: number | null, d: number | null) => (n == null || d == null || d === 0 ? null : round((n / d) * 100, 1));
const plus = (...xs: (number | null)[]) => (xs.some((x) => x == null) ? null : xs.reduce<number>((s, x) => s + (x as number), 0));
const minus = (a: number | null, b: number | null) => (a == null ? null : a - (b ?? 0));

export type PffValues = Record<string, number | null>;

export function pffValues(t: PffTotals | null | undefined): PffValues {
  if (!t || t.games === 0) return {};
  const s = t.sum;
  const a = t.agg;
  const splitAdj = (p: "pa" | "npa" | "blitz" | "no_blitz") => pct(plus(a[`${p}_completions`], a[`${p}_drops`]), a[`${p}_aimed`]);
  const splitYpa = (p: "pa" | "npa" | "blitz" | "no_blitz") => ratio(a[`${p}_yards`], a[`${p}_attempts`], 1);
  const alignTotal = plus(s.slot_snaps, s.wide_snaps, s.inline_snaps);
  return {
    pff_g: t.games,
    pff_snaps: s.snaps,
    // Grades (PFF's, over exactly these games)
    pff_gr_off: round(a.grade_offense, 1),
    pff_gr_pass: round(a.grade_pass, 1),
    pff_gr_run: round(a.grade_run, 1),
    pff_gr_route: round(a.grade_pass_route, 1),
    pff_gr_rblk: round(a.grade_run_block, 1),
    pff_gr_pblk: round(a.grade_pass_block, 1),
    pff_gr_hands: round(a.grade_hands_drop, 1),
    // Passing
    pff_db: s.dropbacks,
    pff_att: s.attempts,
    pff_cmp: s.completions,
    pff_aimed: s.aimed_passes,
    pff_pyds: s.pass_yards,
    pff_ptd: s.pass_td,
    pff_int: s.interceptions,
    pff_adj: pct(plus(s.completions, s.rec_drops), s.aimed_passes),
    pff_ypa: ratio(s.pass_yards, s.attempts, 1),
    pff_padot: round(a.pass_adot, 1),
    pff_ttt: ratio(s.ttt_total, s.dropbacks),
    pff_btt: s.btt,
    pff_all_att: s.all_attempts,
    pff_btt_pct: pct(s.btt, s.all_attempts),
    pff_twp: s.twp,
    pff_all_db: s.all_dropbacks,
    pff_twp_pct: pct(s.twp, s.all_dropbacks),
    pff_sk: s.sacks,
    pff_sk_pct: pct(s.sacks, s.dropbacks),
    pff_prf: s.pressures_faced,
    pff_prf_pct: pct(s.pressures_faced, s.dropbacks),
    pff_p2s: pct(s.sacks, s.pressures_faced),
    pff_rdrops: s.rec_drops,
    pff_thaw: s.throwaways,
    // Play action / blitz (aggregates)
    pff_pa_pct: pct(a.pa_dropbacks, plus(a.pa_dropbacks, a.npa_dropbacks)),
    pff_pa_db: a.pa_dropbacks,
    pff_pa_aimed: a.pa_aimed,
    pff_pa_adj: splitAdj("pa"),
    pff_pa_ypa: splitYpa("pa"),
    pff_npa_aimed: a.npa_aimed,
    pff_npa_adj: splitAdj("npa"),
    pff_npa_ypa: splitYpa("npa"),
    pff_blz_pct: pct(a.blitz_dropbacks, plus(a.blitz_dropbacks, a.no_blitz_dropbacks)),
    pff_blz_db: a.blitz_dropbacks,
    pff_blz_aimed: a.blitz_aimed,
    pff_blz_adj: splitAdj("blitz"),
    pff_blz_ypa: splitYpa("blitz"),
    pff_blz_btt: a.blitz_btt,
    pff_blz_twp: a.blitz_twp,
    pff_blz_sk_pct: pct(a.blitz_sacks, a.blitz_dropbacks),
    pff_nblz_aimed: a.no_blitz_aimed,
    pff_nblz_adj: splitAdj("no_blitz"),
    pff_nblz_ypa: splitYpa("no_blitz"),
    // Rushing
    pff_car: s.rush_att,
    pff_ryds: s.rush_yards,
    pff_ypc: ratio(s.rush_yards, s.rush_att, 1),
    pff_ybc_a: ratio(minus(s.rush_yards, s.yco), s.rush_att),
    pff_yco_a: ratio(s.yco, s.rush_att),
    pff_rmtf: s.rush_mtf,
    pff_mtf_a: ratio(s.rush_mtf, s.rush_att),
    pff_15p: s.rush_15plus,
    pff_15p_pct: pct(s.rush_15plus, s.rush_att),
    pff_brk_pct: pct(s.rush_15plus_yards, s.rush_yards),
    pff_10p: s.rush_10plus,
    pff_10p_pct: pct(s.rush_10plus, s.rush_att),
    pff_15of10: pct(s.rush_15plus, s.rush_10plus),
    pff_gap: s.gap_att,
    pff_zone: s.zone_att,
    pff_gap_pct: pct(s.gap_att, plus(s.gap_att, s.zone_att)),
    pff_fum: s.fumbles,
    pff_touches: touchesOf(s),
    pff_fum_pct: pct(s.fumbles, touchesOf(s)),
    pff_rtd: s.rush_td,
    pff_dsgn: minus(s.rush_att, s.scrambles),
    pff_dsgn_yds: s.designed_yards,
    pff_scr: s.scrambles,
    pff_scr_yds: s.scramble_yards,
    // Receiving
    pff_routes: s.routes,
    pff_tdb: a.team_dropbacks,
    pff_rte_part: pct(s.routes, a.team_dropbacks),
    pff_tgt: s.targets,
    pff_tprr: pct(s.targets, s.routes),
    pff_tshare: pct(s.targets, a.team_dropbacks),
    pff_rec: s.receptions,
    pff_recyds: s.rec_yards,
    pff_ypr: ratio(s.rec_yards, s.receptions, 1),
    pff_yprr: ratio(s.rec_yards, s.routes),
    pff_yac: s.yac,
    pff_yac_r: ratio(s.yac, s.receptions, 1),
    pff_rcmtf: s.rec_mtf,
    pff_drops: s.drops,
    pff_catchable: plus(s.receptions, s.drops),
    pff_drop_pct: pct(s.drops, plus(s.receptions, s.drops)),
    pff_ctgt: s.contested_targets,
    pff_crec: s.contested_receptions,
    pff_cc_pct: pct(s.contested_receptions, s.contested_targets),
    pff_radot: round(a.rec_adot, 1),
    pff_deep_tgt: a.deep_targets,
    pff_deep_rec: a.deep_receptions,
    pff_deep_yds: a.deep_yards,
    pff_rectd: s.rec_td,
    pff_align_n: alignTotal,
    pff_slot_pct: pct(s.slot_snaps, alignTotal),
    pff_wide_pct: pct(s.wide_snaps, alignTotal),
    pff_inline_pct: pct(s.inline_snaps, alignTotal),
    pff_man_rte: a.man_routes,
    pff_man_yprr: ratio(a.man_yards, a.man_routes),
    pff_man_tprr: pct(a.man_targets, a.man_routes),
    pff_zone_rte: a.zone_routes,
    pff_zone_yprr: ratio(a.zone_yards, a.zone_routes),
    pff_zone_tprr: pct(a.zone_targets, a.zone_routes),
    // Blocking
    pff_blk: s.block_snaps,
    pff_rblk: s.run_block_snaps,
    pff_pblk: s.pass_block_snaps,
    pff_pr_allowed: s.pressures_allowed,
    pff_pr_pct: pct(s.pressures_allowed, s.pass_block_snaps),
    pff_sk_allowed: s.sacks_allowed,
  };
}
