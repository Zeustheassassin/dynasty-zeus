// PFF columns for the Analysis tables (and so Compare): PFF's numbers over
// exactly the games the user charted, never season totals. Values come from
// lib/pff/totals.ts pffValues (counts summed per game, rates from the summed
// counts, grades and splits from PFF's own aggregate over those weeks). The
// Big Board's PFF band picks a few of these by key (PFF_BOARD_KEYS).

import type { ColDef } from "./StatsTableShell";
import { pffValues, type PffTotals } from "../../../lib/pff/totals";
import type { PffPos } from "../../../lib/pff/stats";

const OVER = "over the charted games";

type Fmt = ColDef["fmt"];
const col = (key: string, label: string, group: string, fmt: Fmt, extra: Partial<ColDef> = {}): ColDef => ({
  key, label, group, fmt, width: Math.max(46, 10 + label.length * 7), ...extra,
});
const grade = (key: string, label: string, what: string): ColDef =>
  col(key, label, "PFF Grades", "dec1", { colorDir: 1, tooltip: `PFF ${what} grade ${OVER} (PFF's grade for exactly those games, not an average of game grades). Two charted seasons combine weighted by snaps.` });
const count = (key: string, label: string, group: string, tooltip: string) => col(key, label, group, "count", { tooltip: `${tooltip}, ${OVER} (PFF)` });

const games = (group: string): ColDef =>
  col("pff_g", "G", group, "count", { tooltip: "Charted games with PFF stats imported (Scouting → PFF Links)" });

