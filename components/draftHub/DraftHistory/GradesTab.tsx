"use client";
import EmptyState from "../../ui/EmptyState";

interface GradeReportRow {
  slot: string;
  hit: number;
  neutral: number;
  bust: number;
  total: number;
  hitRate: number;
  neutRate: number;
  bustRate: number;
  players: { name: string; position: string; year: string; grade: string; avgPickNo: number }[];
}

interface GradesTabProps {
  gradeReport: GradeReportRow[];
}

const POS_COLOR: Record<string, string> = {
  QB: "text-red-400", RB: "text-green-400", WR: "text-blue-400",
  TE: "text-yellow-400", FB: "text-orange-400",
};

export default function GradesTab({ gradeReport }: GradesTabProps) {
  if (gradeReport.length === 0) {
    return (
      <EmptyState>
        No grades recorded yet. Use the H / N / B buttons on the Consensus Board to grade players.
      </EmptyState>
    );
  }

  const SLOT_GROUPS = [
    { label: "Early 1st", round: 1, min: 1,  max: 4  },
    { label: "Mid 1st",   round: 1, min: 5,  max: 8  },
    { label: "Late 1st",  round: 1, min: 9,  max: 12 },
    { label: "Early 2nd", round: 2, min: 1,  max: 4  },
    { label: "Mid 2nd",   round: 2, min: 5,  max: 8  },
    { label: "Late 2nd",  round: 2, min: 9,  max: 12 },
    { label: "Early 3rd", round: 3, min: 1,  max: 4  },
    { label: "Mid 3rd",   round: 3, min: 5,  max: 8  },
    { label: "Late 3rd",  round: 3, min: 9,  max: 12 },
    { label: "4th Round", round: 4, min: 1,  max: 12 },
    { label: "5th+/Waiv", round: 5, min: 1,  max: 999 },
  ];
  const summaryGroups = SLOT_GROUPS.map(({ label, round, min, max }) => {
    const rows = gradeReport.filter((row) => {
      const [r, s] = row.slot.split(".").map(Number);
      return r === round && s >= min && s <= max;
    });
    const hit     = rows.reduce((sum, r) => sum + r.hit,     0);
    const neutral = rows.reduce((sum, r) => sum + r.neutral, 0);
    const bust    = rows.reduce((sum, r) => sum + r.bust,    0);
    const total   = hit + neutral + bust;
    return { label, hit, neutral, bust, total };
  }).filter((g) => g.total > 0);

  return (
    <div className="space-y-4">
      {summaryGroups.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800">
            <div className="text-sm font-semibold text-white">Grade Summary by Pick Slot</div>
            <div className="text-xs text-slate-400 mt-0.5">Hit / Neutral / Miss rates from your H N B grades</div>
          </div>
          <div className="overflow-x-auto lg:overflow-x-visible">
            <table className="w-full text-xs border-collapse min-w-max lg:min-w-0">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 w-16 sticky left-0 bg-slate-900/60"></th>
                  {summaryGroups.map((g) => (
                    <th key={g.label} className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap">
                      {g.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["hit", "neutral", "bust"] as const).map((grade) => {
                  const labelText  = grade === "hit" ? "Hit" : grade === "neutral" ? "Neutral" : "Bust";
                  const labelColor = grade === "hit" ? "text-emerald-400" : grade === "neutral" ? "text-slate-400" : "text-red-400";
                  return (
                    <tr key={grade} className="border-b border-slate-800/50 last:border-0">
                      <td className={`px-3 py-2 font-bold text-[11px] sticky left-0 bg-slate-900/60 ${labelColor}`}>{labelText}</td>
                      {summaryGroups.map((g) => {
                        const pct = g.total ? Math.round((g[grade] / g.total) * 100) : 0;
                        const color = grade === "hit"
                          ? pct >= 50 ? "text-emerald-300" : pct >= 30 ? "text-emerald-500" : "text-emerald-700"
                          : grade === "bust"
                          ? pct >= 60 ? "text-red-600" : pct >= 40 ? "text-red-400" : "text-red-300"
                          : "text-slate-400";
                        return (
                          <td key={g.label} className={`px-2 py-2 text-center font-semibold ${color}`}>
                            {pct}%
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <div className="grid grid-cols-[4rem_1fr_4rem] gap-2 px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          <span>Slot</span>
          <span>Hit / Neutral / Bust</span>
          <span className="text-right">Players</span>
        </div>
        {gradeReport.map((row) => (
          <details key={row.slot} className="group rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
            <summary className="grid grid-cols-[4rem_1fr_4rem] gap-2 items-center px-3 py-2.5 cursor-pointer list-none select-none hover:bg-slate-800/40 transition">
              <span className="text-sm font-bold text-white">{row.slot}</span>
              <div className="flex flex-col gap-1">
                <div className="flex h-2 rounded-full overflow-hidden bg-slate-700/50">
                  {row.hitRate  > 0 && <div className="bg-emerald-500 transition-all" style={{ width: `${row.hitRate  * 100}%` }} />}
                  {row.neutRate > 0 && <div className="bg-slate-500  transition-all" style={{ width: `${row.neutRate * 100}%` }} />}
                  {row.bustRate > 0 && <div className="bg-red-500   transition-all" style={{ width: `${row.bustRate * 100}%` }} />}
                </div>
                <div className="flex gap-3 text-[10px]">
                  {row.hit     > 0 && <span className="text-emerald-400 font-semibold">{Math.round(row.hitRate  * 100)}% H ({row.hit})</span>}
                  {row.neutral > 0 && <span className="text-slate-400  font-semibold">{Math.round(row.neutRate * 100)}% N ({row.neutral})</span>}
                  {row.bust    > 0 && <span className="text-red-400   font-semibold">{Math.round(row.bustRate * 100)}% B ({row.bust})</span>}
                </div>
              </div>
              <span className="text-xs text-slate-400 text-right">{row.total}</span>
            </summary>
            <div className="border-t border-slate-800 divide-y divide-slate-800/60">
              {row.players.map((p) => {
                const gradeColor = p.grade === "hit" ? "text-emerald-400" : p.grade === "bust" ? "text-red-400" : "text-slate-400";
                const gradeLabel = p.grade === "hit" ? "H" : p.grade === "bust" ? "B" : "N";
                return (
                  <div key={`${p.year}-${p.name}`} className="flex items-center gap-3 px-3 py-2">
                    <span className={`text-[10px] font-bold w-7 ${POS_COLOR[p.position] ?? "text-slate-400"}`}>{p.position}</span>
                    <span className="text-sm text-white flex-1 truncate">{p.name}</span>
                    <span className="text-xs text-slate-500">{p.year}</span>
                    <span className={`text-xs font-bold w-4 text-right ${gradeColor}`}>{gradeLabel}</span>
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
