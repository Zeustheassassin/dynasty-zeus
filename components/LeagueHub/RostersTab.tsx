"use client";
import { useMemo, useCallback, memo } from "react";
import {
  getLineupSettings,
  getNonStandardRules,
  formatRule,
  groupRules,
  roundScoringValue,
  ordinal,
  CURRENT_YEAR,
} from "../../lib/helpers";
import { usePlayers } from "../../lib/PlayersContext";
import { useLeague } from "../../lib/LeagueContext";
import { useValues } from "../../lib/ValuesContext";
import { useMyRoster } from "../../lib/RosterContext";
import { MY_DISPOSITIONS, pickDispositionKey } from "../../lib/helpers/dispositions";
import { DispositionPicker } from "../shared/DispositionPicker";
import { buildConsensusOrder, reconcilePersonalOrdering } from "../../lib/helpers/personalRankings";
import type { SleeperLeague, SleeperUser, SleeperTradedPick, SleeperPlayer, AssetDisposition, LeagueAssetDispositions } from "../../lib/types";

const ROLE_PRIORITY: Record<string, number> = { starter: 0, bench: 1, taxi: 2 };
const ROLE_LABEL: Record<string, string> = { starter: "Starter", bench: "Bench", taxi: "Taxi" };
const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
type Position = typeof POSITIONS[number];

interface RostersTabProps {
  leagues: SleeperLeague[];
  user: SleeperUser | null;
  picks: SleeperTradedPick[];
  leagueSearch: string;
  setLeagueSearch: (s: string) => void;
  freeAgents: SleeperPlayer[];
  personalOrdering?: string[];
  setSelectedLeague: (league: SleeperLeague | null) => void;
  loadRoster: (league: SleeperLeague) => void;
  leaguePlayerTags: LeagueAssetDispositions;
  onSetAssetDisposition: (leagueId: string, assetId: string, disposition: AssetDisposition | null) => void;
}

