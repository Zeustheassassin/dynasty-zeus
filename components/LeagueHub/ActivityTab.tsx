"use client";
import { usePlayers } from "../../lib/PlayersContext";
import { useLeague } from "../../lib/LeagueContext";
import type { AnnotatedTransaction } from "./leagueHubTypes";

interface ActivityTabProps {
  activityTransactions: AnnotatedTransaction[];
  loadingActivity: boolean;
  setPlayerProfileId: (id: string | null) => void;
}

export default function ActivityTab({
  activityTransactions,
  loadingActivity,
  setPlayerProfileId,
}: ActivityTabProps) {
  const players = usePlayers();
  const { selectedLeague, rosters, users } = useLeague();

  if (!selectedLeague) return (
    <p className="text-sm text-gray-500">Select a league from Rosters &amp; Rules first to view the activity feed.</p>
  );
  if (loadingActivity) return <p className="text-sm text-blue-400">Loading transactions…</p>;

  const rosterToUser: Record<number, string> = {};
  rosters.forEach((r) => { rosterToUser[r.roster_id] = r.owner_id; });
  const ownerName = (rosterId: number) => {
    const uid = rosterToUser[rosterId];
    return users[uid] || `Team ${rosterId}`;
  };

  const fmtTs = (ts: number) => {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const txns = activityTransactions.filter((t) =>
    Object.keys(t.adds || {}).length > 0 ||
    Object.keys(t.drops || {}).length > 0 ||
    (t.draft_picks || []).length > 0
  );

  if (!txns.length) return (
    <div className="text-center py-10 text-gray-500 text-sm">
      No transactions found for {selectedLeague.name}. Activity appears here as the season progresses.
    </div>
  );

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 mb-3">
        Recent transactions for <strong className="text-gray-300">{selectedLeague.name}</strong>. Click any player name to view their profile.
      </p>
      {txns.map((t, idx) => {
        const isWaiver = t.type === "waiver";
        const isTrade = t.type === "trade";
        const adds = Object.entries(t.adds || {}) as [string, number][];
        const drops = Object.entries(t.drops || {}) as [string, number][];
        const picks = t.draft_picks || [];

        const typeLabel = isTrade ? "Trade" : isWaiver ? "Waiver" : "Free Agent";
        const typeColor = isTrade
          ? "bg-purple-900/40 text-purple-300 border-purple-700"
          : isWaiver
          ? "bg-blue-900/40 text-blue-300 border-blue-700"
          : "bg-green-900/40 text-green-300 border-green-700";

        if (isTrade) {
          const rosterIds = Array.from(new Set([
            ...adds.map(([, rid]) => rid),
            ...drops.map(([, rid]) => rid),
            ...(t.roster_ids || []),
          ])) as number[];

          return (
            <div key={t.transaction_id || idx} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${typeColor}`}>{typeLabel}</span>
                  <span className="text-xs text-gray-500">{fmtTs(t.updated || t.created)}</span>
                </div>
              </div>
              <div className={`grid gap-3`} style={{ gridTemplateColumns: `repeat(${Math.min(rosterIds.length, 3)}, 1fr)` }}>
                {rosterIds.map((rid) => {
                  const got = adds.filter(([, r]) => r === rid).map(([pid]) => pid);
                  const gave = drops.filter(([, r]) => r === rid).map(([pid]) => pid);
                  const gotPicks = picks.filter((p) => p.owner_id === rid);
                  const gavePicks = picks.filter((p) => p.previous_owner_id === rid);
                  return (
                    <div key={rid}>
                      <p className="text-xs font-semibold text-blue-300 mb-1">{ownerName(rid)}</p>
                      {got.length > 0 && (
                        <div className="mb-1">
                          <p className="text-[10px] text-green-500 uppercase font-bold mb-0.5">Received</p>
                          {got.map(pid => {
                            const p = players[pid];
                            return p ? (
                              <button key={pid} onClick={() => setPlayerProfileId(pid)} className="block text-xs text-white hover:text-blue-400 transition text-left">
                                {p.full_name} <span className="text-gray-500">{p.position}</span>
                              </button>
                            ) : null;
                          })}
                          {gotPicks.map((pk) => (
                            <p key={`${pk.season}-${pk.round}-${pk.roster_id}`} className="text-xs text-gray-400">{pk.season} Rd {pk.round}</p>
                          ))}
                        </div>
                      )}
                      {gave.length > 0 && (
                        <div>
                          <p className="text-[10px] text-red-400 uppercase font-bold mb-0.5">Gave</p>
                          {gave.map(pid => {
                            const p = players[pid];
                            return p ? (
                              <button key={pid} onClick={() => setPlayerProfileId(pid)} className="block text-xs text-gray-400 hover:text-blue-400 transition text-left line-through">
                                {p.full_name} <span className="text-gray-600">{p.position}</span>
                              </button>
                            ) : null;
                          })}
                          {gavePicks.map((pk) => (
                            <p key={`${pk.season}-${pk.round}-${pk.roster_id}`} className="text-xs text-gray-600 line-through">{pk.season} Rd {pk.round}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }

        return (
          <div key={t.transaction_id || idx} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-start gap-3">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 mt-0.5 ${typeColor}`}>{typeLabel}</span>
            <div className="min-w-0 flex-1">
              {adds.map(([pid, rid]) => {
                const p = players[pid];
                return p ? (
                  <div key={pid} className="flex items-center gap-1.5 text-xs">
                    <span className="text-green-400 font-bold">+</span>
                    <button onClick={() => setPlayerProfileId(pid)} className="text-white hover:text-blue-400 transition font-medium">
                      {p.full_name}
                    </button>
                    <span className="text-gray-500">{p.position} · {p.team}</span>
                    <span className="text-gray-600">→ {ownerName(rid)}</span>
                  </div>
                ) : null;
              })}
              {drops.map(([pid, rid]) => {
                const p = players[pid];
                return p ? (
                  <div key={pid} className="flex items-center gap-1.5 text-xs">
                    <span className="text-red-400 font-bold">−</span>
                    <button onClick={() => setPlayerProfileId(pid)} className="text-gray-400 hover:text-blue-400 transition line-through">
                      {p.full_name}
                    </button>
                    <span className="text-gray-600">{p.position} · {p.team} dropped by {ownerName(rid)}</span>
                  </div>
                ) : null;
              })}
            </div>
            <span className="text-[10px] text-gray-600 shrink-0 mt-0.5">{fmtTs(t.updated || t.created)}</span>
          </div>
        );
      })}
    </div>
  );
}
