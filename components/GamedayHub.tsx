"use client";
import React from "react";
import type { SleeperLeague, SleeperPlayer, GamedayMatchup, GamedayTeamView, GamedayLineupRow } from "../lib/types";
import { useLeague } from "../lib/LeagueContext";

// ── Helpers (module-level, same logic as page.tsx) ─────────────────────────
const getKickoffStateClasses = (state: string) => {
  if (state === "Live") return "border-green-500/40 bg-green-500/10 text-green-300";
  if (state === "Final") return "border-gray-600 bg-gray-800 text-gray-300";
  return "border-blue-500/40 bg-blue-500/10 text-blue-300";
};

const POS_COLOR: Record<string, string> = {
  QB: "text-red-400",
  RB: "text-green-400",
  WR: "text-blue-400",
  TE: "text-yellow-400",
};

const INJURY_CLS: Record<string, string> = {
  IR: "bg-red-900/70 text-red-300",
  O:  "bg-red-900/70 text-red-300",
  D:  "bg-orange-900/70 text-orange-300",
  Q:  "bg-yellow-900/70 text-yellow-300",
};
const injuryBadge = (status: string | null | undefined) => {
  if (!status) return null;
  const s = status.toUpperCase();
  const cls = INJURY_CLS[s];
  if (!cls) return null;
  return <span className={`ml-1 rounded px-1 py-0.5 text-[9px] font-bold ${cls}`}>{s}</span>;
};

// ── Props ──────────────────────────────────────────────────────────────────
interface ShareEntry { count: number; leagues: string[]; starters: string[] }

interface GamedayHubProps {
  // League selection
  leagues: SleeperLeague[];
  loadRoster: (league: SleeperLeague) => void;

  // Gameday state
  gamedayWeek: number;
  gamedayMatchupCards: GamedayMatchup[];
  loadingGamedayMatchups: boolean;
  selectedGamedayMatchup: GamedayMatchup | null;
  setSelectedGamedayMatchupId: (id: number | null) => void;

  // Actions
  loadGamedayMatchups: (leagueId: string, week: number) => void;
  setProjectionWeek: (week: number) => void;
  setProjectionLoaded: (loaded: boolean) => void;
  loadProjections: (week: number) => void;

  // Player profile panel trigger
  setPlayerProfileId: (id: string | null) => void;

  // Ownership (moved from Data Hub for gameday roster checks)
  shares: Record<string, ShareEntry>;
  totalLeagues: number;
  loadingShares: boolean;
  shareSearch: string;
  setShareSearch: (s: string) => void;
  sharePosition: string;
  setSharePosition: (pos: string) => void;
  players: Record<string, SleeperPlayer>;
}

