"use client";
import React from "react";
import { usePlayers } from "../../lib/PlayersContext";
import { POS_COLOR } from "./dataHubHelpers";
import type { ShareEntry } from "./dataHubTypes";

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;

interface MySharesTabProps {
  shares: Record<string, ShareEntry>;
  totalLeagues: number;
}

function MySharesTab({ shares, totalLeagues }: MySharesTabProps) {
  const players = usePlayers();

  const grouped: Record<(typeof POSITIONS)[number], { name: string; count: number }[]> = {
    QB: [], RB: [], WR: [], TE: [],
  };
  for (const [playerId, data] of Object.entries(shares)) {
    const p = players[playerId];
    if (!p?.full_name) continue;
    const pos = p.position as (typeof POSITIONS)[number];
    if (!POSITIONS.includes(pos)) continue;
    grouped[pos].push({ name: p.full_name, count: data.count });
  }
  POSITIONS.forEach((pos) => {
    grouped[pos].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  });

  const totalShares = POSITIONS.reduce((sum, pos) => sum + grouped[pos].length, 0);

  return (
    <div className="max-w-5xl mx-auto px-4">
      <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
        <div className="mb-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">My Shares</div>
          <div className="mt-1 text-xs text-gray-400">
            All players you own across every connected league, grouped by position.
            Each row shows how many of your {totalLeagues} leagues you own them in, then that share as a %.
          </div>
        </div>

        {totalShares === 0 ? (
          <p className="text-sm text-gray-500">Connect your Sleeper account to see your cross-league shares.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {POSITIONS.map((pos) => (
              <div key={pos}>
                <div className={`text-[11px] font-bold uppercase tracking-wide mb-1.5 ${POS_COLOR[pos]}`}>
                  {pos}
                  <span className="ml-1.5 text-gray-500 font-normal">({grouped[pos].length})</span>
                </div>
                <div className="rounded-lg border border-gray-800 bg-gray-950/40 divide-y divide-gray-800/70">
                  {grouped[pos].length === 0 ? (
                    <div className="px-2.5 py-1.5 text-xs text-gray-600 italic">None</div>
                  ) : (
                    grouped[pos].map((p) => (
                      <div
                        key={p.name}
                        className="flex items-center justify-between px-2.5 py-1 text-xs"
                      >
                        <span className="text-gray-200 truncate pr-2">{p.name}</span>
                        <span className="font-mono shrink-0 flex items-baseline gap-1.5">
                          <span className="text-gray-300">{p.count}</span>
                          <span className="text-gray-500 text-[10px]">
                            {totalLeagues > 0 ? Math.round((p.count / totalLeagues) * 100) : 0}%
                          </span>
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(MySharesTab);