// ── QB ───────────────────────────────────────────────────────
const QB: ColDef[] = [
  grade("pff_gr_off", "Off", "offense"),
  grade("pff_gr_pass", "Pass", "passing"),
  grade("pff_gr_run", "Run", "rushing"),
  games("PFF Passing"),
  count("pff_db", "DB", "PFF Passing", "Dropbacks"),
  count("pff_att", "Att", "PFF Passing", "Attempts"),
  count("pff_cmp", "Cmp", "PFF Passing", "Completions"),
  count("pff_pyds", "Yds", "PFF Passing", "Passing yards"),
  count("pff_ptd", "TD", "PFF Passing", "Passing TDs"),
  count("pff_int", "INT", "PFF Passing", "Interceptions"),
  col("pff_adj", "ADJ%", "PFF Passing", "pct", { colorDir: 1, weightBy: "pff_aimed", tooltip: `Adjusted completion %: (completions + drops) ÷ aimed passes, ${OVER} (PFF)` }),
  col("pff_ypa", "Y/A", "PFF Passing", "dec1", { colorDir: 1, tooltip: `Yards per attempt, ${OVER} (PFF)` }),
  col("pff_padot", "aDOT", "PFF Passing", "dec1", { tooltip: `Average depth of target, ${OVER} (PFF)` }),
  col("pff_ttt", "TTT", "PFF Passing", "dec2", { tooltip: `Average time to throw in seconds: total time ÷ dropbacks, ${OVER} (PFF)` }),
  count("pff_btt", "BTT", "PFF Passing", "Big-time throws"),
  col("pff_btt_pct", "BTT%", "PFF Passing", "pct", { colorDir: 1, weightBy: "pff_all_att", tooltip: `Big-time throws ÷ attempts, ${OVER} (PFF)` }),
  count("pff_twp", "TWP", "PFF Passing", "Turnover-worthy plays"),
  col("pff_twp_pct", "TWP%", "PFF Passing", "pct", { colorDir: -1, weightBy: "pff_all_db", tooltip: `Turnover-worthy plays ÷ dropbacks, ${OVER} (PFF)` }),
  count("pff_sk", "Sk", "PFF Passing", "Sacks taken"),
  col("pff_sk_pct", "Sk%", "PFF Passing", "pct", { colorDir: -1, weightBy: "pff_db", tooltip: `Sacks ÷ dropbacks, ${OVER} (PFF)` }),
  col("pff_prf_pct", "Pr%", "PFF Passing", "pct", { weightBy: "pff_db", tooltip: `Dropbacks under pressure, ${OVER} (PFF)` }),
  col("pff_p2s", "P2S%", "PFF Passing", "pct", { colorDir: -1, weightBy: "pff_prf", tooltip: `Pressures turned into sacks, ${OVER} (PFF)` }),
  count("pff_rdrops", "Drops", "PFF Passing", "Passes his receivers dropped"),
  col("pff_pa_pct", "PA%", "PFF PA / Blitz", "pct", { weightBy: "pff_db", tooltip: `Share of dropbacks with play action, ${OVER} (PFF)` }),
  col("pff_pa_adj", "PA ADJ%", "PFF PA / Blitz", "pct", { colorDir: 1, weightBy: "pff_pa_aimed", tooltip: `Adjusted completion % with play action, ${OVER} (PFF)` }),
  col("pff_pa_ypa", "PA Y/A", "PFF PA / Blitz", "dec1", { colorDir: 1, tooltip: `Yards per attempt with play action, ${OVER} (PFF)` }),
  col("pff_npa_adj", "No-PA ADJ%", "PFF PA / Blitz", "pct", { colorDir: 1, weightBy: "pff_npa_aimed", tooltip: `Adjusted completion % without play action, ${OVER} (PFF)` }),
  col("pff_npa_ypa", "No-PA Y/A", "PFF PA / Blitz", "dec1", { colorDir: 1, tooltip: `Yards per attempt without play action, ${OVER} (PFF)` }),
  col("pff_blz_pct", "Blitzed%", "PFF PA / Blitz", "pct", { weightBy: "pff_db", tooltip: `Share of dropbacks the defense blitzed, ${OVER} (PFF)` }),
  col("pff_blz_adj", "vs Blitz ADJ%", "PFF PA / Blitz", "pct", { colorDir: 1, weightBy: "pff_blz_aimed", tooltip: `Adjusted completion % when blitzed, ${OVER} (PFF)` }),
  col("pff_blz_ypa", "vs Blitz Y/A", "PFF PA / Blitz", "dec1", { colorDir: 1, tooltip: `Yards per attempt when blitzed, ${OVER} (PFF)` }),
  count("pff_blz_btt", "vs Blitz BTT", "PFF PA / Blitz", "Big-time throws when blitzed"),
  count("pff_blz_twp", "vs Blitz TWP", "PFF PA / Blitz", "Turnover-worthy plays when blitzed"),
  col("pff_blz_sk_pct", "vs Blitz Sk%", "PFF PA / Blitz", "pct", { colorDir: -1, weightBy: "pff_blz_db", tooltip: `Sacks ÷ dropbacks when blitzed, ${OVER} (PFF)` }),
  col("pff_nblz_adj", "No-Blitz ADJ%", "PFF PA / Blitz", "pct", { colorDir: 1, weightBy: "pff_nblz_aimed", tooltip: `Adjusted completion % when not blitzed, ${OVER} (PFF)` }),
  col("pff_nblz_ypa", "No-Blitz Y/A", "PFF PA / Blitz", "dec1", { colorDir: 1, tooltip: `Yards per attempt when not blitzed, ${OVER} (PFF)` }),
  count("pff_dsgn", "Designed", "PFF Rushing", "Designed runs (rush attempts minus scrambles)"),
  count("pff_dsgn_yds", "Dsgn Yds", "PFF Rushing", "Yards on designed runs"),
  count("pff_scr", "Scr", "PFF Rushing", "Scrambles"),
  count("pff_scr_yds", "Scr Yds", "PFF Rushing", "Yards on scrambles"),
  count("pff_ryds", "Rush Yds", "PFF Rushing", "Rushing yards"),
  count("pff_rmtf", "MTF", "PFF Rushing", "Avoided tackles as a runner"),
  count("pff_fum", "Fum", "PFF Rushing", "Fumbles"),
];

