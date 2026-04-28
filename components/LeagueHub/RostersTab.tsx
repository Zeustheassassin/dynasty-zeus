"use client";
import { useMemo, memo } from "react";
import {
  getLineupSettings,
  getNonStandardRules,
  formatRule,
  groupRules,
  ordinal,
  CURRENT_YEAR,
} from "../../lib/helpers";
import { usePlayers } from "../../lib/PlayersContext";
import { useLeague } from "../../lib/LeagueContext";
import { useValues } from "../../lib/ValuesContext";
import { useMyRoster } from "../../lib/RosterContext";
import type { SleeperLeague, SleeperUser, SleeperTradedPick, SleeperPlayer } from "../../lib/types";
import type { TeamSummary } from "./leagueHubTypes";

const ROLE_PRIORITY: Record<string, number> = { starter: 0, bench: 1, taxi: 2 };

const getStarterSlots = (roster: import("../../lib/types").SleeperRoster, league: SleeperLeague) => {
  if (!roster?.starters || !league?.roster_positions) return [];
  return roster.starters.map((playerId: string, i: number) => ({
    playerId,
    slot: league.roster_positions[i],
  }));
};

interface RostersTabProps {
  leagues: SleeperLeague[];
  user: SleeperUser | null;
  picks: SleeperTradedPick[];
  teamSummary: TeamSummary | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  search: string;
  setSearch: (s: string) => void;
  leagueSearch: string;
  setLeagueSearch: (s: string) => void;
  freeAgents: SleeperPlayer[];
  setSelectedLeague: (league: SleeperLeague | null) => void;
  loadRoster: (league: SleeperLeague) => void;
}

