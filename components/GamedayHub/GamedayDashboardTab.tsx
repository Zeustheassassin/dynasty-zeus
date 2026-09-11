"use client";
import React from "react";
import type { SleeperLeague, GamedayDashboardEntry } from "../../lib/types";
import { getGamedayResultStatus } from "../../lib/helpers/gameday";
import GamedayTeamRow from "./GamedayTeamRow";

interface GamedayDashboardTabProps {
  week: number;
  entries: GamedayDashboardEntry[];
  loading: boolean;
  onRefresh: () => void;
  onOpenLeague: (league: SleeperLeague) => void;
}

function GamedayDashboardTab({ week, entries, loading, onRefresh, onOpenLeague }: GamedayDashboardTabProps) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Gameday Dashboard</div>
            <div className="mt-1 text-sm text-gray-200">
              Your matchup in every league, side by side. Click a card to open that league&apos;s full slot-by-slot breakdown.
            </div>
          </div>
          <button
            onClick={onRefresh}
            disabled={!week}
            className={`rounded-xl border px-3 py-2 text-sm transition ${
              week
                ? "border-blue-700 text-blue-300 hover:bg-blue-500/10"
                : "border-gray-800 text-gray-600 cursor-not-allowed"
            }`}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {!week && (
        <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6 text-sm text-gray-400">
          Gameday Hub only turns on during the regular season once Sleeper posts an active NFL week.
        </div>
      )}

      {week > 0 && (
        <>
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Week {week}</span>
            <span>
              {loading && entries.length === 0
                ? "Loading your matchups..."
                : `${entries.length} league${entries.length === 1 ? "" : "s"}`}
            </span>
          </div>

          {loading && entries.length === 0 ? (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6 text-sm text-blue-400">
              Loading your matchups across every league...
            </div>
          ) : entries.length === 0 ? (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6 text-sm text-gray-400">
              No leagues found.
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {entries.map((entry) => (
                <button
                  key={entry.league.league_id}
                  onClick={() => onOpenLeague(entry.league)}
                  className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4 text-left transition hover:border-gray-700"
                >
                  <div className="mb-3 truncate text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {entry.league.name}
                  </div>
                  {entry.error ? (
                    <div className="text-xs text-red-400">Couldn&apos;t load this league — try refreshing.</div>
                  ) : !entry.myTeam ? (
                    <div className="text-xs text-gray-500">No matchup this week.</div>
                  ) : (
                    <div className="space-y-3">
                      <GamedayTeamRow team={entry.myTeam} resultStatus={getGamedayResultStatus(entry.myTeam, entry.oppTeam)} />
                      {entry.oppTeam && <GamedayTeamRow team={entry.oppTeam} />}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default React.memo(GamedayDashboardTab);
