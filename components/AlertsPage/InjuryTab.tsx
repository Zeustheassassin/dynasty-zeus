"use client";
import { memo } from "react";
import type { InjuryReportPlayer } from "./alertsPageHelpers";
import { POS_COLOR, injuryStatusStyle } from "./alertsPageHelpers";
import EmptyState from "../ui/EmptyState";

type InjuryTabProps = {
  injuryReportPlayers: InjuryReportPlayer[];
  currentNFLWeek: number;
  expandedInjuryId: string | null;
  setExpandedInjuryId: (id: string | null) => void;
};

function InjuryTab({ injuryReportPlayers, currentNFLWeek, expandedInjuryId, setExpandedInjuryId }: InjuryTabProps) {
  return (
    <div>
      {injuryReportPlayers.length === 0 ? (
        <EmptyState>Add players to your watchlist or load your leagues to see injury statuses here.</EmptyState>
      ) : (
        <div className="space-y-1.5">
          {injuryReportPlayers.map(({ player, playerId, leagues, startingLeagues, irLeagues, isWatchlisted }) => {
            const { cls: statusCls, label: statusLabel } = injuryStatusStyle(player);
            const byeWeek = Number(player.bye_week || 0);
            const byeWeeksOut = currentNFLWeek && byeWeek ? byeWeek - currentNFLWeek : null;
            const showBye = byeWeeksOut === 1 || byeWeeksOut === 2;
            const isExpanded = expandedInjuryId === playerId;
            const benchLeagues = leagues.filter(
              (l) => !startingLeagues.some((s) => s.id === l.id) && !irLeagues.some((s) => s.id === l.id)
            );

            return (
              <div key={playerId} className="rounded-2xl border border-slate-800 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedInjuryId(isExpanded ? null : playerId)}
                  className="w-full text-left bg-slate-950/40 px-3 py-2.5 flex items-center gap-3 hover:bg-slate-800/40 transition"
                >
                  <span className={`text-[10px] font-bold shrink-0 ${POS_COLOR[player.position] ?? "text-slate-400"}`}>
                    {player.position}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-white truncate">{player.full_name}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-slate-400">{player.team || "FA"}</span>
                      {startingLeagues.length > 0 && (
                        <span className="text-[10px] text-emerald-500">
                          Starting in {startingLeagues.length} {startingLeagues.length === 1 ? "league" : "leagues"}
                        </span>
                      )}
                      {isWatchlisted && leagues.length === 0 && (
                        <span className="text-[10px] text-amber-500">Watchlist only</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {showBye && (
                      <span className="text-[10px] font-semibold border border-purple-700 bg-purple-900/30 text-purple-300 px-2 py-0.5 rounded-lg">
                        Bye Wk {byeWeek}
                      </span>
                    )}
                    {leagues.length > 0 && (
                      <span className="text-[10px] font-semibold border border-slate-600 bg-slate-800/60 text-slate-300 px-2 py-0.5 rounded-lg whitespace-nowrap">
                        {startingLeagues.length > 0
                          ? `Starting ${startingLeagues.length}/${leagues.length}`
                          : `Owned ${leagues.length}`}
                      </span>
                    )}
                    {irLeagues.length > 0 && (
                      <span className="text-[10px] font-semibold border border-red-800 bg-red-950/40 text-red-300 px-2 py-0.5 rounded-lg whitespace-nowrap">
                        IR {irLeagues.length}/{leagues.length}
                      </span>
                    )}
                    <span className={`text-[10px] font-semibold border px-2 py-0.5 rounded-lg ${statusCls}`}>
                      {statusLabel}
                    </span>
                    <span className={`inline-block transition-transform duration-150 text-slate-600 text-xs ${isExpanded ? "rotate-180" : ""}`}>▼</span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-800 bg-slate-900/60 px-4 py-3 space-y-2.5">
                    {leagues.length === 0 ? (
                      <p className="text-xs text-slate-500">Not on any of your rosters — watchlist only.</p>
                    ) : (
                      <>
                        {startingLeagues.length > 0 && (
                          <div>
                            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-500 mb-1.5">
                              In starting lineup
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {startingLeagues.map((l) => (
                                <span
                                  key={l.id}
                                  className="text-xs border border-emerald-800/60 bg-emerald-950/40 text-emerald-300 px-2.5 py-1 rounded-xl"
                                >
                                  {l.name}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {benchLeagues.length > 0 && (
                          <div>
                            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-1.5">
                              On bench
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {benchLeagues.map((l) => (
                                <span
                                  key={l.id}
                                  className="text-xs border border-slate-700 bg-slate-800/40 text-slate-400 px-2.5 py-1 rounded-xl"
                                >
                                  {l.name}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {irLeagues.length > 0 && (
                          <div>
                            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-red-500 mb-1.5">
                              On IR
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {irLeagues.map((l) => (
                                <span
                                  key={l.id}
                                  className="text-xs border border-red-800/60 bg-red-950/40 text-red-300 px-2.5 py-1 rounded-xl"
                                >
                                  {l.name}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default memo(InjuryTab);