function RostersTab({
  leagues,
  user,
  picks,
  teamSummary,
  activeTab,
  setActiveTab,
  search,
  setSearch,
  leagueSearch,
  setLeagueSearch,
  freeAgents,
  setSelectedLeague,
  loadRoster,
}: RostersTabProps) {
  const players = usePlayers();
  const { selectedLeague, users } = useLeague();
  const { myRoster: roster } = useMyRoster();
  const { selectedLeagueDirection, selectedLeagueDirectionAdjusted } = useValues();

  const grouped = useMemo(() => {
    if (!roster || !players) return {} as Record<string, Array<SleeperPlayer & { role: string }>>;
    const getRole = (id: string) => {
      if (roster?.starters?.includes(id)) return "starter";
      if (roster?.taxi?.includes(id)) return "taxi";
      return "bench";
    };
    const g: Record<string, Array<SleeperPlayer & { role: string }>> = { QB: [], RB: [], WR: [], TE: [] };
    roster.players?.forEach((id: string) => {
      const p = players[id];
      if (!p) return;
      g[p.position]?.push({ ...p, role: getRole(id) });
    });
    Object.keys(g).forEach((pos) => {
      g[pos].sort((a, b) => ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role]);
    });
    return g;
  }, [roster, players]);

  const filteredPlayers = useMemo(
    () =>
      (grouped[activeTab] || [])
        .filter((p) => p.full_name?.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => {
          const roleDiff = ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role];
          if (roleDiff !== 0) return roleDiff;
          return (b.value || 0) - (a.value || 0);
        }),
    [grouped, activeTab, search]
  );

  return (
    <>
      {user && leagues.length > 0 && !selectedLeague && (
        <div className="max-w-4xl mx-auto">
          <h2 className="text-xl font-semibold mb-4 text-slate-300">Your Leagues</h2>
          <input
            className="w-full mb-6 px-4 py-3 rounded-xl bg-slate-900 border border-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-500"
            placeholder="Search leagues..."
            value={leagueSearch}
            onChange={(e) => setLeagueSearch(e.target.value)}
          />
          {leagues
            .filter((l) => l.name.toLowerCase().includes(leagueSearch.toLowerCase()))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((l) => (
              <div
                key={l.league_id}
                onClick={() => loadRoster(l)}
                className="group bg-slate-900 border border-slate-800 p-4 rounded-xl mb-3 cursor-pointer hover:bg-slate-800 transition flex justify-between items-center"
              >
                <p className="font-medium">{l.name}</p>
                <span className="text-slate-500 group-hover:text-blue-400 transition">→</span>
              </div>
            ))}
        </div>
      )}
      {selectedLeague && roster && (
        <>
          <button onClick={() => setSelectedLeague(null)} className="mb-2 text-sm text-gray-400">← Back</button>
          <div className="mb-4">
            <h2 className="text-lg font-bold">{selectedLeague.name}</h2>
            <div className="text-xs text-gray-400">{roster.settings?.team_name || "Your Team"}</div>
            <div className="text-xs text-blue-400 mt-1">{getLineupSettings(selectedLeague)}</div>
          </div>
          {selectedLeagueDirection && (() => {
            const dir = selectedLeagueDirectionAdjusted ?? selectedLeagueDirection;
            return (
              <div className="mb-4 bg-gray-900 border border-gray-700 rounded-xl p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Roster Direction</div>
                    <div className="mt-1 text-sm text-gray-200">{dir.summary}</div>
                  </div>
                  <div className="flex items-center gap-2 self-start">
                    <span className={`inline-flex text-[10px] font-semibold px-2 py-1 rounded-full border ${dir.bucketColor}`}>
                      {dir.bucket}
                    </span>
                    {dir.rawBucket && dir.rawBucket !== dir.bucket && (
                      <span className="text-[10px] text-gray-500">({dir.rawBucket} by assets)</span>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-6">
                  <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500">Dynasty</div>
                    <div className="text-sm font-semibold text-white">{ordinal(dir.dynRank)}</div>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500">Redraft</div>
                    <div className="text-sm font-semibold text-white">{ordinal(dir.redRank)}</div>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500">Standings</div>
                    <div className="text-sm font-semibold text-white">{ordinal(dir.standRank)}</div>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500">Max PF</div>
                    <div className="text-sm font-semibold text-white">{ordinal(dir.maxPfRank)}</div>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500">Core Age</div>
                    <div className="text-sm font-semibold text-white">{dir.coreAge || "-"}</div>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500">1sts</div>
                    <div className="text-sm font-semibold text-white">{dir.firstRounders}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {dir.actions.map((action: string) => (
                    <span key={action} className="rounded-full border border-blue-800 bg-blue-950/40 px-3 py-1 text-[11px] text-blue-200">
                      {action}
                    </span>
                  ))}
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-green-400">What You Have</div>
                    <div className="mt-1 space-y-1">
                      {dir.strengths.length > 0 ? dir.strengths.map((item: string) => (
                        <div key={item} className="text-xs text-gray-300">{item}</div>
                      )) : (
                        <div className="text-xs text-gray-500">No clear structural advantage yet.</div>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-orange-400">What To Watch</div>
                    <div className="mt-1 space-y-1">
                      {dir.concerns.length > 0 ? dir.concerns.map((item: string) => (
                        <div key={item} className="text-xs text-gray-300">{item}</div>
                      )) : (
                        <div className="text-xs text-gray-500">No major red flags from the current profile.</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
          {(() => {
            const rules = getNonStandardRules(selectedLeague?.scoring_settings);
            const grouped = groupRules(rules);
            return Object.entries(grouped).map(([section, items]) => {
              if (items.length === 0) return null;
              return (
                <div key={section} className="mb-2">
                  <div className="text-xs font-medium text-gray-400 mb-0.5 uppercase tracking-wide">{section}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {items.map((rule) => (
                      <div key={rule.key} className="flex justify-between items-center bg-yellow-200/10 border border-yellow-500/20 rounded px-2 py-1.5">
                        <span className="text-yellow-300 text-xs">{formatRule(rule.key)}</span>
                        <span className="text-green-400 text-xs">{rule.value > 0 ? `+${rule.value}` : rule.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            });
          })()}
          {(() => {
            const data = teamSummary;
            if (!data) return null;
            const { summary, pickSummary } = data;
            return (
              <div className="mt-4 flex flex-wrap gap-2 text-xs mb-4">
                {["QB", "RB", "WR", "TE"].map((pos) => (
                  <div key={pos} className="px-3 py-1 bg-gray-800/60 rounded-full border border-gray-700/50">
                    {pos}: {summary[pos]}
                  </div>
                ))}
                {Object.keys(pickSummary).sort().map((year) => (
                  <div key={year} className="px-3 py-1 bg-blue-900/40 rounded-full border border-blue-700">
                    {year} Picks: {pickSummary[year]}
                  </div>
                ))}
              </div>
            );
          })()}
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 mb-4">
            <div className="flex flex-wrap gap-2 mb-3">
              {["ROSTER", "QB", "RB", "WR", "TE", "PICKS", "FREE AGENTS"].map((pos) => (
                <button
                  key={pos}
                  onClick={() => setActiveTab(pos)}
                  className={`px-3 py-1 rounded ${activeTab === pos ? "bg-blue-600" : "bg-gray-800 hover:bg-gray-700"}`}
                >
                  {pos}
                </button>
              ))}
            </div>
            <input
              className="w-full p-2.5 rounded bg-gray-800 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search players..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {["QB", "RB", "WR", "TE"].includes(activeTab) && (
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
              <div className="text-sm font-semibold mb-3 text-gray-300">{activeTab}</div>
              {filteredPlayers?.map((p) => {
                const colors: Record<string, string> = {
                  starter: "bg-green-800/60",
                  bench: "bg-blue-800/40",
                  taxi: "bg-purple-800/60",
                };
                return (
                  <div key={p.player_id} className={`flex items-center justify-between px-3 py-1.5 mb-1 rounded text-sm ${colors[p.role ?? ""]}`}>
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-medium">{p.full_name}</span>
                      <span className="text-xs text-gray-400">{p.team}</span>
                      <span className="text-xs text-gray-500">{(p.role ?? "").toUpperCase()}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs whitespace-nowrap">
                      <span className="text-gray-400">Age {p.age || "—"}</span>
                      <span className="text-blue-400 font-semibold">{p.value || 0}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {activeTab === "ROSTER" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {["QB", "RB", "WR", "TE"].map((pos) => {
                const taxiIds = new Set(roster?.taxi || []);
                const starterIds = new Set(roster?.starters || []);
                const allPlayersList = (roster?.players || []).filter((id) => !taxiIds.has(id));
                const starterSlots = getStarterSlots(roster, selectedLeague);
                const starters = starterSlots
                  .map((s) => ({ ...players[s.playerId], slot: s.slot }))
                  .filter((p) => p && p.position === pos);
                const bench = allPlayersList
                  .filter((id) => !starterIds.has(id))
                  .map((id) => players[id])
                  .filter((p) => p && p.position === pos)
                  .sort((a, b) => ((b?.value || 0) - (a?.value || 0)));
                const playersByPos = [...starters, ...bench].sort((a, b) => ((b?.value || 0) - (a?.value || 0)));
                const totalVal = playersByPos.reduce((sum: number, p) => sum + (p?.value || 0), 0);
                return (
                  <div key={pos} className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                    <div className="flex justify-between mb-3">
                      <div className="font-semibold text-sm">{pos} {playersByPos.length} TOTAL</div>
                      <div className="text-xs text-gray-400">TOTAL {pos} VAL {totalVal}</div>
                    </div>
                    {starters.map((p, i) => (
                      <div key={`s-${i}`} className="flex justify-between items-center bg-green-900/30 border border-green-700 rounded p-2 mb-2">
                        <div className="flex items-center gap-2">
                          <div className="text-xs px-2 py-1 rounded bg-green-700">{p.slot.replace("_", " ")}</div>
                          <div>{p.full_name}</div>
                        </div>
                        <div className="text-xs text-gray-300">VAL {p.value || 0}</div>
                      </div>
                    ))}
                    {bench.map((p, i) => (
                      <div key={`b-${i}`} className="flex justify-between items-center bg-blue-900/30 border border-blue-700 rounded p-2 mb-2">
                        <div className="flex items-center gap-2">
                          <div className="text-xs px-2 py-1 rounded bg-blue-700">{pos}{starters.length + i + 1}</div>
                          <div>{p.full_name}</div>
                        </div>
                        <div className="text-xs text-gray-300">VAL {p.value || 0}</div>
                      </div>
                    ))}
                  </div>
                );
              })}
              {(roster?.taxi || []).length > 0 && (
                <div className="mt-6 bg-gray-900 border border-gray-700 rounded-lg p-4">
                  <div className="flex justify-between mb-3">
                    <div className="font-semibold text-sm text-purple-400">TAXI {roster.taxi?.length ?? 0} TOTAL</div>
                    <div className="text-xs text-gray-400">
                      TOTAL TAXI VAL{" "}
                      {(roster.taxi || []).map((id) => players[id]).filter((p) => p).reduce((sum: number, p) => sum + (p?.value || 0), 0)}
                    </div>
                  </div>
                  {(roster.taxi || []).map((id, i) => {
                    const p = players[id];
                    if (!p) return null;
                    return (
                      <div key={id} className="flex justify-between items-center bg-gray-800 rounded p-2 mb-2">
                        <div className="flex items-center gap-2">
                          <div className="text-xs px-2 py-1 rounded bg-purple-700">TX{i + 1}</div>
                          <div>{p.full_name}</div>
                        </div>
                        <div className="text-xs text-gray-400">VAL {p.value || 0}</div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="mt-6">
                {Array.from(new Set(picks.map((p) => String(p.season)))).sort().map((year) => {
                  const yearPicks = picks.filter((p) => p.season === year).sort((a, b) => a.round - b.round);
                  if (!yearPicks.length) return null;
                  return (
                    <div key={year} className="mb-4 bg-gray-900 border border-gray-700 rounded-lg p-4">
                      <div className="flex justify-between mb-3">
                        <div className="font-semibold text-sm">{year} Picks {yearPicks.length} TOTAL</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {yearPicks.map((pick) => {
                          const ownerName = users[pick.roster_id] || users[pick.owner_id] || "Unknown";
                          const label = pick.season === CURRENT_YEAR
                            ? pick.slot
                            : `${pick.round}${["th", "st", "nd", "rd"][pick.round] || "th"}`;
                          return (
                            <div
                              key={`${pick.season}-${pick.round}-${pick.roster_id}-${pick.owner_id}`}
                              className={`px-3 py-1 rounded-full text-xs border ${
                                pick.round === 1 ? "bg-yellow-900/40 border-yellow-600 text-yellow-300"
                                : pick.round === 2 ? "bg-green-900/40 border-green-600 text-green-300"
                                : pick.round === 3 ? "bg-blue-900/40 border-blue-600 text-blue-300"
                                : "bg-orange-900/40 border-orange-600 text-orange-300"
                              }`}
                            >
                              {label}
                              <span className="ml-1 text-gray-400">via {ownerName}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {activeTab === "PICKS" && (
            <div className="mt-2">
              {Array.from(new Set(picks.map((p) => String(p.season)))).sort().map((year) => {
                const yearPicks = picks
                  .filter((p) => p.season === year)
                  .sort((a, b) => {
                    if (a.round !== b.round) return a.round - b.round;
                    return (a.pick_no || 0) - (b.pick_no || 0);
                  });
                if (!yearPicks.length) return null;
                return (
                  <div key={year} className="mb-4">
                    <div className="text-sm font-bold mb-2">{year}</div>
                    <div className="flex flex-wrap gap-2">
                      {yearPicks.map((pick) => {
                        const ownerName = users[pick.roster_id] || users[pick.owner_id] || "Unknown";
                        const label = pick.season === CURRENT_YEAR
                          ? pick.slot
                          : `${pick.round}${["th","st","nd","rd"][pick.round] || "th"}`;
                        return (
                          <div
                            key={`${pick.season}-${pick.round}-${pick.roster_id}-${pick.owner_id}`}
                            className={`px-3 py-1 rounded-full text-xs border flex items-center gap-1 ${
                              pick.round === 1 ? "bg-yellow-900/40 border-yellow-600 text-yellow-300"
                              : pick.round === 2 ? "bg-green-900/40 border-green-600 text-green-300"
                              : pick.round === 3 ? "bg-blue-900/40 border-blue-600 text-blue-300"
                              : "bg-orange-900/40 border-orange-600 text-orange-300"
                            }`}
                          >
                            <span className="font-semibold">{label}</span>
                            <span className="text-[10px] text-gray-300">via {ownerName}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {activeTab === "FREE AGENTS" && (
            <div className="mt-4 bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-sm font-semibold mb-3 text-gray-300">Top Free Agents (by Value)</div>
              {freeAgents.map((p) => (
                <div key={p.player_id} className="flex justify-between items-center bg-gray-800/70 px-3 py-1.5 rounded-lg mb-1 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="text-[10px] px-2 py-0.5 rounded bg-gray-700/80">{p.position}</div>
                    <div>{p.full_name}</div>
                  </div>
                  <div className="text-[11px] text-gray-400">VAL {p.value || 0}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

export default memo(RostersTab);
