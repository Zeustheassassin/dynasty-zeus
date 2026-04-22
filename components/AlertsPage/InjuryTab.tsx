"use client";
import type { InjuryReportPlayer } from "./alertsPageHelpers";
import { POS_COLOR, injuryStatusStyle } from "./alertsPageHelpers";

type InjuryTabProps = {
  injuryReportPlayers: InjuryReportPlayer[];
  currentNFLWeek: number;
  expandedInjuryId: string | null;
  setExpandedInjuryId: (id: string | null) => void;
};

export default function InjuryTab({ injuryReportPlayers, currentNFLWeek, expandedInjuryId, setExpandedInjuryId }: InjuryTabProps) {
  return (
    <div>
      {injuryReportPlayers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
          Add players to your watchlist or load your leagues to see injury statuses here.
        </div>
      ) : (
        <div className="space-y-1.5">
          {injuryReportPlayers.map(({ player, playerId, leagues, startingLeagues, isWatchlisted }) => {
            const { cls: statusCls, label: statusLabel } = injuryStatusStyle(player);
            const byeWeek = Number(player.bye_week || 0);
            const byeWeeksOut = currentNFLWeek && byeWeek ? byeWeek - currentNFLWeek : null;
            const showBye = byeWeeksOut === 1 || byeWeeksOut === 2;
            const isExpanded = expandedInjuryId === playerId;

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
                    <span className={`text-[10px] font-semibold border px-2 py-0.5 rounded-lg ${statusCls}`}>
                      {statusLabel}
                    </span>
                    <span className={`inline-block transition-transform duration-150 text-slate-600 text-xs ${isExpanded ? "rotate-180" : ""}`}>▼</span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-800 bg-slate-900/60 px-4 py-3">
                    {startingLeagues.length > 0 ? (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-500 mb-2">
                          In starting lineup
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {startingLeagues.map((name) => (
                            <span
                              key={name}
                              className="text-xs border border-emerald-800/60 bg-emerald-950/40 text-emerald-300 px-2.5 py-1 rounded-xl"
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                        {leagues.length > startingLeagues.length && (
                          <div className="mt-2.5">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-1.5">
                              On bench
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {leagues
                                .filter((l) => !startingLeagues.includes(l))
                                .map((name) => (
                                  <span
                                    key={name}
                                    className="text-xs border border-slate-700 bg-slate-800/40 text-slate-400 px-2.5 py-1 rounded-xl"
                                  >
                                    {name}
                                  </span>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : leagues.length > 0 ? (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-1.5">
                          On bench in all leagues
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {leagues.map((name) => (
                            <span
                              key={name}
                              className="text-xs border border-slate-700 bg-slate-800/40 text-slate-400 px-2.5 py-1 rounded-xl"
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">Not on any of your rosters — watchlist only.</p>
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
