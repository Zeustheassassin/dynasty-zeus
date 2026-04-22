"use client";
import type { SleeperPlayer, SleeperTradedPick } from "../../lib/types";
import type { LeagueTransaction } from "./alertsPageHelpers";
import { POS_COLOR, relTime } from "./alertsPageHelpers";

export default function TxCard({ tx, players }: { tx: LeagueTransaction; players: Record<string, SleeperPlayer> }) {
  const type: string = tx.type;
  const isTrade = type === "trade";
  const adds: Record<string, number> = tx.adds ?? {};
  const drops: Record<string, number> = tx.drops ?? {};
  const picks: SleeperTradedPick[] = tx.draft_picks ?? [];
  const rosterOwnerMap: Record<number, string> = tx.rosterOwnerMap ?? {};

  const hasAdds = Object.keys(adds).length > 0;
  const hasDrops = Object.keys(drops).length > 0;

  const cardCls = isTrade
    ? "border-violet-800/40 bg-violet-950/10"
    : hasAdds && hasDrops
    ? "border-blue-800/40 bg-blue-950/10"
    : hasAdds
    ? "border-emerald-800/40 bg-emerald-950/10"
    : "border-red-800/40 bg-red-950/10";

  const typeLabel = isTrade
    ? "Trade"
    : hasAdds && hasDrops
    ? "Waiver"
    : hasAdds
    ? "Add"
    : "Drop";

  const typeLabelCls = isTrade
    ? "bg-violet-900/50 text-violet-300"
    : hasAdds && hasDrops
    ? "bg-blue-900/50 text-blue-300"
    : hasAdds
    ? "bg-emerald-900/50 text-emerald-300"
    : "bg-red-900/50 text-red-300";

  const PlayerPill = ({ playerId }: { playerId: string }) => {
    const p = players[playerId];
    if (!p) return <span className="text-xs text-slate-400">{playerId}</span>;
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-0.5">
        <span className={`text-[10px] font-bold ${POS_COLOR[p.position] ?? "text-slate-400"}`}>{p.position}</span>
        <span className="text-xs text-white">{p.full_name}</span>
        {p.team && <span className="text-[10px] text-slate-500">{p.team}</span>}
      </span>
    );
  };

  const PickPill = ({ pick }: { pick: SleeperTradedPick }) => {
    const slotLabel = pick.slot && String(pick.slot).includes(".")
      ? `${pick.season} ${pick.slot}`
      : `${pick.season} Rd ${pick.round}`;
    const viaName = pick.roster_id !== pick.owner_id
      ? (rosterOwnerMap[pick.roster_id] ?? null)
      : null;
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-0.5">
        <span className="text-[10px] font-bold text-amber-400">PICK</span>
        <span className="text-xs text-white">{slotLabel}</span>
        {viaName && <span className="text-[10px] text-slate-500">via {viaName}</span>}
      </span>
    );
  };

  if (isTrade) {
    const sides: Record<number, { players: string[]; picks: SleeperTradedPick[] }> = {};
    Object.entries(adds).forEach(([playerId, rosterId]) => {
      if (!sides[rosterId]) sides[rosterId] = { players: [], picks: [] };
      sides[rosterId].players.push(playerId);
    });
    picks.forEach((pick) => {
      const rosterId = pick.owner_id;
      if (!sides[rosterId]) sides[rosterId] = { players: [], picks: [] };
      sides[rosterId].picks.push(pick);
    });

    return (
      <div className={`rounded-2xl border p-4 ${cardCls}`}>
        <div className="flex items-center gap-2 mb-3">
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${typeLabelCls}`}>{typeLabel}</span>
          <span className="text-xs font-semibold text-slate-300">{tx.leagueName}</span>
          <span className="ml-auto text-[11px] text-slate-500 shrink-0">{relTime(tx.created)}</span>
        </div>
        <div className="space-y-2">
          {Object.entries(sides).map(([rosterIdStr, side]) => {
            const rosterId = Number(rosterIdStr);
            const ownerName = rosterOwnerMap[rosterId] ?? `Team ${rosterId}`;
            return (
              <div key={rosterId}>
                <div className="text-[10px] font-semibold text-slate-400 mb-1">{ownerName} receives</div>
                <div className="flex flex-wrap gap-1.5">
                  {side.players.map((pid) => <PlayerPill key={pid} playerId={pid} />)}
                  {side.picks.map((pick) => <PickPill key={`${pick.season}-${pick.round}-${pick.roster_id}-${pick.owner_id}`} pick={pick} />)}
                </div>
              </div>
            );
          })}
          {Object.keys(sides).length === 0 && (
            <p className="text-xs text-slate-500">Pick-only trade — no player assets.</p>
          )}
        </div>
      </div>
    );
  }

  const rosterId = tx.roster_ids?.[0];
  const ownerName = rosterOwnerMap[rosterId] ?? `Team ${rosterId ?? "?"}`;

  return (
    <div className={`rounded-2xl border p-4 ${cardCls}`}>
      <div className="flex items-center gap-2 mb-2.5">
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${typeLabelCls}`}>{typeLabel}</span>
        <span className="text-xs font-semibold text-slate-300">{tx.leagueName}</span>
        <span className="ml-auto text-[11px] text-slate-500 shrink-0">{relTime(tx.created)}</span>
      </div>
      <div className="text-xs font-semibold text-slate-400 mb-2">{ownerName}</div>
      {hasAdds && (
        <div className="mb-1.5">
          <span className="text-[10px] uppercase tracking-wide text-emerald-400 font-semibold mr-2">Added</span>
          <span className="inline-flex flex-wrap gap-1.5">
            {Object.keys(adds).map((pid) => <PlayerPill key={pid} playerId={pid} />)}
          </span>
        </div>
      )}
      {hasDrops && (
        <div>
          <span className="text-[10px] uppercase tracking-wide text-red-400 font-semibold mr-2">Dropped</span>
          <span className="inline-flex flex-wrap gap-1.5">
            {Object.keys(drops).map((pid) => <PlayerPill key={pid} playerId={pid} />)}
          </span>
        </div>
      )}
    </div>
  );
}
