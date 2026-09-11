"use client";
import React from "react";
import type { GamedayTeamView } from "../../lib/types";

interface GamedayTeamRowProps {
  team: GamedayTeamView;
  // Win/loss read vs. this team's opponent, for the Gameday Dashboard's "my
  // team" row only — projected while games are in progress, actual once
  // every starter on both sides has finished. Omitted elsewhere (e.g. the
  // single-league matchup grid), which keeps this row's plain styling.
  resultStatus?: { status: "win" | "loss" | "tie"; final: boolean } | null;
}

// Condensed team summary shared by the single-league matchup grid and the
// cross-league Gameday Dashboard, so the two views can't visually drift apart.
function GamedayTeamRow({ team, resultStatus }: GamedayTeamRowProps) {
  const isDecided = resultStatus && resultStatus.status !== "tie";
  const containerClasses = !isDecided
    ? "border-gray-800 bg-gray-950/60"
    : resultStatus.final
    ? resultStatus.status === "win"
      ? "border-green-600 bg-green-900/30"
      : "border-red-600 bg-red-900/30"
    : resultStatus.status === "win"
    ? "border-green-500 bg-gray-950/60"
    : "border-red-500 bg-gray-950/60";

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${containerClasses}`}>
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
