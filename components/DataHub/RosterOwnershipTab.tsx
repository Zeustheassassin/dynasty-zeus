"use client";
import React from "react";
import { usePlayers } from "../../lib/PlayersContext";
import { injuryBadge, injuryRiskBadge, POS_COLOR } from "./dataHubHelpers";
import type { ShareEntry } from "./dataHubTypes";
import { Card } from "../ui/Card";

interface RosterOwnershipTabProps {
  shares: Record<string, ShareEntry>;
  loading: boolean;
  search: string;
  setSearch: (s: string) => void;
  position: string;
  setPosition: (pos: string) => void;
}

function RosterOwnershipTab({ shares, loading, search, setSearch, position, setPosition }: RosterOwnershipTabProps) {
  const players = usePlayers();

  return (
    <div className="max-w-5xl mx-auto px-4">
      <Card>
        <div className="mb-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Roster Ownership Check</div>
          <div className="mt-1 text-xs text-slate-400">Your starters across all leagues — injury-flagged starts appear first.</div>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          <input
            className="flex-1 min-w-36 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
            placeholder="Search player…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex gap-1">
            {["ALL", "QB", "RB", "WR", "TE"].map((pos) => (
              <button
                key={pos}
                onClick={() => setPosition(pos)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition ${position === pos ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:text-white"}`}
              >
                {pos}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
            <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
            Loading cross-league roster data…
          </div>
        ) : Object.keys(shares).length === 0 ? (
          <p className="text-sm text-slate-500">Connect your Sleeper account to see cross-league ownership.</p>
        ) : (() => {
          const INJURY_PRIORITY: Record<string, number> = { IR: 0, O: 1, D: 2, Q: 3 };
          const rows = Object.entries(shares)
            .filter(([playerId]) => {
              const p = players[playerId];
              if (!p) return false;
              if (position !== "ALL" && p.position !== position) return false;
              if (search && !p.full_name?.toLowerCase().includes(search.toLowerCase())) return false;
              return true;
            })
            .sort((a, b) => {
              const aData = a[1]; const bData = b[1];
              const aP = players[a[0]]; const bP = players[b[0]];
              const aStatus = (aP?.injury_status || "").toUpperCase();
              const bStatus = (bP?.injury_status || "").toUpperCase();
              const aPrio = INJURY_PRIORITY[aStatus] ?? 10;
              const bPrio = INJURY_PRIORITY[bStatus] ?? 10;
              const aStarter = aData.starters.length > 0;
              const bStarter = bData.starters.length > 0;
              if (aStarter && !bStarter) return -1;
              if (!aStarter && bStarter) return 1;
              if (aPrio !== bPrio) return aPrio - bPrio;
              return bData.count - aData.count;
            });

          return (
            <div className="space-y-1.5">
              {rows.map(([playerId, data]) => {
                const p = players[playerId];
                if (!p) return null;
                const statusUpper = (p.injury_status || "").toUpperCase();
                const isCritical = ["IR", "O"].includes(statusUpper);
                const isAtRisk = ["D", "Q"].includes(statusUpper);
                const isStarting = data.starters.length > 0;
                return (
                  <div
                    key={playerId}
                    className={`rounded-xl border px-3 py-2 ${
                      isCritical && isStarting ? "border-red-800/60 bg-red-950/15" :
                      isAtRisk && isStarting   ? "border-yellow-800/50 bg-yellow-950/10" :
                      "border-slate-800 bg-slate-900/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold shrink-0 ${POS_COLOR[p.position] ?? "text-slate-400"}`}>{p.position}</span>
                      <span className="text-sm font-medium text-white flex-1 truncate min-w-0 flex items-center gap-1">
                        {p.full_name}{injuryBadge(p.injury_status)}{injuryRiskBadge(p.age, p.position, p.injury_status)}
                      </span>
                      {p.team && <span className="text-[10px] text-slate-500 shrink-0">{p.team}</span>}
                      <span className={`text-[10px] font-semibold shrink-0 ${isStarting ? "text-green-400" : "text-slate-500"}`}>
                        {isStarting
                          ? `Starting ${data.starters.length}/${data.leagues.length}`
                          : `Owned ${data.count}`}
                      </span>
                    </div>
                    {(isStarting || data.leagues.length > 0) && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {data.starters.map((l: string, i: number) => (
                          <span key={`s-${i}`} className="text-[9px] font-medium text-green-400 bg-green-900/20 border border-green-800/30 rounded px-1.5 py-0.5">▶ {l}</span>
                        ))}
                        {data.leagues.filter((l: string) => !data.starters.includes(l)).map((l: string, i: number) => (
                          <span key={`b-${i}`} className="text-[9px] text-slate-500 bg-slate-800/50 border border-slate-700/30 rounded px-1.5 py-0.5">{l}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {rows.length === 0 && (
                <p className="text-sm text-slate-500">No players match your search.</p>
              )}
            </div>
          );
        })()}
      </Card>
    </div>
  );
}

export default React.memo(RosterOwnershipTab);
