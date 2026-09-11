"use client";
import React from "react";
import type { GamedayTeamView } from "../../lib/types";

interface GamedayTeamRowProps {
  team: GamedayTeamView;
}

// Condensed team summary shared by the single-league matchup grid and the
// cross-league Gameday Dashboard, so the two views can't visually drift apart.
function GamedayTeamRow({ team }: GamedayTeamRowProps) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{team.ownerName}</div>
          <div className="mt-1 text-[11px] text-gray-500">
            {[
              team.finishedStarters > 0 && `${team.finishedStarters} final`,
              team.liveStarters > 0 && `${team.liveStarters} live`,
              team.upcomingStarters > 0 && `${team.upcomingStarters} upcoming`,
            ].filter(Boolean).join(" • ") || "—"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold text-white">{team.actualPoints.toFixed(1)}</div>
          <div className="text-[11px] text-gray-500">+{team.remainingProjection.toFixed(1)} left</div>
        </div>
      </div>
      <div className="mt-2 text-xs text-gray-400">
        Projected final: <span className="text-gray-200">{team.projectedFinal.toFixed(1)}</span>
      </div>
    </div>
  );
}

export default React.memo(GamedayTeamRow);