// ── RB ───────────────────────────────────────────────────────
const RB: ColDef[] = [
  grade("pff_gr_off", "Off", "offense"),
  grade("pff_gr_run", "Run", "rushing"),
  grade("pff_gr_route", "Route", "pass-route"),
  grade("pff_gr_pblk", "PBlk", "pass-blocking"),
  games("PFF Rushing"),
  count("pff_snaps", "Snaps", "PFF Rushing", "Offensive snaps"),
  count("pff_car", "Car", "PFF Rushing", "Carries"),
  count("pff_ryds", "Yds", "PFF Rushing", "Rushing yards"),
  col("pff_ypc", "Y/C", "PFF Rushing", "dec1", { colorDir: 1, tooltip: `Yards per carry, ${OVER} (PFF)` }),
  col("pff_ybc_a", "YBC/A", "PFF Rushing", "dec2", { colorDir: 1, tooltip: `Yards before contact per carry (yards − yards after contact), ${OVER} (PFF)` }),
  col("pff_yco_a", "YCO/A", "PFF Rushing", "dec2", { colorDir: 1, tooltip: `Yards after contact per carry, ${OVER} (PFF)` }),
  count("pff_rmtf", "MTF", "PFF Rushing", "Avoided tackles as a runner"),
  col("pff_mtf_a", "MTF/A", "PFF Rushing", "dec2", { colorDir: 1, tooltip: `Avoided tackles per carry, ${OVER} (PFF)` }),
  count("pff_15p", "15+", "PFF Rushing", "Runs of 15+ yards"),
  col("pff_15p_pct", "15+%", "PFF Rushing", "pct", { colorDir: 1, weightBy: "pff_car", tooltip: `Share of carries that went 15+ yards, ${OVER} (PFF)` }),
  col("pff_brk_pct", "Brk Yds%", "PFF Rushing", "pct", { colorDir: 1, tooltip: `Share of his rushing yards that came on 15+ yard runs (PFF breakaway %), ${OVER}` }),
  count("pff_gap", "Gap", "PFF Rushing", "Gap-scheme runs"),
  count("pff_zone", "Zone", "PFF Rushing", "Zone-scheme runs"),
  col("pff_gap_pct", "Gap%", "PFF Rushing", "pct", { tooltip: `Gap runs ÷ (gap + zone runs), ${OVER} (PFF)` }),
  count("pff_fum", "Fum", "PFF Rushing", "Fumbles"),
  count("pff_rtd", "TD", "PFF Rushing", "Rushing TDs"),
  count("pff_routes", "Routes", "PFF Receiving", "Routes run"),
  count("pff_tgt", "Tgt", "PFF Receiving", "Targets"),
  col("pff_tprr", "TPRR", "PFF Receiving", "pct", { colorDir: 1, weightBy: "pff_routes", tooltip: `Targets per route run, ${OVER} (PFF)` }),
  count("pff_rec", "Rec", "PFF Receiving", "Receptions"),
  count("pff_recyds", "Yds", "PFF Receiving", "Receiving yards"),
  col("pff_yprr", "YPRR", "PFF Receiving", "dec2", { colorDir: 1, tooltip: `PFF yards ÷ PFF routes, ${OVER}` }),
  count("pff_yac", "YAC", "PFF Receiving", "Yards after the catch"),
  count("pff_rcmtf", "MTF", "PFF Receiving", "Avoided tackles after the catch"),
  count("pff_drops", "Drops", "PFF Receiving", "Drops"),
  col("pff_drop_pct", "Drop%", "PFF Receiving", "pct", { colorDir: -1, weightBy: "pff_catchable", tooltip: `Drops ÷ (catches + drops), ${OVER} (PFF)` }),
  count("pff_pblk", "PB Snaps", "PFF Pass Pro", "Pass-blocking snaps"),
  count("pff_pr_allowed", "Pr Allowed", "PFF Pass Pro", "Pressures allowed"),
  col("pff_pr_pct", "Pr%", "PFF Pass Pro", "pct", { colorDir: -1, weightBy: "pff_pblk", tooltip: `Pressures allowed ÷ pass-blocking snaps, ${OVER} (PFF)` }),
  count("pff_sk_allowed", "Sk Allowed", "PFF Pass Pro", "Sacks allowed"),
];

