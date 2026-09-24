"use client";
import EmptyState from "../../ui/EmptyState";
import { POS_COLOR } from "../../../lib/uiTheme";
import {
  PLAYER_TIERS, TIER_META, summarizeTiersByGroup,
  type TierReportRow,
} from "../../../lib/draft/playerTier";

interface GradesTabProps {
  tierReport: TierReportRow[];
}

export default function GradesTab({ tierReport }: GradesTabProps) {
  if (tierReport.length === 0) {
    return (
      <EmptyState>
        No grades recorded yet. Use the tier buttons on the Consensus Board to grade players
        — ★ Star, S Starter, F Flex, B Bench Depth, R Roster Clogger, X Cut.
      </EmptyState>
    );
  }

  const summaryGroups = summarizeTiersByGroup(tierReport);

  return (
    <div className="space-y-4">
      {summaryGroups.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800">
            <div className="text-sm font-semibold text-white">Grade Summary by Pick Slot</div>
            <div className="text-xs text-slate-400 mt-0.5">
              What each slot range actually returned, from your own tier grades
            </div>
          </div>
          <div className="overflow-x-auto lg:overflow-x-visible">
            <table className="w-full text-xs border-collapse min-w-max lg:min-w-0">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 w-28 sticky left-0 bg-slate-900/60"></th>
                  {summaryGroups.map((g) => (
                    <th key={g.label} className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap">
                      {g.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PLAYER_TIERS.map((tier) => {
                  const meta = TIER_META[tier];
                  return (
                    <tr key={tier} className="border-b border-slate-800/50 last:border-0">
                      <td className={`px-3 py-2 font-bold text-[11px] whitespace-nowrap sticky left-0 bg-slate-900/60 ${meta.text}`}>
                        <span className="mr-1.5">{meta.glyph}</span>{meta.label}
                      </td>
                      {summaryGroups.map((g) => {
                        const pct = g.total ? Math.round((g.counts[tier] / g.total) * 100) : 0;
                        // Dim a tier that barely shows up in a slot range so the
                        // dominant outcome for that range is what the eye lands on.
                        return (
                          <td
                            key={g.label}
                            className={`px-2 py-2 text-center font-semibold ${pct === 0 ? "text-slate-700" : meta.text} ${pct > 0 && pct < 20 ? "opacity-60" : ""}`}
                          >
                            {pct}%
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                <tr className="border-t border-slate-800">
                  <td className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 sticky left-0 bg-slate-900/60">Graded</td>
                  {summaryGroups.map((g) => (
                    <td key={g.label} className="px-2 py-2 text-center text-[11px] text-slate-500">{g.total}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <div className="grid grid-cols-[4rem_1fr_4rem] gap-2 px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          <span>Slot</span>
          <span>Outcome mix</span>
          <span className="text-right">Players</span>
        </div>
        {tierReport.map((row) => (
          <details key={row.slot} className="group rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
            <summary className="grid grid-cols-[4rem_1fr_4rem] gap-2 items-center px-3 py-2.5 cursor-pointer list-none select-none hover:bg-slate-800/40 transition">
              <span className="text-sm font-bold text-white">{row.slot}</span>
              <div className="flex flex-col gap-1">
                <div className="flex h-2 rounded-full overflow-hidden bg-slate-700/50">
                  {PLAYER_TIERS.map((tier) => (
                    row.rates[tier] > 0 && (
                      <div
                        key={tier}
                        className={`${TIER_META[tier].bar} transition-all`}
                        style={{ width: `${row.rates[tier] * 100}%` }}
                        title={`${TIER_META[tier].label}: ${row.counts[tier]}`}
                      />
                    )
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                  {PLAYER_TIERS.map((tier) => (
                    row.counts[tier] > 0 && (
                      <span key={tier} className={`font-semibold ${TIER_META[tier].text}`}>
                        {Math.round(row.rates[tier] * 100)}% {TIER_META[tier].glyph} ({row.counts[tier]})
                      </span>
                    )
                  ))}
                </div>
              </div>
              <span className="text-xs text-slate-400 text-right">{row.total}</span>
            </summary>
            <div className="border-t border-slate-800 divide-y divide-slate-800/60">
              {row.players.map((p) => {
                const meta = TIER_META[p.tier];
                return (
                  <div key={`${p.year}-${p.name}`} className="flex items-center gap-3 px-3 py-2">
                    <span className={`text-[10px] font-bold w-7 ${POS_COLOR[p.position] ?? "text-slate-400"}`}>{p.position}</span>
                    <span className="text-sm text-white flex-1 truncate">{p.name}</span>
                    <span className="text-xs text-slate-500">{p.year}</span>
                    <span className={`text-xs font-semibold whitespace-nowrap ${meta.text}`}>
                      <span className="mr-1">{meta.glyph}</span>{meta.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
