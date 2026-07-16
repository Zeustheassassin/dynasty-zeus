"use client";

interface StatStripProps {
  leagueCount: number;
  ownedPlayerCount: number;
  openTradeCount: number;
  injuredCount: number;
}

function Tile({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className={`rounded-2xl border bg-slate-900/60 px-4 py-3 ${accent}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-bold text-white">{value}</div>
    </div>
  );
}

export default function StatStrip({ leagueCount, ownedPlayerCount, openTradeCount, injuredCount }: StatStripProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile label="Leagues" value={leagueCount} accent="border-slate-800" />
      <Tile label="Cross-League Players" value={ownedPlayerCount} accent="border-slate-800" />
      <Tile label="Open Trades" value={openTradeCount} accent={openTradeCount > 0 ? "border-yellow-700/60" : "border-slate-800"} />
      <Tile label="Injured / Owned" value={injuredCount} accent={injuredCount > 0 ? "border-red-800/60" : "border-slate-800"} />
    </div>
  );
}