// ── WR / TE ──────────────────────────────────────────────────
const receiving = (pos: "WR" | "TE"): ColDef[] => [
  games("PFF Receiving"),
  count("pff_snaps", "Snaps", "PFF Receiving", "Offensive snaps"),
  count("pff_routes", "Routes", "PFF Receiving", "Routes run"),
  col("pff_rte_part", "Rte%", "PFF Receiving", "pct", { colorDir: 1, weightBy: "pff_tdb", tooltip: `Route participation: routes ÷ his team's dropbacks, ${OVER} (PFF)` }),
  count("pff_tgt", "Tgt", "PFF Receiving", "Targets"),
  col("pff_tprr", "TPRR", "PFF Receiving", "pct", { colorDir: 1, weightBy: "pff_routes", tooltip: `Targets per route run, ${OVER} (PFF)` }),
  col("pff_tshare", "Tgt Share", "PFF Receiving", "pct", { colorDir: 1, weightBy: "pff_tdb", tooltip: `Target share: targets ÷ his team's dropbacks, ${OVER} (PFF)` }),
  count("pff_rec", "Rec", "PFF Receiving", "Receptions"),
  count("pff_recyds", "Yds", "PFF Receiving", "Receiving yards"),
  col("pff_ypr", "Y/R", "PFF Receiving", "dec1", { colorDir: 1, tooltip: `Yards per reception, ${OVER} (PFF)` }),
  col("pff_yprr", "YPRR", "PFF Receiving", "dec2", { colorDir: 1, tooltip: `PFF yards ÷ PFF routes, ${OVER}` }),
  count("pff_yac", "YAC", "PFF Receiving", "Yards after the catch"),
  col("pff_yac_r", "YAC/R", "PFF Receiving", "dec1", { colorDir: 1, tooltip: `Yards after the catch per reception, ${OVER} (PFF)` }),
  count("pff_rcmtf", "MTF", "PFF Receiving", "Avoided tackles after the catch"),
  count("pff_drops", "Drops", "PFF Receiving", "Drops"),
  col("pff_drop_pct", "Drop%", "PFF Receiving", "pct", { colorDir: -1, weightBy: "pff_catchable", tooltip: `Drops ÷ (catches + drops), ${OVER} (PFF)` }),
  count("pff_ctgt", "Cont Tgt", "PFF Receiving", "Contested targets"),
  count("pff_crec", "Cont Rec", "PFF Receiving", "Contested catches"),
  col("pff_cc_pct", "CC%", "PFF Receiving", "pct", { colorDir: 1, weightBy: "pff_ctgt", tooltip: `Contested catch rate, ${OVER} (PFF)` }),
  col("pff_radot", "aDOT", "PFF Receiving", "dec1", { tooltip: `Average depth of target, ${OVER} (PFF)` }),
  count("pff_deep_tgt", "20+ Tgt", "PFF Receiving", "Targets 20+ yards downfield"),
  count("pff_deep_rec", "20+ Rec", "PFF Receiving", "Catches on 20+ yard targets"),
  count("pff_deep_yds", "20+ Yds", "PFF Receiving", "Yards on 20+ yard targets"),
  count("pff_rectd", "TD", "PFF Receiving", "Receiving TDs"),
  ...(pos === "TE" ? [col("pff_inline_pct", "Inline%", "PFF Receiving", "pct", { weightBy: "pff_align_n", tooltip: `Snaps inline, of his inline + slot + wide snaps, ${OVER} (PFF)` })] : []),
  col("pff_slot_pct", "Slot%", "PFF Receiving", "pct", { weightBy: "pff_align_n", tooltip: `Snaps in the slot, of his inline + slot + wide snaps, ${OVER} (PFF)` }),
  col("pff_wide_pct", "Wide%", "PFF Receiving", "pct", { weightBy: "pff_align_n", tooltip: `Snaps out wide, of his inline + slot + wide snaps, ${OVER} (PFF)` }),
  count("pff_man_rte", "Man Rte", "PFF Man / Zone", "Routes against man coverage"),
  col("pff_man_yprr", "Man YPRR", "PFF Man / Zone", "dec2", { colorDir: 1, tooltip: `Yards per route against man coverage, ${OVER} (PFF)` }),
  col("pff_man_tprr", "Man TPRR", "PFF Man / Zone", "pct", { colorDir: 1, tooltip: `Targets per route against man coverage, ${OVER} (PFF)` }),
  count("pff_zone_rte", "Zone Rte", "PFF Man / Zone", "Routes against zone coverage"),
  col("pff_zone_yprr", "Zone YPRR", "PFF Man / Zone", "dec2", { colorDir: 1, tooltip: `Yards per route against zone coverage, ${OVER} (PFF)` }),
  col("pff_zone_tprr", "Zone TPRR", "PFF Man / Zone", "pct", { colorDir: 1, tooltip: `Targets per route against zone coverage, ${OVER} (PFF)` }),
];