function RostersTab({
  leagues,
  user,
  picks,
  leagueSearch,
  setLeagueSearch,
  freeAgents,
  personalOrdering = [],
  setSelectedLeague,
  loadRoster,
  leaguePlayerTags,
  onSetAssetDisposition,
}: RostersTabProps) {
  const players = usePlayers();
  const { selectedLeague, users } = useLeague();
  const { myRoster: roster } = useMyRoster();
  const { selectedLeagueDirection, selectedLeagueDirectionAdjusted, leagueAdjustedFcValues } = useValues();
  const dir = selectedLeagueDirectionAdjusted ?? selectedLeagueDirection ?? null;
  const leagueTags = leaguePlayerTags[selectedLeague?.league_id ?? ""] ?? {};
  const setDisposition = (assetId: string, disposition: AssetDisposition | null) => {
    if (!selectedLeague) return;
    onSetAssetDisposition(selectedLeague.league_id, assetId, disposition);
  };

  // League-adjusted value where available (matches what actually drives sort/rank
  // everywhere else in this component, e.g. personalRankByPlayerId below) — falling
  // back to the player's raw global value so unadjusted players don't show as 0.
  // useCallback (not a plain closure) so its identity only changes with
  // leagueAdjustedFcValues, keeping the useMemo below's deps array accurate.
  const adjVal = useCallback(
    (p: { player_id: string; value?: number | null }) => leagueAdjustedFcValues[p.player_id] ?? p.value ?? 0,
    [leagueAdjustedFcValues]
  );

  const grouped = useMemo(() => {
    const g: Record<Position, Array<SleeperPlayer & { role: string }>> = { QB: [], RB: [], WR: [], TE: [] };
    if (!roster || !players) return g;
    const getRole = (id: string) => {
      if (roster?.starters?.includes(id)) return "starter";
      if (roster?.taxi?.includes(id)) return "taxi";
      return "bench";
    };
    roster.players?.forEach((id: string) => {
      const p = players[id];
      if (!p) return;
      const pos = p.position as Position;
      if (!g[pos]) return;
      g[pos].push({ ...p, role: getRole(id) });
    });
    (Object.keys(g) as Position[]).forEach((pos) => {
      g[pos].sort((a, b) => {
        const roleDiff = ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role];
        if (roleDiff !== 0) return roleDiff;
        return adjVal(b) - adjVal(a);
      });
    });
    return g;
  }, [roster, players, adjVal]);

  const positionRankByPos = useMemo(() => {
    const map: Partial<Record<Position, number>> = {};
    dir?.positionRanks?.forEach((r) => { map[r.pos as Position] = r.rank; });
    return map;
  }, [dir]);

  const personalRankByPlayerId = useMemo(() => {
    if (!players) return new Map<string, number>();
    const consensusOrder = buildConsensusOrder(players, (id) => leagueAdjustedFcValues[id] ?? 0);
    const order = reconcilePersonalOrdering(personalOrdering, consensusOrder);
    const map = new Map<string, number>();
    order.forEach((id, i) => map.set(id, i + 1));
    return map;
  }, [players, leagueAdjustedFcValues, personalOrdering]);

  const sortedFreeAgents = useMemo(() => {
    return [...freeAgents].sort((a, b) => {
      const ra = personalRankByPlayerId.get(a.player_id) ?? Number.MAX_SAFE_INTEGER;
      const rb = personalRankByPlayerId.get(b.player_id) ?? Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
  }, [freeAgents, personalRankByPlayerId]);

  const picksByYear = useMemo(() => {
    const years = Array.from(new Set(picks.map((p) => String(p.season)))).sort();
    return years
      .map((year) => ({
        year,
        list: picks
          .filter((p) => p.season === year)
          .sort((a, b) => {
            if (a.round !== b.round) return a.round - b.round;
            return (a.pick_no || 0) - (b.pick_no || 0);
          }),
      }))
      .filter((g) => g.list.length > 0);
  }, [picks]);

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
          <button onClick={() => setSelectedLeague(null)} className="mb-2 text-sm text-slate-400">← Back</button>
          <div className="mb-4">
            <h2 className="text-lg font-bold">{selectedLeague.name}</h2>
            <div className="text-xs text-slate-400">{roster.settings?.team_name || "Your Team"}</div>
            <div className="text-xs text-blue-400 mt-1">{getLineupSettings(selectedLeague)}</div>
          </div>
          {dir && (
            <div className="mb-3 bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="border-b border-slate-800 pb-2 mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Roster Direction</div>
                  <div className="mt-0.5 text-xs text-slate-200">{dir.summary}</div>
                </div>
                <div className="text-[11px] text-slate-400 whitespace-nowrap">
                  <span className="font-semibold text-emerald-400">{dir.bucket}</span>
                  {dir.rawBucket && dir.rawBucket !== dir.bucket && (
                    <span className="ml-1 text-slate-500">({dir.rawBucket} by assets)</span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-3 gap-y-1">
                {[
                  { label: "Dynasty", value: ordinal(dir.dynRank) },
                  { label: "Redraft", value: ordinal(dir.redRank) },
                  { label: "Standings", value: ordinal(dir.standRank) },
                  { label: "Max PF", value: ordinal(dir.maxPfRank) },
                  { label: "Core Age", value: dir.coreAge || "-" },
                  { label: "1sts", value: dir.firstRounders },
                ].map((tile) => (
                  <div key={tile.label} className="text-xs">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">{tile.label}</div>
                    <div className="text-slate-200 font-medium">{tile.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(() => {
            const rules = getNonStandardRules(selectedLeague?.scoring_settings);
            const grouped = groupRules(rules);
            const sections = Object.entries(grouped).filter(([, items]) => items.length > 0);
            if (sections.length === 0) return null;
            return (
              <div className="mb-3 bg-slate-900 border border-slate-800 rounded-xl p-3">
                <div className="border-b border-slate-800 pb-2 mb-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Scoring Rules</div>
                </div>
                <div className="space-y-2">
                  {sections.map(([section, items]) => (
                    <div key={section}>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">{section}</div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-1.5">
                        {items.map((rule) => {
                          const rounded = roundScoringValue(rule.value);
                          return (
                            <div key={rule.key} className="flex justify-between items-center gap-2 text-xs py-0.5">
                              <span className="truncate text-slate-200">{formatRule(rule.key)}</span>
                              <span className="text-emerald-400 font-medium whitespace-nowrap">{rounded > 0 ? `+${rounded}` : rounded}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {POSITIONS.map((pos) => {
              const list = grouped[pos];
              const totalValue = list.reduce((s, p) => s + adjVal(p), 0);
              const ages = list.map((p) => Number(p.age)).filter((a) => Number.isFinite(a) && a > 0);
              const avgAge = ages.length ? ages.reduce((s, a) => s + a, 0) / ages.length : null;
              const rank = positionRankByPos[pos];
              return (
                <div key={pos} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                  <div className="border-b border-slate-800 pb-2 mb-2">
                    <div className="text-xs text-slate-400">
                      {pos} Rank: <span className="font-semibold text-emerald-400">{rank ?? "—"}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Value: <span className="text-slate-200 font-medium">{totalValue.toLocaleString()}</span>
                      {avgAge != null && (
                        <> {" | "}Age: <span className="text-slate-200 font-medium">{avgAge.toFixed(1)}</span></>
                      )}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    {list.length === 0 ? (
                      <div className="text-[11px] text-slate-600 italic">No players</div>
                    ) : (
                      list.map((p) => (
                        <div key={p.player_id} className="text-xs py-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0 truncate text-slate-200">{p.full_name}</div>
                            <span className="text-emerald-400 font-medium whitespace-nowrap">{adjVal(p).toLocaleString()}</span>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between gap-2">
                            <span className="text-[10px] text-slate-500">{ROLE_LABEL[p.role] ?? ""}</span>
                            <DispositionPicker
                              value={leagueTags[p.player_id]}
                              options={MY_DISPOSITIONS}
                              onChange={(next) => setDisposition(p.player_id, next)}
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="border-b border-slate-800 pb-2 mb-2">
                <div className="text-xs text-slate-400">Picks: <span className="font-semibold text-emerald-400">{picks.length}</span></div>
              </div>
              <div className="space-y-2">
                {picksByYear.length === 0 ? (
                  <div className="text-[11px] text-slate-600 italic">No picks</div>
                ) : (
                  picksByYear.map(({ year, list }) => (
                    <div key={year}>
                      <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">{year}</div>
                      <div className="space-y-0.5">
                        {list.map((pick) => {
                          const ownerName = users[pick.roster_id] || users[pick.owner_id] || "Unknown";
                          const label = pick.season === CURRENT_YEAR
                            ? pick.slot
                            : `${pick.round}${["th", "st", "nd", "rd"][pick.round] || "th"}`;
                          const assetId = pickDispositionKey(pick);
                          return (
                            <div key={assetId} className="text-xs py-0.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-slate-200 font-medium whitespace-nowrap">{label}</span>
                                <span className="text-[10px] text-slate-500 truncate">via {ownerName}</span>
                              </div>
                              <div className="mt-0.5 flex justify-end">
                                <DispositionPicker
                                  value={leagueTags[assetId]}
                                  options={MY_DISPOSITIONS}
                                  onChange={(next) => setDisposition(assetId, next)}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="border-b border-slate-800 pb-2 mb-2">
                <div className="text-xs text-slate-400">Free Agents: <span className="font-semibold text-emerald-400">{freeAgents.length}</span></div>
              </div>
              <div className="space-y-0.5">
                {sortedFreeAgents.length === 0 ? (
                  <div className="text-[11px] text-slate-600 italic">None</div>
                ) : (
                  sortedFreeAgents.map((p) => (
                    <div key={p.player_id} className="flex items-center justify-between gap-2 text-xs py-0.5">
                      <div className="flex-1 min-w-0 flex items-center gap-1">
                        <span className="text-[10px] text-slate-500 uppercase">{p.position}</span>
                        <span className="truncate text-slate-200">{p.full_name}</span>
                      </div>
                      <span className="text-emerald-400 font-medium whitespace-nowrap">{adjVal(p).toLocaleString()}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default memo(RostersTab);