// ── Component ──────────────────────────────────────────────────────────────
function GamedayHub({
  leagues,
  loadRoster,
  gamedayWeek,
  gamedayMatchupCards,
  loadingGamedayMatchups,
  selectedGamedayMatchup,
  setSelectedGamedayMatchupId,
  loadGamedayMatchups,
  setProjectionWeek,
  setProjectionLoaded,
  loadProjections,
  setPlayerProfileId,
  shares,
  totalLeagues: _totalLeagues,
  loadingShares,
  shareSearch,
  setShareSearch,
  sharePosition,
  setSharePosition,
  players,
}: GamedayHubProps) {
  const { selectedLeague } = useLeague();

  const starterSlots = (selectedLeague?.roster_positions || []).filter(
    (slot: string) => !["BN", "IR", "TAXI"].includes(slot)
  );

  const teamA: GamedayTeamView | null = selectedGamedayMatchup?.teams?.[0] ?? null;
  const teamB: GamedayTeamView | null = selectedGamedayMatchup?.teams?.[1] ?? null;

  const renderPlayerCell = (row: GamedayLineupRow | undefined, side: "left" | "right") => {
    if (!row?.player) {
      return (
        <div className={`text-xs text-gray-600 ${side === "right" ? "text-right" : ""}`}>
          Open slot
        </div>
      );
    }

    return (
      <div className={`min-w-0 ${side === "right" ? "text-right" : ""}`}>
        <button
          onClick={() => setPlayerProfileId(row.player!.player_id)}
          className="block w-full truncate text-sm font-medium text-white hover:text-blue-400 transition"
        >
          {row.player.full_name}
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-gray-500">
          <span className={`${POS_COLOR[row.player.position] ?? "text-gray-500"} ${side === "right" ? "ml-auto" : ""}`}>
            {row.player.position} • {row.player.team || "-"}
          </span>
          {injuryBadge(row.player.injury_status)}
          <span className={`rounded-full border px-1.5 py-0.5 ${getKickoffStateClasses(row.gameState)}`}>
            {row.gameState}
          </span>
          <span>{row.kickoffLabel}</span>
        </div>
        <div className="mt-1 text-xs text-gray-300">
          {row.actualPoints.toFixed(1)} pts now • {row.remainingProjection.toFixed(1)} left
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      {/* Header card */}
      <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Gameday Hub</div>
            <div className="mt-1 text-sm text-gray-200">
              Official Sleeper matchup totals for the current week, with projected remaining points for each lineup slot.
            </div>
            <div className="mt-2 text-[11px] text-gray-500">
              Player status badges reflect kickoff windows: upcoming, live, or final.
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={selectedLeague?.league_id || ""}
              onChange={(e) => {
                const nextLeague = leagues.find((league) => league.league_id === e.target.value);
                if (nextLeague) loadRoster(nextLeague);
              }}
              className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">Select a league</option>
              {leagues.map((league) => (
                <option key={league.league_id} value={league.league_id}>
                  {league.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                if (selectedLeague?.league_id && gamedayWeek) loadGamedayMatchups(selectedLeague.league_id, gamedayWeek);
                if (gamedayWeek) {
                  setProjectionWeek(gamedayWeek);
                  setProjectionLoaded(false);
                  loadProjections(gamedayWeek);
                }
              }}
              disabled={!selectedLeague?.league_id || !gamedayWeek}
              className={`rounded-xl border px-3 py-2 text-sm transition ${
                selectedLeague?.league_id && gamedayWeek
                  ? "border-blue-700 text-blue-300 hover:bg-blue-500/10"
                  : "border-gray-800 text-gray-600 cursor-not-allowed"
              }`}
            >
              Refresh Snapshot
            </button>
          </div>
        </div>
      </div>

      {!selectedLeague && (
        <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6 text-sm text-gray-400">
          Pick a league above to load its current-week matchups.
        </div>
      )}

      {selectedLeague && !gamedayWeek && (
        <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6 text-sm text-gray-400">
          Gameday Hub only turns on during the regular season once Sleeper posts an active NFL week.
        </div>
      )}

      {selectedLeague && gamedayWeek > 0 && (
        <>
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{selectedLeague.name} • Week {gamedayWeek}</span>
            <span>
              {loadingGamedayMatchups
                ? "Refreshing matchup totals..."
                : `${gamedayMatchupCards.length} matchup${gamedayMatchupCards.length === 1 ? "" : "s"}`}
            </span>
          </div>

          {loadingGamedayMatchups && gamedayMatchupCards.length === 0 ? (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6 text-sm text-blue-400">
              Loading current-week matchup totals...
            </div>
          ) : gamedayMatchupCards.length === 0 ? (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6 text-sm text-gray-400">
              No matchup data returned yet for this league and week.
            </div>
          ) : (
            <>
              {/* Matchup cards grid */}
              <div className="grid gap-3 lg:grid-cols-2">
                {gamedayMatchupCards.map((card) => (
                  <button
                    key={card.matchupId}
                    onClick={() => setSelectedGamedayMatchupId(card.matchupId)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      selectedGamedayMatchup?.matchupId === card.matchupId
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-gray-800 bg-gray-900/60 hover:border-gray-700"
                    }`}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Matchup {card.matchupId}
                      </div>
                      <div className="text-[11px] text-gray-600">
                        {card.teams.reduce((total: number, team: GamedayTeamView) => total + team.liveStarters, 0) > 0
                          ? "Games in progress"
                          : "No live games"}
                      </div>
                    </div>
                    <div className="space-y-3">
                      {card.teams.map((team) => (
                        <div key={team.rosterId} className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2.5">
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
                      ))}
                    </div>
                  </button>
                ))}
              </div>

              {/* Empty selection prompt */}
              {!selectedGamedayMatchup && (
                <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4 text-sm text-gray-500">
                  Select a matchup above to see the slot-by-slot breakdown.
                </div>
              )}

              {/* Detailed matchup view */}
              {selectedGamedayMatchup && teamA && teamB && (
                <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                  <div className="flex flex-col gap-3 border-b border-gray-800 pb-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Detailed Matchup View</div>
                      <div className="mt-1 text-lg font-semibold text-white">
                        {teamA.ownerName} vs {teamB.ownerName}
                      </div>
                      <div className="mt-1 text-sm text-gray-400">
                        Week {gamedayWeek} • official matchup totals + projected remaining lineup points
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-right">
                      {[teamA, teamB].map((team) => (
                        <div key={team.rosterId} className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                          <div className="text-xs text-gray-500">{team.ownerName}</div>
                          <div className="mt-1 text-xl font-semibold text-white">{team.actualPoints.toFixed(1)}</div>
                          <div className="text-[11px] text-gray-500">
                            {team.remainingProjection.toFixed(1)} left • {team.projectedFinal.toFixed(1)} final
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Slot-by-slot comparison */}
                  <div className="mt-4 space-y-2">
                    <div className="grid grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)_78px] gap-3 px-2 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                      <span>{teamA.ownerName}</span>
                      <span className="text-center">Slot</span>
                      <span className="text-right">{teamB.ownerName}</span>
                      <span className="text-right">Delta</span>
                    </div>
                    {starterSlots.map((slot: string, index: number) => {
                      const leftRow = teamA.starterRows[index];
                      const rightRow = teamB.starterRows[index];
                      const delta = (leftRow?.actualPoints || 0) - (rightRow?.actualPoints || 0);

                      return (
                        <div
                          key={`${selectedGamedayMatchup.matchupId}-${index}`}
                          className="grid grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)_78px] gap-3 items-center rounded-xl border border-gray-800 bg-gray-950/50 px-3 py-3"
                        >
                          {renderPlayerCell(leftRow, "left")}
                          <div className="text-center">
                            <div className="text-[11px] font-semibold text-gray-300">{slot.replace("_", " ")}</div>
                            <div className="mt-1 text-[10px] text-gray-600">
                              {(leftRow?.actualPoints || 0).toFixed(1)} - {(rightRow?.actualPoints || 0).toFixed(1)}
                            </div>
                          </div>
                          {renderPlayerCell(rightRow, "right")}
                          <div
                            className={`text-right text-sm font-semibold ${
                              delta > 0.05 ? "text-green-400" : delta < -0.05 ? "text-red-400" : "text-gray-400"
                            }`}
                          >
                            {delta > 0 ? "+" : ""}{delta.toFixed(1)}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Bench + taxi */}
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    {([teamA, teamB] as GamedayTeamView[]).map((team) => (
                      <div
                        key={`${selectedGamedayMatchup.matchupId}-${team.rosterId}`}
                        className="rounded-xl border border-gray-800 bg-gray-950/50 p-3"
                      >
                        <div className="text-sm font-semibold text-white">{team.ownerName} — Bench & Taxi</div>
                        <details className="mt-3 group">
                          <summary className="cursor-pointer list-none text-xs font-semibold text-blue-300 group-open:text-blue-200">
                            Bench ({team.benchRows.length})
                          </summary>
                          <div className="mt-2 space-y-2">
                            {team.benchRows.length === 0 ? (
                              <div className="text-xs text-gray-600">No bench players loaded.</div>
                            ) : team.benchRows.map((row) => (
                              <div
                                key={`${team.rosterId}-bench-${row.playerId}`}
                                className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2"
                              >
                                <div className="flex items-center gap-1 min-w-0">
                                  <button
                                    onClick={() => setPlayerProfileId(row.playerId)}
                                    className="min-w-0 truncate text-xs font-medium text-white hover:text-blue-400 transition"
                                  >
                                    {row.player?.full_name}
                                  </button>
                                  {injuryBadge(row.player?.injury_status)}
                                </div>
                                <div className="shrink-0 text-right text-[11px] text-gray-500">
                                  {row.actualPoints.toFixed(1)} now • {row.remainingProjection.toFixed(1)} left
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                        <details className="mt-3 group">
                          <summary className="cursor-pointer list-none text-xs font-semibold text-blue-300 group-open:text-blue-200">
                            Taxi ({team.taxiRows.length})
                          </summary>
                          <div className="mt-2 space-y-2">
                            {team.taxiRows.length === 0 ? (
                              <div className="text-xs text-gray-600">No taxi players loaded.</div>
                            ) : team.taxiRows.map((row) => (
                              <div
                                key={`${team.rosterId}-taxi-${row.playerId}`}
                                className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2"
                              >
                                <div className="flex items-center gap-1 min-w-0">
                                  <button
                                    onClick={() => setPlayerProfileId(row.playerId)}
                                    className="min-w-0 truncate text-xs font-medium text-white hover:text-blue-400 transition"
                                  >
                                    {row.player?.full_name}
                                  </button>
                                  {injuryBadge(row.player?.injury_status)}
                                </div>
                                <div className="shrink-0 text-right text-[11px] text-gray-500">
                                  {row.actualPoints.toFixed(1)} now • {row.remainingProjection.toFixed(1)} left
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
      {/* ── ROSTER OWNERSHIP CHECK ── */}
      <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
        <div className="mb-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Roster Ownership Check</div>
          <div className="mt-1 text-xs text-gray-400">Your starters across all leagues — injury-flagged starts appear first.</div>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          <input
            className="flex-1 min-w-36 rounded-lg border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
            placeholder="Search player…"
            value={shareSearch}
            onChange={(e) => setShareSearch(e.target.value)}
          />
          <div className="flex gap-1">
            {["ALL", "QB", "RB", "WR", "TE"].map((pos) => (
              <button
                key={pos}
                onClick={() => setSharePosition(pos)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition ${sharePosition === pos ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
              >
                {pos}
              </button>
            ))}
          </div>
        </div>

        {loadingShares ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
            <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
            Loading cross-league roster data…
          </div>
        ) : Object.keys(shares).length === 0 ? (
          <p className="text-sm text-gray-500">Connect your Sleeper account to see cross-league ownership.</p>
        ) : (() => {
          const INJURY_PRIORITY: Record<string, number> = { IR: 0, O: 1, D: 2, Q: 3 };
          const rows = Object.entries(shares)
            .filter(([playerId]) => {
              const p = players[playerId];
              if (!p) return false;
              if (sharePosition !== "ALL" && p.position !== sharePosition) return false;
              if (shareSearch && !p.full_name?.toLowerCase().includes(shareSearch.toLowerCase())) return false;
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
                      "border-gray-800 bg-gray-900/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold shrink-0 ${POS_COLOR[p.position] ?? "text-gray-400"}`}>{p.position}</span>
                      <span className="text-sm font-medium text-white flex-1 truncate min-w-0 flex items-center gap-1">
                        {p.full_name}{injuryBadge(p.injury_status)}
                      </span>
                      {p.team && <span className="text-[10px] text-gray-500 shrink-0">{p.team}</span>}
                      <span className={`text-[10px] font-semibold shrink-0 ${isStarting ? "text-green-400" : "text-gray-500"}`}>
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
                          <span key={`b-${i}`} className="text-[9px] text-gray-500 bg-gray-800/50 border border-gray-700/30 rounded px-1.5 py-0.5">{l}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {rows.length === 0 && (
                <p className="text-sm text-gray-500">No players match your search.</p>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export default React.memo(GamedayHub);
