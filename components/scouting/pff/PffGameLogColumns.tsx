"use client";
// The PFF columns of a charting board's Games tab: PFF's numbers for each
// charted game, and a footer over all of them (counts summed, rates from the
// sums, the grade PFF's own over exactly these games). Shared by the WR, RB,
// QB and TE boards; they append these cells to their own game rows.

import { fmtVal, type ColDef } from "../stats/StatsTableShell";
import { pffCols } from "../stats/pffCols";
import { gameAsTotals, pffValues, type PffTotals } from "../../../lib/pff/totals";
import type { PffGameRow, PffPos } from "../../../lib/pff/stats";
import type { PffGameLog } from "./usePffGameLog";

const LOG_COLS: Record<PffPos, [key: string, label: string][]> = {
  QB: [["pff_gr_off", "Grade"], ["pff_db", "DB"], ["pff_cmp", "Cmp"], ["pff_att", "Att"], ["pff_pyds", "Yds"], ["pff_adj", "ADJ%"],
    ["pff_btt", "BTT"], ["pff_twp", "TWP"], ["pff_ttt", "TTT"], ["pff_padot", "aDOT"], ["pff_sk", "Sk"], ["pff_dsgn", "Dsgn"],
    ["pff_scr", "Scr"], ["pff_ryds", "Rush Yds"]],
  RB: [["pff_gr_off", "Grade"], ["pff_snaps", "Snaps"], ["pff_car", "Car"], ["pff_ryds", "Yds"], ["pff_yco_a", "YCO/A"],
    ["pff_rmtf", "MTF"], ["pff_15p", "15+"], ["pff_routes", "Rte"], ["pff_tgt", "Tgt"], ["pff_rec", "Rec"],
    ["pff_recyds", "Rec Yds"], ["pff_pblk", "PB"], ["pff_pr_allowed", "Pr"]],
  WR: [["pff_gr_off", "Grade"], ["pff_snaps", "Snaps"], ["pff_routes", "Rte"], ["pff_tgt", "Tgt"], ["pff_rec", "Rec"],
    ["pff_recyds", "Yds"], ["pff_yac", "YAC"], ["pff_yprr", "YPRR"], ["pff_drops", "Drop"], ["pff_radot", "aDOT"],
    ["pff_ctgt", "CTgt"], ["pff_crec", "CRec"]],
  TE: [["pff_gr_off", "Grade"], ["pff_snaps", "Snaps"], ["pff_routes", "Rte"], ["pff_tgt", "Tgt"], ["pff_rec", "Rec"],
    ["pff_recyds", "Yds"], ["pff_yprr", "YPRR"], ["pff_rblk", "RBlk"], ["pff_pblk", "PBlk"], ["pff_pr_allowed", "Pr"]],
};

function logCols(pos: PffPos): ColDef[] {
  const defs = pffCols(pos);
  return LOG_COLS[pos].map(([key, label]) => ({ ...defs.find((c) => c.key === key)!, label }));
}

const first = "pl-3 border-l border-slate-800";

export function PffLogHeaders({ pos }: { pos: PffPos }) {
  return (
    <>
      {logCols(pos).map((c, i) => (
        <th key={c.key} title={`PFF: ${c.tooltip ?? c.label}`} className={`pb-2 pr-3 text-right text-sky-600 whitespace-nowrap ${i === 0 ? first : ""}`}>
          {c.label}
        </th>
      ))}
    </>
  );
}

export function PffLogCells({ pos, row, whyEmpty }: { pos: PffPos; row: PffGameRow | null; whyEmpty: string }) {
  const cols = logCols(pos);
  if (!row) {
    return <td colSpan={cols.length} className={`py-2 text-xs text-slate-600 ${first}`}>{whyEmpty}</td>;
  }
  const v = pffValues(gameAsTotals(row));
  return (
    <>
      {cols.map((c, i) => (
        <td key={c.key} className={`py-2 pr-3 text-right text-slate-300 whitespace-nowrap ${i === 0 ? `${first} font-medium text-sky-300` : ""}`}>
          {fmtVal(v[c.key] ?? null, c.fmt)}
        </td>
      ))}
    </>
  );
}

export function PffLogFooter({ pos, totals }: { pos: PffPos; totals: PffTotals | null }) {
  const v = pffValues(totals);
  return (
    <>
      {logCols(pos).map((c, i) => (
        <td
          key={c.key}
          title={c.key === "pff_gr_off" ? "PFF's grade over exactly these games (not an average of the game grades)" : undefined}
          className={`pt-2 pr-3 text-right text-sky-300 whitespace-nowrap ${i === 0 ? first : ""}`}
        >
          {fmtVal(v[c.key] ?? null, c.fmt)}
        </td>
      ))}
    </>
  );
}

/** The strip above a Games table: PFF coverage, and Refresh. */
export function PffLogBar({ log, gameCount }: { log: PffGameLog; gameCount: number }) {
  const imported = log.totals?.games ?? 0;
  const stale = log.totals != null && log.totals.seasonsCurrent < log.totals.seasons;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
      <span>
        <span className="font-semibold text-sky-400">PFF</span>{" "}
        {imported} of {gameCount} charted game{gameCount === 1 ? "" : "s"}
        {log.linked < gameCount && <span className="text-slate-500"> · {gameCount - log.linked} not linked</span>}
        {stale && <span className="text-amber-400"> · grades out of date, refresh</span>}
      </span>
      <button
        onClick={() => void log.refresh()}
        disabled={log.refreshing || log.linked === 0}
        title="Re-read this player's charted games from PFF"
        className="rounded border border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-40"
      >
        {log.refreshing ? "Refreshing…" : "Refresh PFF"}
      </button>
      {log.progressNote && <span className="text-slate-500">{log.progressNote}</span>}
      {log.note && <span className="text-slate-500">{log.note}</span>}
      {log.error && <span className="text-red-300">{log.error}</span>}
    </div>
  );
}