const WR: ColDef[] = [
  grade("pff_gr_off", "Off", "offense"),
  grade("pff_gr_route", "Route", "pass-route"),
  grade("pff_gr_hands", "Hands", "hands (drops)"),
  grade("pff_gr_rblk", "RBlk", "run-blocking"),
  ...receiving("WR"),
  count("pff_blk", "Blk Snaps", "PFF Blocking", "Blocking snaps"),
  count("pff_pr_allowed", "Pr Allowed", "PFF Blocking", "Pressures allowed"),
];

const TE: ColDef[] = [
  grade("pff_gr_off", "Off", "offense"),
  grade("pff_gr_route", "Route", "pass-route"),
  grade("pff_gr_rblk", "RBlk", "run-blocking"),
  grade("pff_gr_pblk", "PBlk", "pass-blocking"),
  grade("pff_gr_hands", "Hands", "hands (drops)"),
  ...receiving("TE"),
  count("pff_blk", "Blk Snaps", "PFF Blocking", "Blocking snaps"),
  count("pff_rblk", "Run Blk", "PFF Blocking", "Run-blocking snaps"),
  count("pff_pblk", "Pass Blk", "PFF Blocking", "Pass-blocking snaps"),
  count("pff_pr_allowed", "Pr Allowed", "PFF Blocking", "Pressures allowed"),
  col("pff_pr_pct", "Pr%", "PFF Blocking", "pct", { colorDir: -1, weightBy: "pff_pblk", tooltip: `Pressures allowed ÷ pass-blocking snaps, ${OVER} (PFF)` }),
  count("pff_sk_allowed", "Sk Allowed", "PFF Blocking", "Sacks allowed"),
];

const BY_POS: Record<PffPos, ColDef[]> = { QB, RB, WR, TE };

/** The position's PFF columns, appended to its Analysis table. */
export function pffCols(pos: PffPos): ColDef[] {
  return BY_POS[pos];
}

/** The PFF values for one prospect's row (empty when nothing is imported). */
export function pffRow(totals: PffTotals | null | undefined): Record<string, number | null> {
  return pffValues(totals);
}

/** The Big Board's PFF band per position tab (keys of pffCols), and the All tab's one column. */
export const PFF_BOARD_KEYS: Record<PffPos, string[]> = {
  QB: ["pff_gr_off", "pff_adj", "pff_btt_pct", "pff_twp_pct", "pff_padot", "pff_ttt"],
  RB: ["pff_gr_off", "pff_yco_a", "pff_mtf_a", "pff_15p", "pff_yprr", "pff_pr_pct"],
  WR: ["pff_gr_off", "pff_yprr", "pff_tprr", "pff_tshare", "pff_radot", "pff_drop_pct"],
  TE: ["pff_gr_off", "pff_yprr", "pff_rte_part", "pff_gr_rblk", "pff_pr_pct"],
};
export const PFF_ALL_TAB_KEY = "pff_gr_off";
